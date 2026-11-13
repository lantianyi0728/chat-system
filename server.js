/**
 * ============================================================================
 *  chatWB20261103 —— 极简局域网聊天系统 · 后端服务
 * ----------------------------------------------------------------------------
 *  技术栈：Node.js 内置模块（零第三方依赖） + SQLite（node:sqlite）
 *  前端：纯 HTML5 + CSS3 + JavaScript（见 public/ 目录）
 *
 *  目录结构：
 *    server.js          本文件，HTTP 服务 + 全部接口 + 数据库访问
 *    public/index.html  页面结构
 *    public/style.css   样式
 *    public/app.js      前端逻辑
 *    data/chat.db       SQLite 数据库文件（首次启动自动创建，删掉即重置）
 *
 *  启动：node server.js     然后浏览器打开 http://<本机局域网IP>:8000
 * ============================================================================
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ============================================================================
 *  第 0 步：加载 SQLite 驱动（带自动兜底）
 * ----------------------------------------------------------------------------
 *  Node.js 22 起内置了 node:sqlite 模块，不需要 npm install 任何东西，
 *  也不需要额外安装 sqlite3 驱动、不需要编译。
 *
 *  但不同小版本对它的开放方式不同：
 *    · Node >= 22.5  ：需要启动参数 --experimental-sqlite
 *    · Node >= 23.4  ：已默认开放，直接 require 即可
 *  为兼容这两种情况，这里先直接 require；失败就自动带上参数重启自己。
 *  这样使用者永远只需要执行 `node server.js` 一条命令。
 * ========================================================================== */
let DatabaseSync;

/* 屏蔽 node:sqlite 的 ExperimentalWarning。
   它只表示"该模块尚未标记为稳定"，不影响任何功能；
   留在控制台上会让使用者误以为启动出错。必须写在 require 之前才拦得住。 */
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w.stack || w.message);
});

try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  // 走到这里说明当前 Node 版本需要显式打开实验开关，自动重启用自己
  const { spawnSync } = require('node:child_process');
  console.log('[启动] 当前 Node 需要 --experimental-sqlite 开关，正在自动重启…');
  const r = spawnSync(
    process.execPath,
    ['--experimental-sqlite', __filename, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  process.exit(r.status === null ? 1 : r.status);
}


/* ============================================================================
 *  第 1 步：数据库连接 —— 【核心讲解区】
 * ----------------------------------------------------------------------------
 *  ① 什么是 DatabaseSync？
 *     SQLite 是"嵌入式数据库"：没有独立服务进程、不需要账号密码、不需要端口。
 *     数据就是一个普通文件（本项目的 data/chat.db）。程序直接读写这个文件。
 *     DatabaseSync 是 Node 官方提供的同步 API：
 *       - 方法名带 Sync，调用时会阻塞当前线程直到 SQL 执行完；
 *       - 好处是代码是"一行接一行"的顺序逻辑，不用 await / Promise / 回调嵌套，
 *         对教学和小型项目极其友好；
 *       - 代价是并发极高时会排队，但局域网几十人聊天完全无压力。
 *
 *  ② 连接是怎么建立的？
 *     只要 `new DatabaseSync(文件路径)` 这一行。
 *       - 文件不存在 → SQLite 自动创建；
 *       - 文件存在   → 直接打开；
 *       - 传 ':memory:' → 建一个只在内存里的临时库（本项目不用）。
 *     连接对象 db 贯穿整个进程生命周期，全局复用一份，不要每次请求都 new，
 *     否则会反复打开文件句柄，既慢又容易锁库。
 *
 *  ③ 打开之后先做的三件事（PRAGMA）：
 *       journal_mode = WAL   写入日志模式改为 WAL，读写可以并行，聊天场景不卡顿；
 *       foreign_keys = ON    打开外键约束（SQLite 默认是关的，必须手动开）；
 *       busy_timeout = 5000  遇到锁时最多等 5 秒再报错，避免高并发下直接抛异常。
 *
 *  ④ prepare() 与参数绑定 —— 防 SQL 注入的关键：
 *     所有的 SQL 都写成带 ? 占位符的"预编译语句"，值通过第二个参数传入。
 *     SQLite 会把值当作纯数据，绝不会当成 SQL 语句的一部分执行，
 *     所以即使用户名里写 ' OR 1=1 -- 也只会被当成一个普通字符串。
 *     反例（千万不要写）：db.exec(`SELECT * FROM users WHERE username='${name}'`)
 * ========================================================================== */

// 数据库文件放在 data/ 下，与代码分离，方便备份和迁移
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'chat.db');

// 确保 data 目录存在（首次运行时目录可能不存在）
fs.mkdirSync(DATA_DIR, { recursive: true });

// ★ 建立连接：整个进程只做这一次
const db = new DatabaseSync(DB_FILE);

// ★ 连接级配置（每条连接只需设置一次）
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/* ----------------------------------------------------------------------------
 *  第 2 步：建表（IF NOT EXISTS，因此重复启动是安全的、幂等的）
 * ----------------------------------------------------------------------------
 *  users    账号表：用户名唯一，密码不存明文，只存"盐 + 哈希"
 *  messages 消息表：sender_id / receiver_id 都指向 users.id
 *  sessions 登录态表：登录成功发一个随机 token，前端带着它访问接口
 * -------------------------------------------------------------------------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT    NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id, id);
  CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages(receiver_id, is_read);
`);

/* 个人资料表：一个用户一行，外键级联删除 */
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT,
    birthday     TEXT,
    school       TEXT,
    address      TEXT,
    avatar       TEXT,
    color        TEXT
  );

  /* 表情包表：每个用户自己的图片表情，一行一张图 */
  CREATE TABLE IF NOT EXISTS stickers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_path  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
`);

/* profiles 表新增 color 列：每个用户注册时随机分配的头像底色 */
(function migrateProfiles() {
  const cols = db.prepare('PRAGMA table_info(profiles)').all();
  if (!cols.some((c) => c.name === 'color')) {
    db.exec('ALTER TABLE profiles ADD COLUMN color TEXT');
  }
})();

/* 消息表新增 type 列：text=文字，image=图片消息。
   老库可能已有 messages 表且没有 type 列，这里做一次安全迁移 */
(function migrateMessages() {
  const cols = db.prepare('PRAGMA table_info(messages)').all();
  if (!cols.some((c) => c.name === 'type')) {
    db.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text'");
  }
})();

/* ----------------------------------------------------------------------------
 *  第 3 步：预编译语句（prepare）
 * ----------------------------------------------------------------------------
 *  把常用的 SQL 提前编译好并缓存，后续每条请求直接 .run() / .get() / .all()，
 *  少一次解析开销，同时天然做到参数化。
 *
 *  .run(...) 执行写入类语句，返回 { changes, lastInsertRowid }
 *  .get(...) 取第一行，没有则返回 undefined
 *  .all(...) 取多行，返回数组
 * -------------------------------------------------------------------------- */
const SQL = {
  insertUser: db.prepare(
    `INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)`
  ),
  findUserByName: db.prepare(`SELECT * FROM users WHERE username = ?`),
  findUserById: db.prepare(`SELECT id, username, created_at FROM users WHERE id = ?`),

  listUsers: db.prepare(`
    SELECT
      u.id,
      u.username,
      u.created_at,
      COALESCE(p.display_name, u.username) AS display_name,
      p.avatar AS avatar,
      p.color AS color,
      (SELECT COUNT(*) FROM messages m
        WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.is_read = 0) AS unread,
      (SELECT m2.content FROM messages m2
        WHERE (m2.sender_id = u.id AND m2.receiver_id = ?)
           OR (m2.sender_id = ? AND m2.receiver_id = u.id)
        ORDER BY m2.id DESC LIMIT 1) AS last_message,
      (SELECT m2.type FROM messages m2
        WHERE (m2.sender_id = u.id AND m2.receiver_id = ?)
           OR (m2.sender_id = ? AND m2.receiver_id = u.id)
        ORDER BY m2.id DESC LIMIT 1) AS last_type
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id <> ?
    ORDER BY unread DESC, u.username ASC
  `),

  insertMessage: db.prepare(
    `INSERT INTO messages (sender_id, receiver_id, content, type, created_at) VALUES (?, ?, ?, ?, ?)`
  ),
  // 只取双方之间的对话，按 id 升序（id 自增，等价于时间顺序）
  conversation: db.prepare(`
    SELECT id, sender_id, receiver_id, content, type, created_at
    FROM messages
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY id ASC
    LIMIT 500
  `),
  // 拉取对话时，把对方发给我的未读消息标记为已读
  markRead: db.prepare(
    `UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0`
  ),

  insertSession: db.prepare(
    `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`
  ),
  findSession: db.prepare(`
    SELECT u.id, u.username
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),

  /* 个人资料 */
  getProfile: db.prepare(
    `SELECT display_name, birthday, school, address, avatar, color FROM profiles WHERE user_id = ?`
  ),
  upsertProfile: db.prepare(`
    INSERT INTO profiles (user_id, display_name, birthday, school, address, avatar)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      birthday     = excluded.birthday,
      school       = excluded.school,
      address      = excluded.address,
      avatar       = excluded.avatar
  `),
  ensureProfile: db.prepare(`INSERT OR IGNORE INTO profiles (user_id) VALUES (?)`),
  insertProfileColor: db.prepare(
    `INSERT OR IGNORE INTO profiles (user_id, color) VALUES (?, ?)`
  ),
  setColor: db.prepare(`UPDATE profiles SET color = ? WHERE user_id = ?`),
  setAvatar: db.prepare(`UPDATE profiles SET avatar = ? WHERE user_id = ?`),

  /* 表情包（用户自己的图片表情） */
  insertSticker: db.prepare(
    `INSERT INTO stickers (user_id, image_path, created_at) VALUES (?, ?, ?)`
  ),
  listStickers: db.prepare(
    `SELECT id, image_path, created_at FROM stickers WHERE user_id = ? ORDER BY id DESC`
  ),
  deleteSticker: db.prepare(
    `DELETE FROM stickers WHERE id = ? AND user_id = ?`
  ),
};


/* ============================================================================
 *  第 4 步：密码与会话
 * ----------------------------------------------------------------------------
 *  密码绝不存明文。做法是"加盐 + 慢哈希"：
 *    · 盐 salt：每个用户一份随机串，防止彩虹表（同一个密码两个人哈希结果不同）
 *    · scrypt ：Node 内置的慢哈希算法，专门用来抵抗暴力破解
 *  校验时不"解密"，而是用同样的盐再算一次，比对两个哈希是否相等。
 * ========================================================================== */
const nowISO = () => new Date().toISOString();

/* 未设置头像时，字母头像的随机底色。注册时随机分配一个，之后固定不变 */
const AVATAR_COLORS = [
  '#3b7cf6', '#7c5cf0', '#e0568f', '#e0703b', '#22a06b',
  '#0ea5b7', '#d64545', '#8b6b3f', '#4f5bd5', '#c026a8',
];
const randomColor = () => {
  // 尽量挑一个还没被其他用户使用的颜色，避免大家头像撞色
  const used = new Set(
    db.prepare('SELECT color FROM profiles WHERE color IS NOT NULL').all().map((r) => r.color)
  );
  const free = AVATAR_COLORS.filter((c) => !used.has(c));
  const pool = free.length ? free : AVATAR_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
};

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function createUser(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const info = SQL.insertUser.run(username, hash, salt, nowISO());
  return Number(info.lastInsertRowid);
}

function verifyUser(username, password) {
  const row = SQL.findUserByName.get(username);
  if (!row) return null;                       // 用户不存在
  const hash = hashPassword(password, row.salt);
  // timingSafeEqual：等长比较、耗时恒定，避免通过响应时间猜密码
  const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(row.password_hash));
  return ok ? { id: row.id, username: row.username } : null;
}

function issueToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  SQL.insertSession.run(token, userId, nowISO());
  return token;
}

/* ----------------------------------------------------------------------------
 *  第 4.5 步：首次启动自动初始化演示账号
 * ----------------------------------------------------------------------------
 *  仅当 users 表为空时才插入，避免重复。方便部署到新服务器后直接能登录体验，
 *  不用先手动注册。密码统一 123456（教学演示用，正式环境请删掉这段）。
 * -------------------------------------------------------------------------- */
(function seedDemo() {
  if (SQL.findUserByName.get('小明')) return;   // 已有账号就不种子
  createUser('小明', '123456');
  createUser('小红', '123456');
  createUser('阿杰', '123456');
  console.log('[初始化] 已创建演示账号：小明 / 小红 / 阿杰（密码均为 123456）');
})();

/* 给所有还没有头像底色的用户补一个随机颜色（老账号 / 演示账号） */
(function backfillColors() {
  const users = db.prepare('SELECT id FROM users').all();
  const getC = db.prepare('SELECT color FROM profiles WHERE user_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO profiles (user_id, color) VALUES (?, ?)');
  const upd = db.prepare('UPDATE profiles SET color = ? WHERE user_id = ?');
  for (const u of users) {
    const row = getC.get(u.id);
    if (!row) ins.run(u.id, randomColor());
    else if (!row.color) upd.run(randomColor(), u.id);
  }
})();


/* ============================================================================
 *  第 5 步：HTTP 工具函数
 * ========================================================================== */
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// 读取请求体并解析 JSON，限制 12MB（图片/语音的 base64 可能较大）
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 12 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

// 把前端传来的 data:image/...;base64,... 解码成文件，落到 public/uploads/<subdir>/
// 返回可被静态服务直接访问的相对路径，如 /uploads/avatars/ab12cd.png
function saveImageDataURL(dataURL, subdir) {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(String(dataURL || '').trim());
  if (!m) throw new Error('只支持 PNG / JPG / GIF / WEBP 图片');
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new Error('图片不能超过 2MB');
  // 简单校验文件头，挡掉伪装成图片的脚本
  const okMagic =
    (buf[0] === 0x89 && buf[1] === 0x50) ||   // PNG
    (buf[0] === 0xFF && buf[1] === 0xD8) ||   // JPEG
    (buf[0] === 0x47 && buf[1] === 0x49) ||   // GIF
    (buf[0] === 0x52 && buf[1] === 0x49);     // WEBP(RIFF)
  if (!okMagic) throw new Error('图片格式无法识别');
  const dir = path.join(PUBLIC_DIR, 'uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return '/uploads/' + subdir + '/' + name;
}

// 把前端录音的 data:audio/...;base64,... 解码落盘
// 注意浏览器可能带 codecs 参数：data:audio/webm;codecs=opus;base64,xxxx
function saveAudioDataURL(dataURL) {
  const m = /^data:audio\/(webm|ogg|mp4|mpeg|wav|x-wav)[^,]*;base64,(.+)$/i.exec(String(dataURL || '').trim());
  if (!m) throw new Error('不支持的录音格式');
  const map = { webm: 'webm', ogg: 'ogg', mp4: 'm4a', mpeg: 'mp3', wav: 'wav', 'x-wav': 'wav' };
  const ext = map[m[1].toLowerCase()] || 'webm';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('语音不能超过 8MB');
  const dir = path.join(PUBLIC_DIR, 'uploads', 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return '/uploads/audio/' + name;
}

// 从 Authorization: Bearer <token> 中取出登录态
function currentUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const row = SQL.findSession.get(token);
  return row ? { id: row.id, username: row.username, token } : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  /* 语音消息用到的音频格式 */
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};


/* ============================================================================
 *  第 6 步：路由与业务接口
 * ========================================================================== */
const PUBLIC_DIR = path.join(__dirname, 'public');

async function handleAPI(req, res, url, pathname) {

  /* ---------- 6.1 注册 ---------- */
  if (pathname === '/api/register' && req.method === 'POST') {
    const { username, password } = await readJSON(req);

    const name = String(username || '').trim();
    if (name.length < 2 || name.length > 16) {
      return sendJSON(res, 400, { error: '用户名需 2-16 个字符' });
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(name)) {
      return sendJSON(res, 400, { error: '用户名只能包含中文、字母、数字、下划线' });
    }
    if (String(password || '').length < 4) {
      return sendJSON(res, 400, { error: '密码至少 4 位' });
    }
    if (SQL.findUserByName.get(name)) {
      return sendJSON(res, 409, { error: '该用户名已被注册' });
    }

    const id = createUser(name, String(password));
    SQL.insertProfileColor.run(id, randomColor());   // 注册时随机分配头像底色
    const token = issueToken(id);
    return sendJSON(res, 200, { token, user: { id, username: name } });
  }

  /* ---------- 6.2 登录 ---------- */
  if (pathname === '/api/login' && req.method === 'POST') {
    const { username, password } = await readJSON(req);
    const user = verifyUser(String(username || '').trim(), String(password || ''));
    if (!user) return sendJSON(res, 401, { error: '用户名或密码不正确' });

    const token = issueToken(user.id);
    return sendJSON(res, 200, { token, user });
  }

  /* ---------- 6.3 退出登录 ---------- */
  if (pathname === '/api/logout' && req.method === 'POST') {
    const me = currentUser(req);
    if (me) SQL.deleteSession.run(me.token);
    return sendJSON(res, 200, { ok: true });
  }

  /* ---------- 6.4 以下是需要登录的接口 ---------- */
  const me = currentUser(req);
  if (!me) return sendJSON(res, 401, { error: '未登录或登录已过期' });

  // 校验 token 是否有效（前端刷新页面时先调它）
  if (pathname === '/api/me' && req.method === 'GET') {
    const p = SQL.getProfile.get(me.id) || {};
    return sendJSON(res, 200, {
      user: { id: me.id, username: me.username },
      profile: {
        display_name: p.display_name || '',
        birthday: p.birthday || '',
        school: p.school || '',
        address: p.address || '',
        avatar: p.avatar || '',
        color: p.color || '',
      },
    });
  }

  // 账号列表（除自己以外的所有人 + 未读数 + 最后一条消息摘要）
  if (pathname === '/api/users' && req.method === 'GET') {
    const rows = SQL.listUsers.all(me.id, me.id, me.id, me.id, me.id, me.id);
    return sendJSON(res, 200, { users: rows });
  }

  // 拉取与某个人的历史消息（顺带把对方发来的消息标记为已读）
  if (pathname === '/api/messages' && req.method === 'GET') {
    const peerId = Number(url.searchParams.get('peerId'));
    if (!Number.isInteger(peerId) || peerId <= 0) {
      return sendJSON(res, 400, { error: 'peerId 不合法' });
    }
    if (!SQL.findUserById.get(peerId)) {
      return sendJSON(res, 404, { error: '用户不存在' });
    }
    const rows = SQL.conversation.all(me.id, peerId, peerId, me.id);
    SQL.markRead.run(peerId, me.id);
    return sendJSON(res, 200, { messages: rows });
  }

  // 发送消息（支持文字 text、图片 image、语音 audio 三种类型）
  if (pathname === '/api/messages' && req.method === 'POST') {
    const body = await readJSON(req);
    const peerId = Number(body.toUserId);
    let type = 'text';
    if (body.type === 'image') type = 'image';
    else if (body.type === 'audio') type = 'audio';
    const text = String(body.content || '').trim();

    if (!Number.isInteger(peerId) || !SQL.findUserById.get(peerId)) {
      return sendJSON(res, 400, { error: '接收人不存在' });
    }

    if (type === 'image') {
      // 图片消息：content 必须是本服务自己生成的 /uploads/ 路径，杜绝任意文件读取
      if (!/^\/uploads\/[a-zA-Z0-9_./-]+\.(png|jpe?g|gif|webp)$/i.test(text)) {
        return sendJSON(res, 400, { error: '图片地址不合法' });
      }
    } else if (type === 'audio') {
      // 语音消息：同样只允许本服务上传目录里的音频文件
      if (!/^\/uploads\/[a-zA-Z0-9_./-]+\.(webm|ogg|m4a|mp3|wav)$/i.test(text)) {
        return sendJSON(res, 400, { error: '语音地址不合法' });
      }
    } else {
      if (!text) return sendJSON(res, 400, { error: '消息不能为空' });
      if (text.length > 1000) return sendJSON(res, 400, { error: '消息最长 1000 字' });
    }

    const info = SQL.insertMessage.run(me.id, peerId, text, type, nowISO());
    return sendJSON(res, 200, {
      message: {
        id: Number(info.lastInsertRowid),
        sender_id: me.id,
        receiver_id: peerId,
        content: text,
        type: type,
        created_at: nowISO(),
      },
    });
  }

  /* ---------- 6.5 个人资料保存 ---------- */
  if (pathname === '/api/profile' && req.method === 'PUT') {
    const b = await readJSON(req);
    const cur = SQL.getProfile.get(me.id) || {};
    const display_name = String(b.display_name ?? cur.display_name ?? '').slice(0, 20);
    const birthday = String(b.birthday ?? cur.birthday ?? '').slice(0, 20) || null;
    const school = String(b.school ?? cur.school ?? '').slice(0, 50) || null;
    const address = String(b.address ?? cur.address ?? '').slice(0, 100) || null;
    const avatar = cur.avatar || '';
    SQL.upsertProfile.run(me.id, display_name, birthday, school, address, avatar);
    return sendJSON(res, 200, { ok: true });
  }

  /* ---------- 6.6 头像上传 ---------- */
  if (pathname === '/api/avatar' && req.method === 'POST') {
    const b = await readJSON(req);
    let relPath;
    try {
      relPath = saveImageDataURL(b.image, 'avatars');
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    SQL.ensureProfile.run(me.id);
    SQL.setAvatar.run(relPath, me.id);
    return sendJSON(res, 200, { avatar: relPath });
  }

  /* ---------- 6.7 表情包（用户自己的图片表情） ---------- */
  if (pathname === '/api/stickers' && req.method === 'GET') {
    const rows = SQL.listStickers.all(me.id);
    return sendJSON(res, 200, {
      stickers: rows.map((r) => ({ id: r.id, image_path: r.image_path })),
    });
  }
  if (pathname === '/api/stickers' && req.method === 'POST') {
    const b = await readJSON(req);
    let relPath;
    try {
      relPath = saveImageDataURL(b.image, 'stickers');
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    const info = SQL.insertSticker.run(me.id, relPath, nowISO());
    return sendJSON(res, 200, {
      sticker: { id: Number(info.lastInsertRowid), image_path: relPath },
    });
  }
  if (pathname === '/api/stickers' && req.method === 'DELETE') {
    const b = await readJSON(req);
    SQL.deleteSticker.run(Number(b.id), me.id);
    return sendJSON(res, 200, { ok: true });
  }

  /* ---------- 6.8 语音上传 ---------- */
  if (pathname === '/api/audio' && req.method === 'POST') {
    const b = await readJSON(req);
    let relPath;
    try {
      relPath = saveAudioDataURL(b.audio);
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    return sendJSON(res, 200, { audio: relPath });
  }

  /* ---------- 6.9 查看他人资料 ---------- */
  const mProf = /^\/api\/users\/(\d+)\/profile$/.exec(pathname);
  if (mProf && req.method === 'GET') {
    const uid = Number(mProf[1]);
    const u = SQL.findUserById.get(uid);
    if (!u) return sendJSON(res, 404, { error: '用户不存在' });
    const p = SQL.getProfile.get(uid) || {};
    return sendJSON(res, 200, {
      profile: {
        id: uid,
        username: u.username,
        display_name: p.display_name || u.username,
        birthday: p.birthday || '',
        school: p.school || '',
        address: p.address || '',
        avatar: p.avatar || '',
        color: p.color || '',
        created_at: u.created_at,
      },
    });
  }

  return sendJSON(res, 404, { error: '接口不存在' });
}

// 静态文件服务：把 public/ 目录映射到根路径
function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;

  // 安全防护：去掉 .. 防止通过 ../../ 读到 public 以外的文件
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 页面不存在');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}


/* ============================================================================
 *  第 7 步：启动服务
 * ========================================================================== */
const PORT = Number(process.env.PORT) || 8000;
const HOST = '0.0.0.0';   // ★ 关键：绑定 0.0.0.0 而不是 127.0.0.1，局域网其他设备才能访问

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      await handleAPI(req, res, url, pathname);
    } else {
      serveStatic(res, pathname);
    }
  } catch (err) {
    console.error('[错误]', err.message);
    if (!res.headersSent) sendJSON(res, 500, { error: '服务器内部错误' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[启动失败] 端口 ${PORT} 已被占用。`);
    console.error(`  换个端口启动：PORT=8001 node server.js\n`);
    process.exit(1);
  }
  throw err;
});

// 优雅退出：Ctrl+C 时把数据库文件正常关闭，保证 WAL 日志合并回主文件
function shutdown() {
  console.log('\n[退出] 正在关闭数据库…');
  try { db.close(); } catch { /* 已关闭则忽略 */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  // 列出本机所有局域网 IPv4，直接告诉使用者该用哪个地址
  const os = require('node:os');
  const lanIPs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) lanIPs.push(it.address);
    }
  }

  console.log('\n============================================================');
  console.log('  聊天系统已启动  ·  chatWB20261103');
  console.log('============================================================');
  console.log(`  本机访问    : http://127.0.0.1:${PORT}`);
  lanIPs.forEach((ip) => console.log(`  局域网访问  : http://${ip}:${PORT}`));
  console.log(`  数据库文件  : ${DB_FILE}`);
  console.log('------------------------------------------------------------');
  console.log('  同一 WiFi / 局域网下的手机、电脑直接用上面的局域网地址打开');
  console.log('  如打不开，请在 Windows 防火墙里允许 Node.js 通过（专用网络）');
  console.log('  停止服务    : 按 Ctrl + C');
  console.log('============================================================\n');
});

/* ============================================================================
   轻聊 · 浏览器端 SQLite 数据层（GitHub Pages / Surge 静态托管版）
   ----------------------------------------------------------------------------
   为什么需要这一层？
     GitHub Pages、Surge 只能托管静态文件，跑不了 Node 进程。
     所以这里把「SQLite 数据库」整个搬进浏览器：
       · sql.js  →  SQLite 编译成的 WebAssembly，真正的 SQLite 引擎
       · IndexedDB → 把数据库文件的二进制存下来，刷新页面数据还在
       · WebCrypto → PBKDF2 密码哈希（和服务器版的 scrypt 同理，都是加盐慢哈希）

   和服务器版的关系：
     · 表结构、SQL 语句、接口字段名完全一致
     · 服务器版走 HTTP，这一版直接调用本地 SQL，所以 app-local.js 只换了 api() 的实现
   ========================================================================== */

(function () {
  'use strict';

  var DB_NAME = 'chatwb';
  var STORE   = 'kv';
  var KEY     = 'db';

  var sqlDb = null;          // sql.js 的 Database 实例
  var SQL = null;            // sql.js 模块
  var channel = null;        // 多标签页同步
  var persistTimer = null;

  /* ============================================================
     一、IndexedDB：保存/读取数据库文件本身
     ============================================================ */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      });
    });
  }

  function idbPut(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ============================================================
     二、把内存里的数据库导出成二进制存起来
     ============================================================ */
  function persist() {
    if (!sqlDb) return Promise.resolve();
    var bytes = sqlDb.export();
    return idbPut(KEY, bytes).then(function () {
      // 通知其他标签页：数据库变了
      if (channel) channel.postMessage('changed');
    });
  }

  // 频繁写入时合并成一次，避免每次都序列化整个库
  function persistSoon() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () { persistTimer = null; persist(); }, 60);
  }

  /* ============================================================
     三、SQL 辅助函数（用法和 Node 的 node:sqlite 一模一样）
     ============================================================ */
  function all(sql, params) {
    var st = sqlDb.prepare(sql);
    if (params && params.length) st.bind(params);
    var out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }

  function get(sql, params) {
    var rows = all(sql, params);
    return rows[0];
  }

  function run(sql, params) {
    sqlDb.run(sql, params || []);
  }

  function lastId() {
    var r = sqlDb.exec('SELECT last_insert_rowid() AS id');
    return r[0].values[0][0];
  }

  /* ============================================================
     四、密码哈希（PBKDF2-SHA256，10 万次迭代 + 随机盐）
     ============================================================ */
  function toHex(bytes) {
    return Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function fromHex(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function randomHex(n) {
    var b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return toHex(b);
  }

  function hashPwd(password, saltHex) {
    var enc = new TextEncoder();
    return crypto.subtle
      .importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits({
          name: 'PBKDF2',
          salt: fromHex(saltHex),
          iterations: 100000,
          hash: 'SHA-256',
        }, key, 256);
      })
      .then(function (bits) { return toHex(new Uint8Array(bits)); });
  }

  /* ============================================================
     五、建表（和 server.js 里的结构完全一致）
     ============================================================ */
  var SCHEMA = [
    'CREATE TABLE IF NOT EXISTS users (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  username TEXT NOT NULL UNIQUE COLLATE NOCASE,',
    '  password_hash TEXT NOT NULL,',
    '  salt TEXT NOT NULL,',
    '  created_at TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS messages (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  sender_id INTEGER NOT NULL,',
    '  receiver_id INTEGER NOT NULL,',
    '  content TEXT NOT NULL,',
    '  is_read INTEGER NOT NULL DEFAULT 0,',
    '  created_at TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS sessions (',
    '  token TEXT PRIMARY KEY,',
    '  user_id INTEGER NOT NULL,',
    '  created_at TEXT NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id, id);',
  ].join('\n');

  function nowISO() { return new Date().toISOString(); }

  // 首次打开时放三个演示账号，省得对着空页面发呆
  function seed() {
    var users = [
      ['小明', '123456'],
      ['小红', '123456'],
      ['阿杰', '123456'],
    ];

    return users.reduce(function (chain, u) {
      return chain.then(function () {
        var salt = randomHex(16);
        return hashPwd(u[1], salt).then(function (hash) {
          run('INSERT INTO users (username, password_hash, salt, created_at) VALUES (?,?,?,?)',
            [u[0], hash, salt, nowISO()]);
        });
      });
    }, Promise.resolve()).then(function () {
      var ids = all('SELECT id, username FROM users');
      var idOf = {};
      ids.forEach(function (r) { idOf[r.username] = r.id; });

      var convo = [
        [idOf['小明'], idOf['小红'], '小红，明天的网页作业你做到哪了？'],
        [idOf['小红'], idOf['小明'], '刚把登录页写完，正在调样式 😂'],
        [idOf['小明'], idOf['小红'], '我这边数据库已经通了，账号能存进 SQLite'],
        [idOf['小红'], idOf['小明'], '厉害！这个在线版是真的跑 SQLite 吗'],
        [idOf['小明'], idOf['小红'], '真的，SQLite 编译成 WebAssembly 跑在你浏览器里'],
        [idOf['阿杰'], idOf['小明'], '晚上一起调试一下？'],
      ];
      convo.forEach(function (m) {
        run('INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?,?,?,?)',
          [m[0], m[1], m[2], nowISO()]);
      });
    });
  }

  /* ============================================================
     六、初始化
     ============================================================ */
  var readyPromise = (function () {
    if (typeof initSqlJs !== 'function') {
      return Promise.reject(new Error('sql.js 未加载'));
    }

    return initSqlJs({ locateFile: function (f) { return 'vendor/' + f; } })
      .then(function (mod) {
        SQL = mod;
        return idbGet(KEY);
      })
      .then(function (saved) {
        if (saved) {
          sqlDb = new SQL.Database(new Uint8Array(saved));
        } else {
          sqlDb = new SQL.Database();
          sqlDb.exec(SCHEMA);
          return seed().then(function () { return persist(); });
        }
      })
      .then(function () {
        // 多标签页同步：别的标签写入了，这边重新载入
        if (typeof BroadcastChannel === 'function') {
          channel = new BroadcastChannel('chatwb-db');
          channel.onmessage = function () {
            idbGet(KEY).then(function (bytes) {
              if (bytes) sqlDb = new SQL.Database(new Uint8Array(bytes));
            });
          };
        }
        return true;
      });
  })();

  /* ============================================================
     七、接口路由：路径和响应格式与 server.js 完全一致
     ============================================================ */
  function auth(token) {
    if (!token) { var e = new Error('未登录或登录已过期'); e.auth = true; throw e; }
    var row = get(
      'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
      [token]
    );
    if (!row) { var e2 = new Error('未登录或登录已过期'); e2.auth = true; throw e2; }
    return row;
  }

  function issueToken(userId) {
    var t = randomHex(24);
    run('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)', [t, userId, nowISO()]);
    return t;
  }

  function handle(path, method, body, token) {
    return readyPromise.then(function () {
      var url = path.split('?')[0];
      var query = path.indexOf('?') >= 0 ? path.slice(path.indexOf('?') + 1) : '';

      /* ---- 注册 ---- */
      if (url === '/api/register' && method === 'POST') {
        var name = String((body && body.username) || '').trim();
        var pwd = String((body && body.password) || '');

        if (name.length < 2 || name.length > 16) throw new Error('用户名需 2-16 个字符');
        if (!/^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(name)) throw new Error('用户名只能包含中文、字母、数字、下划线');
        if (pwd.length < 4) throw new Error('密码至少 4 位');
        if (get('SELECT id FROM users WHERE username = ?', [name])) throw new Error('该用户名已被注册');

        var salt = randomHex(16);
        return hashPwd(pwd, salt).then(function (hash) {
          run('INSERT INTO users (username, password_hash, salt, created_at) VALUES (?,?,?,?)',
            [name, hash, salt, nowISO()]);
          var id = lastId();
          var tk = issueToken(id);
          persistSoon();
          return { token: tk, user: { id: id, username: name } };
        });
      }

      /* ---- 登录 ---- */
      if (url === '/api/login' && method === 'POST') {
        var n2 = String((body && body.username) || '').trim();
        var p2 = String((body && body.password) || '');
        var user = get('SELECT * FROM users WHERE username = ?', [n2]);
        if (!user) throw new Error('用户名或密码不正确');

        return hashPwd(p2, user.salt).then(function (h) {
          if (h !== user.password_hash) throw new Error('用户名或密码不正确');
          var tk2 = issueToken(user.id);
          persistSoon();
          return { token: tk2, user: { id: user.id, username: user.username } };
        });
      }

      /* ---- 退出 ---- */
      if (url === '/api/logout' && method === 'POST') {
        if (token) run('DELETE FROM sessions WHERE token = ?', [token]);
        persistSoon();
        return { ok: true };
      }

      /* ---- 以下需要登录 ---- */
      var me = auth(token);

      if (url === '/api/me' && method === 'GET') {
        return { user: { id: me.id, username: me.username } };
      }

      /* ---- 账号列表 ---- */
      if (url === '/api/users' && method === 'GET') {
        var rows = all([
          'SELECT u.id, u.username, u.created_at,',
          '  (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.is_read = 0) AS unread,',
          '  (SELECT m2.content FROM messages m2',
          '     WHERE (m2.sender_id = u.id AND m2.receiver_id = ?)',
          '        OR (m2.sender_id = ? AND m2.receiver_id = u.id)',
          '     ORDER BY m2.id DESC LIMIT 1) AS last_message',
          'FROM users u WHERE u.id <> ?',
          'ORDER BY unread DESC, u.username ASC',
        ].join('\n'), [me.id, me.id, me.id, me.id]);
        return { users: rows };
      }

      /* ---- 历史消息 ---- */
      if (url === '/api/messages' && method === 'GET') {
        var m = /peerId=(\d+)/.exec(query);
        var peerId = m ? Number(m[1]) : NaN;
        if (!peerId) throw new Error('peerId 不合法');
        if (!get('SELECT id FROM users WHERE id = ?', [peerId])) throw new Error('用户不存在');

        var list = all([
          'SELECT id, sender_id, receiver_id, content, created_at FROM messages',
          'WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
          'ORDER BY id ASC LIMIT 500',
        ].join('\n'), [me.id, peerId, peerId, me.id]);

        run('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
          [peerId, me.id]);
        persistSoon();
        return { messages: list };
      }

      /* ---- 发消息 ---- */
      if (url === '/api/messages' && method === 'POST') {
        var to = Number(body && body.toUserId);
        var text = String((body && body.content) || '').trim();
        if (!to || !get('SELECT id FROM users WHERE id = ?', [to])) throw new Error('接收人不存在');
        if (!text) throw new Error('消息不能为空');
        if (text.length > 1000) throw new Error('消息最长 1000 字');

        run('INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?,?,?,?)',
          [me.id, to, text, nowISO()]);
        var mid = lastId();
        persistSoon();
        return {
          message: { id: mid, sender_id: me.id, receiver_id: to, content: text, created_at: nowISO() },
        };
      }

      throw new Error('接口不存在');
    });
  }

  window.LocalDB = { handle: handle, ready: readyPromise };
})();

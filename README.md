# 轻聊 · 局域网聊天系统（chatWB20261103）

一个**零第三方依赖**的局域网聊天系统。数据全部存在本机 SQLite 文件里，不经过任何云服务。

---

## 一、怎么启动

```bash
node server.js
```

或者直接双击 **`启动.bat`**。

启动后控制台会打印访问地址：

| 场景 | 地址 |
| --- | --- |
| 本机 | `http://127.0.0.1:8000` |
| 局域网（手机 / 同学电脑） | `http://<本机IP>:8000` |

> 如果局域网设备打不开，多半是 Windows 防火墙拦了。第一次运行 Node 时弹窗请选择**允许**，且勾上**专用网络**。

---

## 二、技术栈说明（为什么必须是这三种语言）

要求限定 HTML5 / CSS3 / JavaScript，所以架构是这样拆的：

```
浏览器（纯 html5 + css3 + js）
        │  fetch /api/*，JSON 收发
        ▼
Node.js 服务（JavaScript）      ← 就是 server.js
        │  node:sqlite
        ▼
SQLite 数据库文件  data/chat.db
```

**为什么不能纯前端直接读 SQLite？**
浏览器的安全沙箱不允许网页访问本地文件系统，更不可能打开一个 `.db` 文件。所以必须要有一个本地的服务端进程替浏览器读写数据库。Node.js 本身就是 JavaScript 运行时，`server.js` 全文是 JS——三种语言的约束没有被打破。

**为什么不用 Express / better-sqlite3？**
Node.js 22 已经内置了 `node:sqlite`，标准库直接就是数据库驱动，`npm install` 一个包都不用装。拷到任何装了 Node 22+ 的机器上都能跑，运维成本最低。

---

## 三、数据库连接代码讲解（重点）

全部集中在 `server.js` 的「第 1 步：数据库连接」注释区，这里再提炼一遍：

### 1. 连接只有一行

```js
const db = new DatabaseSync('.../data/chat.db');
```

SQLite 是**嵌入式**数据库——没有服务进程、没有账号密码、没有端口。数据就是一个普通文件。
- 文件不存在 → SQLite 自动创建；
- 文件存在 → 直接打开。

`DatabaseSync` 是同步 API：调用会阻塞当前线程直到 SQL 执行完。好处是代码是"一行接一行"的顺序逻辑，不用 `await`、不用回调嵌套。局域网几十人聊天完全够用。

**关键原则：整个进程只创建一个 `db` 对象，全局复用。** 不要每个请求都 `new` 一次，否则会反复打开文件句柄，既慢又容易锁库。

### 2. 打开后先设三条 PRAGMA

```js
PRAGMA journal_mode = WAL;   // 读写日志分离，读不阻塞写，聊天不卡
PRAGMA foreign_keys = ON;    // 外键约束，SQLite 默认是关的，必须手动开
PRAGMA busy_timeout = 5000;  // 遇到锁最多等 5 秒，而不是立刻抛异常
```

### 3. 所有 SQL 都用 `?` 占位符 + 参数绑定

```js
// ✅ 正确：SQL 结构固定，值单独传入
db.prepare('SELECT * FROM users WHERE username = ?').get(name);

// ❌ 错误：字符串拼接 = SQL 注入漏洞
db.exec(`SELECT * FROM users WHERE username='${name}'`);
```

预编译后，值会被当作**纯数据**，绝不会被解析成 SQL 语句。用户在用户名里写 `' OR 1=1 --` 也只是一个普通字符串。

### 4. prepare / run / get / all 的区别

| 方法 | 用途 | 返回 |
| --- | --- | --- |
| `db.prepare(sql)` | 预编译，缓存起来重复用 | Statement 对象 |
| `.run(...)` | 执行 INSERT / UPDATE / DELETE | `{ changes, lastInsertRowid }` |
| `.get(...)` | 取第一行 | 一个对象，没有则 `undefined` |
| `.all(...)` | 取多行 | 对象数组 |

本项目在「第 3 步」把所有常用 SQL 预编译进一个 `SQL` 常量对象，请求到来时直接调用，省去重复解析。

### 5. 退出时关掉连接

```js
process.on('SIGINT', shutdown);   // Ctrl+C
db.close();
```

之所以要显式 `close()`，是因为 WAL 模式下新写入的数据先落在 `-wal` 日志文件里，正常关闭才会合并回主库。直接杀进程理论上也不丢数据（下次启动会自动恢复），但正常关闭更干净。

---

## 四、数据库表结构

### users（账号）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | 自增主键 |
| username | TEXT UNIQUE | 用户名，`COLLATE NOCASE` 不区分大小写 |
| password_hash | TEXT | scrypt 哈希，**不存明文** |
| salt | TEXT | 每用户一份随机盐 |
| created_at | TEXT | ISO 时间字符串 |

**密码为什么不存明文？**
注册时生成 16 字节随机盐 → `scrypt(密码, 盐)` → 存哈希。同一个密码，两个用户的哈希结果完全不同（挡住彩虹表）。校验时用同样的盐再算一次，用 `crypto.timingSafeEqual` 做等长恒时比较，避免通过响应时间反推密码。

### messages（消息）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | 自增，等价于时间顺序 |
| sender_id | INTEGER FK | 发送者，外键指向 users.id |
| receiver_id | INTEGER FK | 接收者，外键指向 users.id |
| content | TEXT | 正文 |
| is_read | INTEGER | 0 未读 / 1 已读 |
| created_at | TEXT | ISO 时间字符串 |

索引：`(sender_id, receiver_id, id)` 加速双人对话查询；`(receiver_id, is_read)` 加速未读数统计。

### sessions（登录态）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| token | TEXT PK | 随机 48 位十六进制 |
| user_id | INTEGER FK | 属于谁 |
| created_at | TEXT | 签发时间 |

存在数据库而不是内存里，好处是**重启服务后用户不用重新登录**。

---

## 五、接口清单

| 方法 | 路径 | 说明 | 需要登录 |
| --- | --- | --- | --- |
| POST | `/api/register` | 注册，直接返回 token | 否 |
| POST | `/api/login` | 登录 | 否 |
| POST | `/api/logout` | 退出，删除 token | 是 |
| GET | `/api/me` | 校验 token 是否有效 | 是 |
| GET | `/api/users` | 所有账号 + 未读数 + 最后一条消息 | 是 |
| GET | `/api/messages?peerId=` | 和某人的历史消息（顺带置已读） | 是 |
| POST | `/api/messages` | 发消息 `{ toUserId, content }` | 是 |

登录后的接口从请求头读 token：`Authorization: Bearer <token>`。

---

## 六、运维

**改端口**
```bash
PORT=8001 node server.js          # macOS / Linux / Git Bash
set PORT=8001 && node server.js   # Windows CMD
```

**备份数据库**：停服务后拷走 `data/chat.db` 即可（WAL 模式下建议同时拷 `chat.db-wal`、`chat.db-shm`，或停服务后再拷）。

**清空全部数据（重置）**：停服务，删掉 `data/` 目录，重新启动会自动重建空库。

**查看数据**（本机已装 sqlite3 命令行）：
```bash
sqlite3 data/chat.db ".tables"
sqlite3 data/chat.db "SELECT id, username, created_at FROM users;"
sqlite3 data/chat.db "SELECT * FROM messages ORDER BY id DESC LIMIT 10;"
```

**手机连不上？** 按顺序排查：
1. 手机和电脑是否在同一个 WiFi / 局域网；
2. 用的地址是不是控制台打印的**局域网**那个（`10.x.x.x` 开头），不是 `127.0.0.1`；
3. Windows 防火墙是否放行了 Node.js（专用网络）；
4. 电脑的 IP 是否变了（DHCP 重新分配），重启服务看新的打印。

---

## 七、用 Navicat / DBeaver 等图形工具查看数据库

命令行看数据不够直观时，可以用 Navicat 连接这个 `.db` 文件。

### 连接步骤

1. Navicat → 左上角「连接」→ 选 **SQLite**
2. **连接名**：随便填
3. **类型**：现有的数据库文件
4. **数据库文件**：选到 `data/chat.db`
5. **用户名 / 密码：全部留空** —— SQLite 是文件型数据库，没有账号体系。
   填了密码反而可能被当成 SQLCipher 加密密钥，导致打不开。

### 报错 `14 - unable to open database file` 怎么解决

这个错误是 SQLite 的 `SQLITE_CANTOPEN`，意思就是"文件打不开"，常见三个原因，按顺序排查：

**① 路径里有中文（最常见）**

`web课训练文件夹` 这类中文目录名，在中文 Windows 下 Navicat 可能按 GBK 传路径，而 SQLite 期望 UTF-8，结果路径解析成乱码 → 找不到文件 → 报 14。

解决办法：给数据库目录做一个**纯英文的目录联接**（不是复制，指向同一个文件）：

```cmd
mklink /J C:\Users\Admin\chatdb "C:\Users\Admin\Desktop\web课训练文件夹\chatWB20261103\data"
```

之后 Navicat 里把「数据库文件」改成：

```
C:\Users\Admin\chatdb\chat.db
```

> 目录联接（junction）不需要管理员权限。注意：如果以后移动了项目文件夹，联接会失效，重新执行一次 `mklink /J` 即可。

**② 文件被服务进程占用**

`server.js` 正在运行时，`chat.db` 是被打开的。虽然 SQLite 支持多进程共享读，但 Navicat 在 Windows 上偶尔会拿不到句柄。先在运行服务的窗口按 `Ctrl + C` 停掉，再连接。

**③ WAL 日志残留**

`server.js` 用的是 WAL 模式，运行期间会生成 `chat.db-wal`、`chat.db-shm`。正常停服务（`Ctrl+C`）后这两个文件会自动消失；如果是强制结束进程，可能残留。残留时手动删掉这两个文件也不会丢数据（数据已合并进 `chat.db`）。

**备份的正确姿势**：WAL 模式下如果直接拷 `chat.db`，可能拷到一个几乎空的文件（数据还在 `-wal` 里）。要么**先停服务**再拷，要么三个文件一起拷，要么先执行：

```bash
sqlite3 data/chat.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

把日志合并回主文件后再拷。

### 连上之后能看到什么

| 表 | 说明 |
| --- | --- |
| `users` | 账号。`password_hash` 是 scrypt 哈希，看不到明文密码（这是设计如此） |
| `messages` | 聊天记录。`sender_id` / `receiver_id` 对应 `users.id` |
| `sessions` | 登录态 token。删掉某一行等于让那个登录失效 |

> 直接在 Navicat 里改数据是可以的，但改完记得刷新浏览器页面；改 `users` 表时不要动 `password_hash` 和 `salt`，否则那个账号会登不进去。

---

## 八、目录

```
chatWB20261103/
├── server.js          HTTP 服务 + 接口 + 数据库访问（全文带注释）
├── 启动.bat           Windows 一键启动
├── README.md          本文件
├── public/
│   ├── index.html     页面结构
│   ├── style.css      样式
│   └── app.js         交互逻辑
└── data/
    └── chat.db        SQLite 数据库（自动生成）
```

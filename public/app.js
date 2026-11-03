/* ============================================================================
   轻聊 · 前端逻辑（纯 JavaScript，无任何框架）
   ----------------------------------------------------------------------------
   和后端的协作方式：所有数据都走 /api/* 的 JSON 接口；
   登录成功后后端返回一个 token，前端存在 localStorage，之后每次请求都带上
   Authorization: Bearer <token> 头。
   消息更新用"轮询"实现（每 2.5 秒拉一次），代码量最小、最容易维护。
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 状态 */
  var token = localStorage.getItem('chat_token') || '';
  var me = null;              // { id, username }
  var users = [];             // 全部账号
  var peer = null;            // 当前对话的人
  var lastMsgId = 0;          // 已渲染的最后一条消息 id，用于增量追加
  var authMode = 'login';     // 'login' | 'register'
  var pollTimer = null;       // 轮询定时器
  var busy = false;           // 防重复提交

  /* ---------------------------------------------------------------- 元素 */
  var $ = function (id) { return document.getElementById(id); };

  var authView    = $('authView');
  var chatView    = $('chatView');
  var authForm    = $('authForm');
  var authMsg     = $('authMsg');
  var authSubmit  = $('authSubmit');
  var usernameEl  = $('username');
  var passwordEl  = $('password');

  var myAvatar    = $('myAvatar');
  var myName      = $('myName');
  var logoutBtn   = $('logoutBtn');
  var userListEl  = $('userList');

  var emptyState  = $('emptyState');
  var conversation= $('conversation');
  var backBtn     = $('backBtn');
  var peerAvatar  = $('peerAvatar');
  var peerName    = $('peerName');
  var messageList = $('messageList');
  var sendForm    = $('sendForm');
  var messageInput= $('messageInput');
  var sendBtn     = $('sendBtn');

  /* ================================================================
     一、通用请求封装
     ================================================================ */
  function api(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          // 登录态失效：清掉本地 token，退回登录页
          if (res.status === 401) {
            doLogout(true);
          }
          throw new Error(data.error || ('请求失败 ' + res.status));
        }
        return data;
      });
    });
  }

  /* ================================================================
     二、登录 / 注册
     ================================================================ */
  // 切换 登录 / 注册 标签
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      authMode = tab.dataset.mode;
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      authSubmit.textContent = authMode === 'login' ? '登 录' : '注 册 并 登 录';
      authMsg.textContent = '';
    });
  });

  authForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    var username = usernameEl.value.trim();
    var password = passwordEl.value;

    if (!username || !password) {
      authMsg.textContent = '请填写用户名和密码';
      return;
    }

    busy = true;
    authSubmit.disabled = true;
    authMsg.textContent = '';

    var isLogin = authMode === 'login';
    api(isLogin ? '/api/login' : '/api/register', {
      method: 'POST',
      body: { username: username, password: password }
    }).then(function (data) {
      token = data.token;
      me = data.user;
      localStorage.setItem('chat_token', token);
      localStorage.setItem('chat_user', JSON.stringify(me));

      passwordEl.value = '';
      enterChat();
    }).catch(function (err) {
      authMsg.textContent = err.message;
    }).finally(function () {
      busy = false;
      authSubmit.disabled = false;
    });
  });

  logoutBtn.addEventListener('click', function () {
    doLogout(false);
  });

  // 手机端返回列表
  backBtn.addEventListener('click', function () {
    peer = null;
    lastMsgId = 0;
    lastRenderDay = '';
    messageList.innerHTML = '';
    conversation.classList.add('hidden');
    emptyState.classList.remove('hidden');
    chatView.classList.remove('conv-open');
    renderUsers();
  });

  function doLogout(silent) {
    if (token && !silent) {
      api('/api/logout', { method: 'POST' }).catch(function () { /* 忽略 */ });
    }
    token = '';
    me = null;
    peer = null;
    users = [];
    lastMsgId = 0;
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');

    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    chatView.classList.add('hidden');
    chatView.classList.remove('conv-open');
    authView.classList.remove('hidden');
    messageList.innerHTML = '';
    userListEl.innerHTML = '';
    conversation.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }

  /* ================================================================
     三、进入聊天界面
     ================================================================ */
  function enterChat() {
    authView.classList.add('hidden');
    chatView.classList.remove('hidden');

    myName.textContent = me.username;
    myAvatar.textContent = me.username.slice(0, 1).toUpperCase();

    refreshUsers();

    // 轮询：每 2.5 秒同步一次列表和当前对话（局域网内几乎无延迟感）
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 2500);
  }

  function poll() {
    if (!token) return;
    refreshUsers();
    if (peer) refreshMessages();
  }

  /* ================================================================
     四、账号列表
     ================================================================ */
  function refreshUsers() {
    api('/api/users').then(function (data) {
      users = data.users || [];
      renderUsers();
    }).catch(function () { /* 网络抖动时静默重试 */ });
  }

  function renderUsers() {
    if (!users.length) {
      userListEl.innerHTML =
        '<li class="list-empty">还没有其他账号<br>让同学在浏览器里打开同一地址注册一个吧</li>';
      return;
    }

    userListEl.innerHTML = users.map(function (u) {
      var isActive = peer && peer.id === u.id;
      var initial = u.username.slice(0, 1).toUpperCase();
      var preview = u.last_message
        ? escapeHTML(u.last_message).slice(0, 30)
        : '还没有聊天记录';

      return '' +
        '<li class="user-item' + (isActive ? ' active' : '') + '" data-id="' + u.id + '">' +
          '<div class="avatar">' + escapeHTML(initial) + '</div>' +
          '<div class="user-body">' +
            '<div class="user-row">' +
              '<span class="user-name">' + escapeHTML(u.username) + '</span>' +
              (u.unread > 0 ? '<span class="badge">' + u.unread + '</span>' : '') +
            '</div>' +
            '<div class="user-preview">' + preview + '</div>' +
          '</div>' +
        '</li>';
    }).join('');

    // 事件委托：列表是重绘的，不能逐个绑定
    userListEl.querySelectorAll('.user-item').forEach(function (li) {
      li.addEventListener('click', function () {
        var id = Number(li.dataset.id);
        var u = users.filter(function (x) { return x.id === id; })[0];
        if (u) openConversation(u);
      });
    });
  }

  /* ================================================================
     五、打开对话
     ================================================================ */
  function openConversation(user) {
    peer = user;
    lastMsgId = 0;
    lastRenderDay = '';     // 换人时必须重置，否则"今天"这条分隔线会被跳过
    messageList.innerHTML = '';

    emptyState.classList.add('hidden');
    conversation.classList.remove('hidden');
    chatView.classList.add('conv-open');   // 手机上收起左侧列表

    peerName.textContent = user.username;
    peerAvatar.textContent = user.username.slice(0, 1).toUpperCase();

    renderUsers();          // 高亮当前选中项
    refreshMessages();
    messageInput.focus();
  }

  function refreshMessages() {
    if (!peer) return;

    api('/api/messages?peerId=' + peer.id).then(function (data) {
      var list = data.messages || [];

      // 只在有新消息时追加，避免整体重绘导致滚动位置跳动
      var fresh = list.filter(function (m) { return m.id > lastMsgId; });
      if (!fresh.length) return;

      // 如果用户正在往上翻历史记录，就不要硬把他拽回底部
      var nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 120;

      var lastDay = lastRenderDay;
      fresh.forEach(function (m) {
        var day = dayOf(m.created_at);
        if (day !== lastDay) {
          messageList.insertAdjacentHTML('beforeend',
            '<div class="day-divider">' + day + '</div>');
          lastDay = day;
        }
        messageList.insertAdjacentHTML('beforeend', bubbleHTML(m));
        if (m.id > lastMsgId) lastMsgId = m.id;
      });
      lastRenderDay = lastDay;

      if (nearBottom) scrollToBottom();
    }).catch(function () { /* 静默 */ });
  }

  var lastRenderDay = '';

  /* ================================================================
     六、发送消息
     ================================================================ */
  sendForm.addEventListener('submit', function (e) {
    e.preventDefault();
    send();
  });

  // Enter 发送，Shift+Enter 换行
  messageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // 输入框随内容自动长高
  messageInput.addEventListener('input', function () {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 128) + 'px';
  });

  function send() {
    if (!peer || busy) return;
    var text = messageInput.value.trim();
    if (!text) return;

    busy = true;
    sendBtn.disabled = true;

    api('/api/messages', {
      method: 'POST',
      body: { toUserId: peer.id, content: text }
    }).then(function (data) {
      messageInput.value = '';
      messageInput.style.height = 'auto';

      // 本地立即上屏，不用等下一轮轮询
      var m = data.message;
      var day = dayOf(m.created_at);
      if (day !== lastRenderDay) {
        messageList.insertAdjacentHTML('beforeend',
          '<div class="day-divider">' + day + '</div>');
        lastRenderDay = day;
      }
      messageList.insertAdjacentHTML('beforeend', bubbleHTML(m));
      if (m.id > lastMsgId) lastMsgId = m.id;
      scrollToBottom();

      refreshUsers();     // 顺带刷新左侧"最后一条消息"预览
    }).catch(function (err) {
      alert('发送失败：' + err.message);
    }).finally(function () {
      busy = false;
      sendBtn.disabled = false;
      messageInput.focus();
    });
  }

  /* ================================================================
     七、渲染小工具
     ================================================================ */
  function bubbleHTML(m) {
    var mine = me && m.sender_id === me.id;
    return '' +
      '<div class="msg ' + (mine ? 'mine' : 'theirs') + '">' +
        '<div class="bubble">' + escapeHTML(m.content) + '</div>' +
        '<div class="msg-time">' + timeOf(m.created_at) + '</div>' +
      '</div>';
  }

  function scrollToBottom() {
    messageList.scrollTop = messageList.scrollHeight;
  }

  function timeOf(iso) {
    var d = new Date(iso);
    var h = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + mi;
  }

  function dayOf(iso) {
    var d = new Date(iso);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();

    var y = new Date(today.getTime() - 86400000);
    if (sameDay) return '今天';
    if (d.toDateString() === y.toDateString()) return '昨天';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // 转义用户输入，防止 XSS（把 < > & " ' 变成实体）
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ================================================================
     八、页面启动：有本地 token 就自动登录
     ================================================================ */
  (function boot() {
    if (!token) return;

    api('/api/me').then(function (data) {
      me = data.user;
      enterChat();
    }).catch(function () {
      // token 失效，已经由 api() 内部退回登录页
    });
  })();

})();

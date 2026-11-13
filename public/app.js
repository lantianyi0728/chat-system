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
  var myProfile = { display_name:'', birthday:'', school:'', address:'', avatar:'' };
  var stickers = [];          // 我的表情包
  var emojiOpen = false;
  var emojiTab = 'emoji';

  /* 设置 / 壁纸 / 文字样式 / AI */
  var prefs = {
    wallpaper: '', wallpaper_scope: 'me',
    font_size: '14', text_color: '#ffffff', input_bg: '#fbfcfe', font_family: 'system',
    api_base: '', api_key: '', api_model: ''
  };
  var peerWallpaper = '';     // 对方「双方可见」的壁纸
  var recentMsgs = [];        // 最近消息，供 AI 生成回复建议
  var lastSugForId = 0;
  var lastSugTime = 0;
  var suggestBusy = false;
  var pendingSuggestion = '';
  var aiHistory = [];         // 小精灵迷你聊天记录
  var aiBusy = false;

  var FONT_STACKS = {
    system: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    song: '"SimSun","Songti SC",serif',
    kai: '"KaiTi","Kaiti SC","STKaiti",serif',
    hei: '"SimHei","Heiti SC","STHeiti",sans-serif',
    yahei: '"Microsoft YaHei","PingFang SC",sans-serif',
    fangsong: '"FangSong","STFangsong",serif',
    xingkai: '"STXingkai","华文行楷","KaiTi",cursive',
    youyuan: '"YouYuan","幼圆",sans-serif'
  };

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

  /* 个人资料弹窗相关 */
  var meBox         = $('meBox');
  var profileBtn    = $('profileBtn');
  var profileModal  = $('profileModal');
  var profileClose  = $('profileClose');
  var profileCancel = $('profileCancel');
  var profileForm   = $('profileForm');
  var profileMsg    = $('profileMsg');
  var profileAvatar = $('profileAvatar');
  var avatarUploadBtn = $('avatarUploadBtn');
  var avatarInput   = $('avatarInput');
  var pfName        = $('pfName');
  var pfBirthday    = $('pfBirthday');
  var pfSchool      = $('pfSchool');
  var pfAddress     = $('pfAddress');

  /* 表情 / 表情包面板相关 */
  var emojiBtn      = $('emojiBtn');
  var emojiPanel    = $('emojiPanel');
  var emojiGrid     = $('emojiGrid');
  var stickerGrid   = $('stickerGrid');
  var stickerAddBtn = $('stickerAddBtn');
  var stickerInput  = $('stickerInput');
  var stickerList   = $('stickerList');

  /* 查看他人资料 */
  var userInfoModal = $('userInfoModal');
  var userInfoClose = $('userInfoClose');
  var userInfoClose2= $('userInfoClose2');
  var uiAvatar      = $('uiAvatar');
  var uiName        = $('uiName');
  var uiUsername    = $('uiUsername');
  var uiBirthday    = $('uiBirthday');
  var uiSchool      = $('uiSchool');
  var uiAddress     = $('uiAddress');
  var uiCreated     = $('uiCreated');

  /* 语音消息 */
  var voiceBtn      = $('voiceBtn');
  var recHint       = $('recHint');

  /* 加号：照片 / 视频 */
  var plusBtn       = $('plusBtn');
  var plusMenu      = $('plusMenu');
  var pickPhotoBtn  = $('pickPhotoBtn');
  var pickVideoBtn  = $('pickVideoBtn');
  var photoInput    = $('photoInput');
  var videoInput    = $('videoInput');

  /* 聊天设置 */
  var settingsBtn   = $('settingsBtn');
  var settingsBtn2  = $('settingsBtn2');
  var settingsModal = $('settingsModal');
  var settingsClose = $('settingsClose');
  var settingsCancel= $('settingsCancel');
  var settingsSave  = $('settingsSave');
  var settingsMsg   = $('settingsMsg');
  var wallpaperPreview = $('wallpaperPreview');
  var wallpaperUploadBtn = $('wallpaperUploadBtn');
  var wallpaperClearBtn  = $('wallpaperClearBtn');
  var wallpaperInput= $('wallpaperInput');
  var setFontSize   = $('setFontSize');
  var fontSizeVal   = $('fontSizeVal');
  var setTextColor  = $('setTextColor');
  var setInputBg    = $('setInputBg');
  var setFontFamily = $('setFontFamily');
  var setApiBase    = $('setApiBase');
  var setApiKey     = $('setApiKey');
  var setApiModel   = $('setApiModel');

  /* AI 小精灵 */
  var aiSprite      = $('aiSprite');
  var aiSuggestion  = $('aiSuggestion');
  var aiSugText     = $('aiSugText');
  var aiSugSend     = $('aiSugSend');
  var aiSugClose    = $('aiSugClose');
  var aiPanel       = $('aiPanel');
  var aiPanelClose  = $('aiPanelClose');
  var aiMessages    = $('aiMessages');
  var aiForm        = $('aiForm');
  var aiInput       = $('aiInput');

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

    // 退出时把小精灵、建议、壁纸一起收走，别带到下一个人身上
    if (aiSprite) aiSprite.classList.add('hidden');
    if (aiPanel) aiPanel.classList.add('hidden');
    hideSuggestion();
    prefs.wallpaper = '';
    peerWallpaper = '';
    recentMsgs = [];
    lastSugForId = 0;
    aiHistory = [];
    applyWallpaper();
  }

  /* ================================================================
     三、进入聊天界面
     ================================================================ */
  function enterChat() {
    authView.classList.add('hidden');
    chatView.classList.remove('hidden');

    var initial = (me.username || '?').slice(0, 1).toUpperCase();
    myName.textContent = myProfile.display_name || me.username;
    setAvatarEl(myAvatar, myProfile.avatar, initial, myProfile.color);

    buildEmojiGrid();
    refreshUsers();
    loadSettings();                       // 壁纸 / 文字样式 / AI 配置
    if (aiSprite) aiSprite.classList.remove('hidden');

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
      var name = u.display_name || u.username;
      var preview;
      if (u.last_type === 'image') preview = '[图片]';
      else if (u.last_type === 'audio') preview = '[语音]';
      else if (u.last_message) preview = escapeHTML(u.last_message).slice(0, 30);
      else preview = '还没有聊天记录';

      return '' +
        '<li class="user-item' + (isActive ? ' active' : '') + '" data-id="' + u.id + '">' +
          avatarHTML(u.avatar, initial, u.color) +
          '<div class="user-body">' +
            '<div class="user-row">' +
              '<span class="user-name">' + escapeHTML(name) + '</span>' +
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

      // 点头像 = 看资料（阻止冒泡，避免同时打开聊天）
      var av = li.querySelector('.avatar');
      if (av) {
        av.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = Number(li.dataset.id);
          var u = users.filter(function (x) { return x.id === id; })[0];
          if (u) openUserInfo(u);
        });
      }
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

    // 换人：把上一个人的建议、壁纸、上下文全部清掉
    hideSuggestion();
    peerWallpaper = '';
    recentMsgs = [];
    lastSugForId = 0;
    applyWallpaper();

    emptyState.classList.add('hidden');
    conversation.classList.remove('hidden');
    chatView.classList.add('conv-open');   // 手机上收起左侧列表

    var initial = user.username.slice(0, 1).toUpperCase();
    peerName.textContent = user.display_name || user.username;
    setAvatarEl(peerAvatar, user.avatar, initial, user.color);

    renderUsers();          // 高亮当前选中项
    refreshMessages();
    messageInput.focus();
  }

  function refreshMessages() {
    if (!peer) return;

    api('/api/messages?peerId=' + peer.id).then(function (data) {
      var list = data.messages || [];

      // 对方的「双方可见」壁纸：变了才重新上墙，避免每 2.5 秒刷一次背景
      var pw = data.peerWallpaper || '';
      if (pw !== peerWallpaper) {
        peerWallpaper = pw;
        applyWallpaper();
      }

      recentMsgs = list.slice(-8);   // 留给 AI 生成回复建议

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

      // 对方刚发来消息 → 让小精灵偷偷想一句回复
      var lastOne = fresh[fresh.length - 1];
      if (me && lastOne && lastOne.sender_id !== me.id) maybeSuggest();
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
      appendMessage(data.message);   // 本地立即上屏
      refreshUsers();                // 顺带刷新左侧"最后一条消息"预览
    }).catch(function (err) {
      alert('发送失败：' + err.message);
    }).finally(function () {
      busy = false;
      sendBtn.disabled = false;
      messageInput.focus();
    });
  }

  // 把一条消息（含图片）追加到对话区末尾，并维护"天"分隔线与滚动
  function appendMessage(m) {
    var day = dayOf(m.created_at);
    if (day !== lastRenderDay) {
      messageList.insertAdjacentHTML('beforeend', '<div class="day-divider">' + day + '</div>');
      lastRenderDay = day;
    }
    messageList.insertAdjacentHTML('beforeend', bubbleHTML(m));
    if (m.id > lastMsgId) lastMsgId = m.id;
    scrollToBottom();
  }

  // 发送任意类型的媒体消息（图片表情 / 语音 / 照片 / 视频）
  function sendMedia(path, type) {
    if (!peer) { alert('请先选择一个聊天对象'); return; }
    if (busy) return;
    busy = true;
    api('/api/messages', {
      method: 'POST',
      body: { toUserId: peer.id, content: path, type: type }
    }).then(function (data) {
      appendMessage(data.message);
      refreshUsers();
    }).catch(function (err) {
      alert('发送失败：' + err.message);
    }).finally(function () { busy = false; });
  }

  // 直接发送一张图片表情（type=image）
  function sendSticker(path) {
    sendMedia(path, 'image');
  }

  /* ================================================================
     七、渲染小工具
     ================================================================ */
  function bubbleHTML(m) {
    var mine = me && m.sender_id === me.id;
    var body;
    if (m.type === 'image') {
      body = '<div class="bubble bubble-img"><img src="' + escapeHTML(m.content) + '" alt="图片"></div>';
    } else if (m.type === 'audio') {
      body = '<div class="bubble bubble-audio"><audio controls preload="metadata" src="' + escapeHTML(m.content) + '"></audio></div>';
    } else if (m.type === 'video') {
      body = '<div class="bubble bubble-video"><video controls preload="metadata" playsinline src="' +
             escapeHTML(m.content) + '"></video></div>';
    } else {
      body = '<div class="bubble">' + escapeHTML(m.content) + '</div>';
    }
    return '' +
      '<div class="msg ' + (mine ? 'mine' : 'theirs') + '">' +
        body +
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
      myProfile = data.profile || { display_name:'', birthday:'', school:'', address:'', avatar:'' };
      enterChat();
    }).catch(function () {
      // token 失效，已经由 api() 内部退回登录页
    });
  })();

  /* ================================================================
     九、头像渲染小工具
     ================================================================ */
  // 生成完整头像元素：有图片用图片，没有就用「首字 + 专属底色」
  function avatarHTML(url, initial, color, cls) {
    var c = 'avatar' + (cls ? ' ' + cls : '');
    var bg = color ? ' style="background:' + color + '"' : '';
    if (url) {
      return '<div class="' + c + '"' + bg + '><img class="avatar-img" src="' + escapeHTML(url) + '" alt=""></div>';
    }
    return '<div class="' + c + '"' + bg + '>' + escapeHTML(initial) + '</div>';
  }
  function setAvatarEl(el, url, initial, color) {
    if (!el) return;
    el.style.background = color || '';
    if (url) el.innerHTML = '<img class="avatar-img" src="' + escapeHTML(url) + '" alt="">';
    else el.innerHTML = escapeHTML(initial);
  }

  /* ================================================================
     十、个人资料弹窗
     ================================================================ */
  function openProfile() {
    api('/api/me').then(function (data) {
      var p = data.profile || {};
      myProfile = p;
      pfName.value = p.display_name || '';
      pfBirthday.value = p.birthday || '';
      pfSchool.value = p.school || '';
      pfAddress.value = p.address || '';
      setAvatarEl(profileAvatar, p.avatar, (me.username || '?').slice(0, 1).toUpperCase(), p.color);
      profileMsg.textContent = '';
      profileModal.classList.remove('hidden');
    }).catch(function (err) { alert(err.message); });
  }
  function closeProfile() { profileModal.classList.add('hidden'); }

  function saveProfile() {
    if (busy) return; busy = true;
    api('/api/profile', {
      method: 'PUT',
      body: {
        display_name: pfName.value.trim(),
        birthday: pfBirthday.value,
        school: pfSchool.value.trim(),
        address: pfAddress.value.trim()
      }
    }).then(function () {
      myProfile.display_name = pfName.value.trim();
      myProfile.birthday = pfBirthday.value;
      myProfile.school = pfSchool.value.trim();
      myProfile.address = pfAddress.value.trim();
      myName.textContent = myProfile.display_name || me.username;
      closeProfile();
      refreshUsers();
    }).catch(function (err) { profileMsg.textContent = err.message; })
      .finally(function () { busy = false; });
  }

  function uploadAvatar(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      api('/api/avatar', { method: 'POST', body: { image: reader.result } })
        .then(function (data) {
          myProfile.avatar = data.avatar;
          var init = (me.username || '?').slice(0, 1).toUpperCase();
          setAvatarEl(myAvatar, data.avatar, init, myProfile.color);
          setAvatarEl(profileAvatar, data.avatar, init, myProfile.color);
        }).catch(function (err) { alert('头像上传失败：' + err.message); });
    };
    reader.readAsDataURL(file);
  }

  /* ================================================================
     十一、表情面板（emoji + 我的表情包）
     ================================================================ */
  var EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😜','🙄','😭','😡','👍','👎','👌','🙏','💪','👏','🤝','❤️','💔','🔥','⭐','✨','🎉','🌹','🌟','💡','✅','❌','⚡','🌈','🍀','🐱','🐶','🍎','🍔','🍕','☕','🎁','📱','💻','📚','⏰','🌞','🌙','☔','❓','❗','💤','🚀','🏆','🎮','🎵','📷','💰','🆗','😴','🤗','😇','🥳','😏','😱','🤯','🥰','😋','🤩','😢'];

  function buildEmojiGrid() {
    emojiGrid.innerHTML = EMOJIS.map(function (e) {
      return '<button type="button" class="emoji-cell">' + e + '</button>';
    }).join('');
    emojiGrid.querySelectorAll('.emoji-cell').forEach(function (b) {
      b.addEventListener('click', function () { insertEmoji(b.textContent); });
    });
  }

  function insertEmoji(ch) {
    var el = messageInput;
    var start = el.selectionStart, end = el.selectionEnd;
    var v = el.value;
    el.value = v.slice(0, start) + ch + v.slice(end);
    el.selectionStart = el.selectionEnd = start + ch.length;
    el.focus();
    el.dispatchEvent(new Event('input'));   // 触发输入框自动长高
  }

  function toggleEmojiPanel() {
    emojiOpen = !emojiOpen;
    emojiPanel.classList.toggle('hidden', !emojiOpen);
    if (emojiOpen && emojiTab === 'sticker') loadStickers();
  }
  function closeEmojiPanel() { emojiOpen = false; emojiPanel.classList.add('hidden'); }

  function switchEmojiTab(tab) {
    emojiTab = tab;
    emojiGrid.classList.toggle('hidden', tab !== 'emoji');
    stickerGrid.classList.toggle('hidden', tab !== 'sticker');
    document.querySelectorAll('.emoji-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    if (tab === 'sticker') loadStickers();
  }

  function loadStickers() {
    api('/api/stickers').then(function (data) {
      stickers = data.stickers || [];
      renderStickers();
    }).catch(function () { /* 静默 */ });
  }
  function renderStickers() {
    if (!stickers.length) {
      stickerList.innerHTML = '<div class="sticker-empty">还没有表情包，点“＋ 添加”上传图片</div>';
      return;
    }
    stickerList.innerHTML = stickers.map(function (s) {
      return '<div class="sticker-item" data-id="' + s.id + '" data-path="' + escapeHTML(s.image_path) + '">' +
        '<img src="' + escapeHTML(s.image_path) + '" alt="">' +
        '<button type="button" class="sticker-del" title="删除">×</button></div>';
    }).join('');
    stickerList.querySelectorAll('.sticker-item').forEach(function (it) {
      it.querySelector('img').addEventListener('click', function () {
        sendSticker(it.dataset.path);
        closeEmojiPanel();
      });
      it.querySelector('.sticker-del').addEventListener('click', function (e) {
        e.stopPropagation();
        deleteSticker(Number(it.dataset.id));
      });
    });
  }
  function uploadSticker(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      api('/api/stickers', { method: 'POST', body: { image: reader.result } })
        .then(function (data) { stickers.unshift(data.sticker); renderStickers(); })
        .catch(function (err) { alert('表情包上传失败：' + err.message); });
    };
    reader.readAsDataURL(file);
  }
  function deleteSticker(id) {
    api('/api/stickers', { method: 'DELETE', body: { id: id } })
      .then(function () {
        stickers = stickers.filter(function (s) { return s.id !== id; });
        renderStickers();
      }).catch(function (err) { alert(err.message); });
  }

  /* ================================================================
     十二、查看他人资料
     ================================================================ */
  function openUserInfo(u) {
    api('/api/users/' + u.id + '/profile').then(function (data) {
      var p = data.profile || {};
      var initial = (p.username || '?').slice(0, 1).toUpperCase();
      setAvatarEl(uiAvatar, p.avatar, initial, p.color);
      uiName.textContent = p.display_name || p.username;
      uiUsername.textContent = '@' + p.username;
      uiBirthday.textContent = p.birthday || '未填写';
      uiSchool.textContent = p.school || '未填写';
      uiAddress.textContent = p.address || '未填写';
      uiCreated.textContent = p.created_at ? new Date(p.created_at).toLocaleDateString() : '—';
      userInfoModal.classList.remove('hidden');
    }).catch(function (err) { alert(err.message); });
  }
  function closeUserInfo() { userInfoModal.classList.add('hidden'); }

  /* ================================================================
     十三、语音消息（录音 → 上传 → 发送）
     ================================================================ */
  var recorder = null, recChunks = [], recording = false, recStart = 0, recTimer = null, recStream = null;

  function setRecUI(on) {
    recording = on;
    voiceBtn.classList.toggle('recording', on);
    recHint.classList.toggle('hidden', !on);
    voiceBtn.title = on ? '点击结束录音并发送' : '点击开始录音';
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      alert('当前浏览器不支持录音，或页面不是 HTTPS / 本机(localhost) 环境。\n浏览器的安全限制：麦克风只能在 HTTPS 或 localhost 下使用。');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream;
      recChunks = [];
      var opts = {};
      if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        opts.mimeType = 'audio/webm;codecs=opus';
      }
      recorder = new MediaRecorder(stream, opts);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
      recorder.onstop = function () { finishRecording(); };
      recorder.start();
      recStart = Date.now();
      setRecUI(true);
      recHint.textContent = '录音中… 0:00';
      recTimer = setInterval(function () {
        var s = Math.floor((Date.now() - recStart) / 1000);
        recHint.textContent = '录音中… ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        if (s >= 60) stopRecording();   // 最长 60 秒
      }, 200);
    }).catch(function (err) {
      alert('无法打开麦克风：' + (err && err.message ? err.message : '请检查浏览器权限') +
        '\n注意：录音需要 HTTPS 或 localhost 访问。');
    });
  }

  function stopRecording() {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (recStream) {
      recStream.getTracks().forEach(function (t) { t.stop(); });
      recStream = null;
    }
  }

  function finishRecording() {
    setRecUI(false);
    var blob = new Blob(recChunks, { type: recChunks[0] ? recChunks[0].type : 'audio/webm' });
    recChunks = [];
    if (!blob.size) { alert('没有录到声音，请重试'); return; }
    if (blob.size > 8 * 1024 * 1024) { alert('语音太长（超过 8MB），请录短一点'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      api('/api/audio', { method: 'POST', body: { audio: reader.result } })
        .then(function (data) { sendVoice(data.audio); })
        .catch(function (err) { alert('语音发送失败：' + err.message); });
    };
    reader.readAsDataURL(blob);
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  function sendVoice(path) {
    sendMedia(path, 'audio');
  }

  /* ================================================================
     十四、加号菜单：发照片 / 发视频
     ================================================================ */
  var pendingScope = 'me';    // 壁纸可见范围，radio 的当前值

  function togglePlusMenu() {
    var willOpen = plusMenu.classList.contains('hidden');
    plusMenu.classList.toggle('hidden', !willOpen);
    if (willOpen) closeEmojiPanel();     // 两个气泡菜单不共存
  }
  function closePlusMenu() {
    plusMenu.classList.add('hidden');
  }

  function sendPhotoFile(file) {
    if (!file) return;
    if (!peer) { alert('请先选择一个聊天对象'); return; }
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }
    if (file.size > 10 * 1024 * 1024) { alert('图片超过 10MB，请换一张小一点的'); return; }

    var reader = new FileReader();
    reader.onload = function () {
      api('/api/photo', { method: 'POST', body: { image: reader.result } })
        .then(function (data) { sendMedia(data.photo, 'image'); })
        .catch(function (err) { alert('照片发送失败：' + err.message); });
    };
    reader.readAsDataURL(file);
  }

  function sendVideoFile(file) {
    if (!file) return;
    if (!peer) { alert('请先选择一个聊天对象'); return; }
    if (!/^video\//.test(file.type)) { alert('请选择视频文件'); return; }
    if (file.size > 25 * 1024 * 1024) {
      alert('视频超过 25MB，浏览器上传会比较吃力，请压缩或截短一点再发');
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      api('/api/video', { method: 'POST', body: { video: reader.result } })
        .then(function (data) { sendMedia(data.video, 'video'); })
        .catch(function (err) { alert('视频发送失败：' + err.message); });
    };
    reader.readAsDataURL(file);
  }

  /* ================================================================
     十五、聊天设置：壁纸 / 文字样式 / AI 接口
     ================================================================ */
  function applyTheme() {
    var root = document.documentElement;
    root.style.setProperty('--my-font-size', (prefs.font_size || '14') + 'px');
    root.style.setProperty('--my-text-color', prefs.text_color || '#ffffff');
    root.style.setProperty('--input-bg', prefs.input_bg || '#fbfcfe');
    root.style.setProperty('--my-font', FONT_STACKS[prefs.font_family] || FONT_STACKS.system);
  }

  // 上壁纸：优先用自己设的；自己没设、而对方开了「双方可见」就用对方的
  function applyWallpaper() {
    var main = document.querySelector('.chat-main');
    if (!main) return;
    var url = prefs.wallpaper || peerWallpaper || '';
    if (url) {
      main.style.backgroundImage = 'url("' + url + '")';
      main.classList.add('has-wallpaper');
    } else {
      main.style.backgroundImage = '';
      main.classList.remove('has-wallpaper');
    }
  }

  function loadSettings() {
    api('/api/settings').then(function (data) {
      prefs = Object.assign({}, prefs, data.settings || {});
      applyTheme();
      applyWallpaper();
    }).catch(function () { /* 静默 */ });
  }

  function renderWallpaperPreview() {
    if (!wallpaperPreview) return;
    if (prefs.wallpaper) {
      wallpaperPreview.style.backgroundImage = 'url("' + prefs.wallpaper + '")';
      wallpaperPreview.textContent = '';
    } else {
      wallpaperPreview.style.backgroundImage = '';
      wallpaperPreview.textContent = '未设置';
    }
  }

  function setScopeRadio(v) {
    document.querySelectorAll('input[name="wpScope"]').forEach(function (r) {
      r.checked = (r.value === v);
    });
  }

  function openSettings() {
    api('/api/settings').then(function (data) {
      prefs = Object.assign({}, prefs, data.settings || {});
      applyTheme();
      applyWallpaper();

      pendingScope = prefs.wallpaper_scope === 'both' ? 'both' : 'me';
      setScopeRadio(pendingScope);
      renderWallpaperPreview();

      setFontSize.value = prefs.font_size || '14';
      fontSizeVal.textContent = (prefs.font_size || '14') + 'px';
      setTextColor.value = prefs.text_color || '#ffffff';
      setInputBg.value = prefs.input_bg || '#fbfcfe';
      setFontFamily.value = prefs.font_family || 'system';
      setApiBase.value = prefs.api_base || '';
      setApiKey.value = prefs.api_key || '';
      setApiModel.value = prefs.api_model || '';

      settingsMsg.textContent = '';
      settingsModal.classList.remove('hidden');
    }).catch(function (err) { alert(err.message); });
  }

  function saveSettings() {
    if (busy) return;
    busy = true;
    settingsMsg.textContent = '保存中…';

    var body = {
      font_size: String(setFontSize.value),
      text_color: setTextColor.value,
      input_bg: setInputBg.value,
      font_family: setFontFamily.value,
      api_base: setApiBase.value.trim().replace(/\/+$/, ''),
      api_key: setApiKey.value.trim(),
      api_model: setApiModel.value.trim(),
      wallpaper_scope: pendingScope
    };

    api('/api/settings', { method: 'PUT', body: body }).then(function () {
      prefs = Object.assign({}, prefs, body);
      applyTheme();
      applyWallpaper();
      settingsModal.classList.add('hidden');
      if (prefs.api_base && prefs.api_key && prefs.api_model) {
        appendAiMsg('API 配好啦，我在右下角待命，随时喊我 🧚', 'tip');
      }
    }).catch(function (err) {
      settingsMsg.textContent = err.message;
    }).finally(function () { busy = false; });
  }

  function uploadWallpaper(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }

    var reader = new FileReader();
    reader.onload = function () {
      settingsMsg.textContent = '壁纸上传中…';
      api('/api/wallpaper', {
        method: 'POST',
        body: { image: reader.result, scope: pendingScope }
      }).then(function (data) {
        prefs.wallpaper = data.wallpaper;
        prefs.wallpaper_scope = data.scope;
        renderWallpaperPreview();
        applyWallpaper();
        settingsMsg.textContent = data.scope === 'both'
          ? '壁纸已生效：双方都能看到'
          : '壁纸已生效：仅自己可见';
      }).catch(function (err) {
        settingsMsg.textContent = err.message;
      });
    };
    reader.readAsDataURL(file);
  }

  function clearWallpaper() {
    api('/api/settings', { method: 'PUT', body: { wallpaper: '' } }).then(function () {
      prefs.wallpaper = '';
      renderWallpaperPreview();
      applyWallpaper();
      settingsMsg.textContent = '壁纸已清除';
    }).catch(function (err) { settingsMsg.textContent = err.message; });
  }

  /* ================================================================
     十六、AI 小精灵：主动建议 + 迷你聊天窗
     ================================================================ */
  var SUG_MIN_GAP = 8000;    // 两条建议之间至少隔 8 秒，别刷屏

  function hasAI() {
    return !!(prefs.api_base && prefs.api_key && prefs.api_model);
  }

  function callAI(messages) {
    return api('/api/ai/chat', { method: 'POST', body: { messages: messages } })
      .then(function (data) { return data.reply; });
  }

  function appendAiMsg(text, role) {
    var div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    div.textContent = text;
    aiMessages.appendChild(div);
    aiMessages.scrollTop = aiMessages.scrollHeight;
    return div;
  }

  function openAiPanel() {
    aiPanel.classList.remove('hidden');
    hideSuggestion();
    if (!aiMessages.dataset.inited) {
      aiMessages.dataset.inited = '1';
      appendAiMsg('我是聊天小精灵 🧚 配好 API 后，我可以帮你出一句回复，也能陪你聊天。', 'tip');
    }
    setTimeout(function () { aiInput.focus(); }, 30);
  }
  function closeAiPanel() { aiPanel.classList.add('hidden'); }
  function toggleAiPanel() {
    if (aiPanel.classList.contains('hidden')) openAiPanel();
    else closeAiPanel();
  }

  function askSprite(text) {
    if (aiBusy) return;

    if (!hasAI()) {
      appendAiMsg('还没有配置大模型接口：点右上角 ⚙️ 设置，填好调用地址、API Key 和模型名，我就能开工啦。', 'tip');
      return;
    }

    aiBusy = true;
    appendAiMsg(text, 'user');
    aiHistory.push({ role: 'user', content: text });

    var thinking = appendAiMsg('思考中…', 'tip');
    var msgs = [{
      role: 'system',
      content: '你是"聊天小精灵"，一个活泼、简短、贴心的中文助手。回答控制在 120 字以内，口语化，别用 Markdown。'
    }].concat(aiHistory.slice(-10));

    callAI(msgs).then(function (reply) {
      thinking.remove();
      appendAiMsg(reply, 'assistant');
      aiHistory.push({ role: 'assistant', content: reply });
    }).catch(function (err) {
      thinking.textContent = '出错了：' + err.message;
    }).finally(function () { aiBusy = false; });
  }

  function showSuggestion(text) {
    pendingSuggestion = text;
    aiSugText.textContent = text;
    aiSuggestion.classList.remove('hidden');
  }
  function hideSuggestion() {
    pendingSuggestion = '';
    if (aiSuggestion) aiSuggestion.classList.add('hidden');
  }

  // 点「发送」直接把建议发出去
  function sendSuggestion() {
    var text = pendingSuggestion;
    if (!text) return;
    hideSuggestion();
    if (!peer) { alert('请先选择一个聊天对象'); return; }
    messageInput.value = text;
    messageInput.dispatchEvent(new Event('input'));
    send();
  }

  // 对方发来消息后，偷偷让 AI 想一句回复，弹个小气泡
  function maybeSuggest() {
    if (!peer || suggestBusy || !hasAI()) return;
    if (!aiPanel.classList.contains('hidden')) return;   // 正在和小精灵聊天，别抢注意力
    if (!recentMsgs.length) return;

    var lastOne = recentMsgs[recentMsgs.length - 1];
    if (!lastOne || (me && lastOne.sender_id === me.id)) return;
    if (lastOne.id === lastSugForId) return;             // 同一条消息只想一次
    if (Date.now() - lastSugTime < SUG_MIN_GAP) return;   // 节流

    suggestBusy = true;
    lastSugForId = lastOne.id;

    var peerName = peer.display_name || peer.username;
    var lines = recentMsgs.slice(-6).map(function (m) {
      var who = (me && m.sender_id === me.id) ? '我' : peerName;
      var body;
      if (m.type === 'image') body = '[图片]';
      else if (m.type === 'audio') body = '[语音]';
      else if (m.type === 'video') body = '[视频]';
      else body = m.content;
      return who + '：' + body;
    }).join('\n');

    callAI([
      { role: 'system', content: '你是聊天助手。根据聊天记录，替"我"想一句回复对方的话。只输出这句话本身：不要引号、不要解释、不超过 25 个字，口语自然。' },
      { role: 'user', content: '聊天记录：\n' + lines }
    ]).then(function (reply) {
      var t = String(reply)
        .replace(/^[\s"'“”‘’「」《》]+/, '')
        .replace(/[\s"'“”‘’「」《》]+$/, '')
        .replace(/\n+/g, ' ')
        .slice(0, 60);
      if (t) showSuggestion(t);
    }).catch(function () {
      /* AI 出错就当没这回事，绝不打扰正常聊天 */
    }).finally(function () {
      suggestBusy = false;
      lastSugTime = Date.now();
    });
  }

  /* ================================================================
     十七、事件绑定
     ================================================================ */
  if (profileBtn) profileBtn.addEventListener('click', openProfile);
  if (meBox) meBox.addEventListener('click', openProfile);
  if (profileClose) profileClose.addEventListener('click', closeProfile);
  if (profileCancel) profileCancel.addEventListener('click', closeProfile);
  if (profileForm) profileForm.addEventListener('submit', function (e) { e.preventDefault(); saveProfile(); });
  if (avatarUploadBtn) avatarUploadBtn.addEventListener('click', function () { avatarInput.click(); });
  if (avatarInput) avatarInput.addEventListener('change', function () {
    uploadAvatar(avatarInput.files[0]); avatarInput.value = '';
  });

  if (emojiBtn) emojiBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleEmojiPanel(); });
  if (stickerAddBtn) stickerAddBtn.addEventListener('click', function () { stickerInput.click(); });
  if (stickerInput) stickerInput.addEventListener('change', function () {
    uploadSticker(stickerInput.files[0]); stickerInput.value = '';
  });
  document.querySelectorAll('.emoji-tab').forEach(function (t) {
    t.addEventListener('click', function () { switchEmojiTab(t.dataset.tab); });
  });
  // 点击面板以外区域关闭表情面板
  document.addEventListener('click', function (e) {
    if (!emojiOpen) return;
    if (emojiPanel.contains(e.target) || emojiBtn.contains(e.target)) return;
    closeEmojiPanel();
  });

  /* 查看他人资料 */
  if (userInfoClose) userInfoClose.addEventListener('click', closeUserInfo);
  if (userInfoClose2) userInfoClose2.addEventListener('click', closeUserInfo);
  // 点聊天顶部对方头像 → 看他的资料
  if (peerAvatar) peerAvatar.addEventListener('click', function () {
    if (peer) openUserInfo(peer);
  });

  /* 语音 */
  if (voiceBtn) voiceBtn.addEventListener('click', toggleRecording);

  /* 加号：照片 / 视频 */
  if (plusBtn) plusBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePlusMenu();
  });
  if (pickPhotoBtn) pickPhotoBtn.addEventListener('click', function () {
    closePlusMenu();
    photoInput.click();
  });
  if (pickVideoBtn) pickVideoBtn.addEventListener('click', function () {
    closePlusMenu();
    videoInput.click();
  });
  if (photoInput) photoInput.addEventListener('change', function () {
    sendPhotoFile(photoInput.files[0]);
    photoInput.value = '';
  });
  if (videoInput) videoInput.addEventListener('change', function () {
    sendVideoFile(videoInput.files[0]);
    videoInput.value = '';
  });
  // 点别处收起加号菜单
  document.addEventListener('click', function (e) {
    if (plusMenu.classList.contains('hidden')) return;
    if (plusMenu.contains(e.target) || plusBtn.contains(e.target)) return;
    closePlusMenu();
  });

  /* 聊天设置 */
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (settingsBtn2) settingsBtn2.addEventListener('click', openSettings);
  if (settingsClose) settingsClose.addEventListener('click', function () {
    settingsModal.classList.add('hidden');
  });
  if (settingsCancel) settingsCancel.addEventListener('click', function () {
    settingsModal.classList.add('hidden');
  });
  if (settingsSave) settingsSave.addEventListener('click', saveSettings);
  if (wallpaperUploadBtn) wallpaperUploadBtn.addEventListener('click', function () {
    wallpaperInput.click();
  });
  if (wallpaperInput) wallpaperInput.addEventListener('change', function () {
    uploadWallpaper(wallpaperInput.files[0]);
    wallpaperInput.value = '';
  });
  if (wallpaperClearBtn) wallpaperClearBtn.addEventListener('click', clearWallpaper);
  if (setFontSize) setFontSize.addEventListener('input', function () {
    fontSizeVal.textContent = setFontSize.value + 'px';
  });
  document.querySelectorAll('input[name="wpScope"]').forEach(function (r) {
    r.addEventListener('change', function () { pendingScope = r.value; });
  });
  // 选字体时立刻预览效果
  if (setFontFamily) setFontFamily.addEventListener('change', function () {
    document.documentElement.style.setProperty(
      '--my-font', FONT_STACKS[setFontFamily.value] || FONT_STACKS.system);
  });

  /* AI 小精灵 */
  if (aiSprite) aiSprite.addEventListener('click', toggleAiPanel);
  if (aiPanelClose) aiPanelClose.addEventListener('click', closeAiPanel);
  if (aiSugSend) aiSugSend.addEventListener('click', sendSuggestion);
  if (aiSugClose) aiSugClose.addEventListener('click', hideSuggestion);
  if (aiForm) aiForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = aiInput.value.trim();
    if (!t) return;
    aiInput.value = '';
    askSprite(t);
  });

})();

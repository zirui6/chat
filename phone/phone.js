/* ==========================================================================
   梓睿聊天 · 手机版逻辑
   —— 与电脑版共用同一套后端（账号服务 + Supabase + 本机设置键）
   —— 只负责手机端界面：底部标签栏、会话列表、全屏聊天、设置页
   ========================================================================== */
(function () {
'use strict';

/* ============================ 配置 ============================ */
const SUPABASE_URL = 'https://uigzsxmkulephkfkiebj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_OgyvGDiFuFAKKGYMmnq3GA_nXqIRCmW';
const PUBLIC_CHANNEL = '11111111-1111-1111-1111-111111111111';
const OFFICIAL_CHANNEL = '22222222-2222-2222-2222-222222222222';
const API_BASE = 'https://webcloud.ziruicloud.de5.net';
const LOGIN_URL = 'login.html';
const HOME_URL = 'index.html';

const AIRTABLE_TOKEN = 'patdZcEB92LMLW3bQ.44a613d94083deff3df9f4fda69a7b7a6c851c56faf900b16c72c6ddff7021ea';
const AIRTABLE_BASE = 'app9G6YeDcFq7g09r';
const AIRTABLE_TABLE = '聊天公告';

const CACHE_MSG_PREFIX = 'chat_msgs_';
const CACHE_MSG_LIMIT = 200;
const CACHE_PROFILE_KEY = 'chat_profiles_cache';
const CACHE_OFFICIAL_KEY = 'chat_official_cache';
const CACHE_LASTMSG_KEY = 'chat_lastmsg_cache';
const CACHE_READ_PREFIX = 'chat_read_';
const CACHE_CONV_KEY = 'chat_conversations_cache';

/* 调试开关：?debug=1 时把错误画面上显示，方便手机上没有控制台时排查 */
const DEBUG = /[?&]debug=1/.test(location.search);

const $ = s => document.querySelector(s);
const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================ 调试面板 ============================ */
const debugLines = [];
function logError(where, err) {
  const text = where + ' :: ' + (err && (err.message || err.name) ? (err.name + ' ' + err.message) : String(err));
  debugLines.push(text);
  if (typeof console !== 'undefined') console.warn('[梓睿]', text, err);
  renderDebug();
}
function renderDebug() {
  if (!DEBUG) return;
  let box = $('#debugBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'debugBox';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;max-height:38vh;overflow:auto;' +
      'background:rgba(0,0,0,.88);color:#ffd479;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;' +
      'white-space:pre-wrap;word-break:break-all;';
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }
  box.textContent = debugLines.slice(-24).join('\n') + '\n\n(点此关闭)';
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', e => logError('window', e.error || e.message));
  window.addEventListener('unhandledrejection', e => logError('promise', e.reason));
}

/* ============================ 轻提示 / 底部菜单 ============================ */
let toastTimer = null;
function toast(msg, ms) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || 1800);
}

let sheetClose = null;
function openSheet(title, actions) {
  const sheet = $('#actionSheet');
  const mask = $('#mask');
  if (!sheet || !mask) return;

  sheet.innerHTML = (title ? '<div class="sheet-title">' + esc(title) + '</div>' : '') +
    actions.map((a, i) => '<button data-i="' + i + '"' + (a.danger ? ' class="danger"' : '') + '>' +
      esc(a.label) + '</button>').join('') +
    '<button class="cancel" data-cancel="1">取消</button>';

  sheet.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const cancel = btn.dataset.cancel;
      closeSheet();
      if (cancel) return;
      const act = actions[Number(btn.dataset.i)];
      if (act && typeof act.run === 'function') {
        try { act.run(); } catch (e) { logError('sheet.action', e); }
      }
    });
  });

  sheet.classList.add('show');
  mask.classList.add('show');
  sheetClose = closeSheet;
}
function closeSheet() {
  const sheet = $('#actionSheet');
  const mask = $('#mask');
  if (sheet) sheet.classList.remove('show');
  if (mask) mask.classList.remove('show');
  const panel = $('#emojiPanel');
  if (panel) panel.classList.remove('show');
  sheetClose = null;
}
document.addEventListener('click', e => {
  if (e.target.id === 'mask') closeSheet();
});

/* 表情面板 */
const EMOJIS = ['😀','😂','🥰','😎','🤔','😭','👍','👏','🙏','🎉','❤️','🔥',
  '🌹','☕','🐶','🐱','✨','💪','🍀','😴','😅','🥳','😇','🤝'];

function openEmoji(onPick) {
  let panel = $('#emojiPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'emojiPanel';
    panel.className = 'emoji-panel';
    panel.innerHTML = EMOJIS.map(e => '<button type="button">' + e + '</button>').join('');
    document.body.appendChild(panel);
    panel.addEventListener('click', ev => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      onPick(btn.textContent);
      closeSheet();
    });
  }
  panel.classList.add('show');
  const mask = $('#mask');
  if (mask) mask.classList.add('show');
}

/* ============================ 本机设置 ============================ */
const DEFAULT_SETTINGS = {
  theme: 'light', fontSize: 'normal', bubbleDensity: 'standard',
  showPreview: true, showBadge: true, notifySound: true,
  notifyDesktop: false, dnd: false, autoDownloadImage: true,
};
let settings = {};
try {
  const raw = JSON.parse(localStorage.getItem('chat_settings') || 'null') || {};
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    settings[k] = (raw[k] === undefined || raw[k] === null) ? DEFAULT_SETTINGS[k] : raw[k];
  });
} catch (e) { settings = Object.assign({}, DEFAULT_SETTINGS); }

function resolvedTheme() {
  if (settings.theme === 'system') {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  return settings.theme === 'dark' ? 'dark' : 'light';
}
function applyTheme() {
  const d = document.documentElement;
  const t = resolvedTheme();
  d.setAttribute('data-theme', t);
  d.setAttribute('data-size', settings.fontSize);
  d.setAttribute('data-density', settings.bubbleDensity);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#141414' : '#f7f7f7');
}
function saveSettings() {
  try { localStorage.setItem('chat_settings', JSON.stringify(settings)); } catch (e) {}
  if (settings.theme !== 'system') {
    try { localStorage.setItem('theme', settings.theme); } catch (e) {}
  }
}
applyTheme();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (settings.theme === 'system') applyTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

/* ============================ 登录态 ============================ */
const Cookie = {
  get(name) {
    const eq = name + '=';
    const parts = document.cookie.split(';');
    for (let i = 0; i < parts.length; i++) {
      let c = parts[i];
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(eq) === 0) return decodeURIComponent(c.substring(eq.length));
    }
    return null;
  },
  set(name, value, days) {
    let expires = '';
    if (days) {
      const d = new Date();
      d.setTime(d.getTime() + days * 86400000);
      expires = '; expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  },
  del(name) { document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; },
};

const local = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
  del(key) { try { localStorage.removeItem(key); } catch (e) {} },
  raw(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  },
};

function loadUser() {
  const uid = Cookie.get('userId') || sessionStorage.getItem('userId');
  if (!uid) return null;
  const raw = Cookie.get('user_data') || sessionStorage.getItem('user_data');
  if (raw) {
    try {
      const u = JSON.parse(raw);
      if (u && u.id) return u;
    } catch (e) {}
  }
  return {
    id: uid,
    username: Cookie.get('displayName') || sessionStorage.getItem('displayName') || '',
    email: Cookie.get('userEmail') || '',
    role: Cookie.get('role') || 'user',
  };
}

function logout() {
  openSheet('确定退出登录吗？', [{
    label: '退出登录', danger: true,
    run: () => {
      ['auth_token', 'user_data', 'isLoggedIn', 'userId', 'userEmail', 'displayName', 'role']
        .forEach(k => Cookie.del(k));
      try { sessionStorage.clear(); } catch (e) {}
      location.href = LOGIN_URL;
    },
  }]);
}

/* ============================ 数据缓存（与电脑版同键） ============================ */
const cache = {
  msgs(channelId) { return local.get(CACHE_MSG_PREFIX + channelId, []); },
  setMsgs(channelId, list) {
    const sorted = list.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    local.set(CACHE_MSG_PREFIX + channelId, sorted.slice(-CACHE_MSG_LIMIT));
  },
  addMsg(channelId, msg) {
    const list = cache.msgs(channelId);
    if (list.some(m => m.id === msg.id)) return;
    list.push(msg);
    cache.setMsgs(channelId, list);
  },
  profiles() { return local.get(CACHE_PROFILE_KEY, {}); },
  setProfiles(map) { local.set(CACHE_PROFILE_KEY, map); },
  lastMsg() { return local.get(CACHE_LASTMSG_KEY, {}); },
  setLastMsg(map) { local.set(CACHE_LASTMSG_KEY, map); },
  readAt(channelId) {
    try { return localStorage.getItem(CACHE_READ_PREFIX + channelId); } catch (e) { return null; }
  },
  setReadAt(channelId, iso) {
    try { localStorage.setItem(CACHE_READ_PREFIX + channelId, iso || new Date().toISOString()); } catch (e) {}
  },
  conversations() { return local.get(CACHE_CONV_KEY, []); },
  setConversations(list) { local.set(CACHE_CONV_KEY, list); },
};

function flatten(text, max) {
  const s = String(text == null ? '' : text).replace(/\r/g, ' ').replace(/\n/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function nicknameOf(userId, me) {
  if (!userId) return '';
  if (me && userId === me.id) return me.username || '我';
  const profiles = cache.profiles();
  const p = profiles[userId];
  return (p && p.nickname) ? p.nickname : userId;
}

/* ============================ 时间格式 ============================ */
function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天';
  const diffDay = Math.floor((now - d) / 86400000);
  if (diffDay < 7) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}
function daySeparator(iso) {
  const d = new Date(iso), now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}
function fullTime(iso) {
  if (!iso) return '未知';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '未知';
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function bytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
}

/* ============================ 提示音 / 通知 ============================ */
let audioCtx = null;
function beep() {
  if (!settings.notifySound || settings.dnd) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1174].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.18);
    });
  } catch (e) { logError('beep', e); }
}
function notifySupported() { return typeof Notification !== 'undefined'; }
async function ensureNotifyPermission(ask) {
  if (!notifySupported()) return false;
  let perm = Notification.permission;
  if (ask && perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (e) {}
  }
  return perm === 'granted';
}
function desktopNotify(title, body) {
  if (!settings.notifyDesktop || settings.dnd) return;
  if (!notifySupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body: body, icon: 'https://zirui6.github.io/logo1.png', tag: 'zirui-chat' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { logError('notify', e); }
}

/* ============================ 底部标签栏（两个页面共用） ============================ */
const TAB_TITLES = { chats: '微信', contacts: '通讯录', discover: '发现', me: '我' };
function bindTabbar(onSwitch) {
  const tabbar = $('#tabbar');
  if (!tabbar) return;
  tabbar.addEventListener('click', e => {
    const btn = e.target.closest('.tab-item');
    if (!btn) return;
    switchTab(btn.dataset.tab, onSwitch);
  });
}
function switchTab(tab, onSwitch) {
  if (!tab || !$('.tab-pane[data-pane="' + tab + '"]')) return;
  $$('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
  const title = $('#tabTitle');
  if (title) title.textContent = TAB_TITLES[tab] || '梓睿';
  const searchBar = $('#searchBar');
  if (searchBar) {
    const show = tab === 'chats' && searchBar.dataset.forced === '1';
    searchBar.classList.toggle('show', show);
  }
  const topSearch = $('#btnTopSearch');
  if (topSearch) topSearch.hidden = tab !== 'chats';
  try { history.replaceState(Object.assign(history.state || {}, { tab: tab }), ''); } catch (e) {}
  if (typeof onSwitch === 'function') onSwitch(tab);
}

/* ============================ 会话数据 ============================ */
function buildConversations(rows, me) {
  const cs = [
    { id: OFFICIAL_CHANNEL, name: '官方通知', type: 'official', unread: 0, last_time: null, last_msg: '' },
    { id: PUBLIC_CHANNEL, name: '公共聊天', type: 'public', unread: 0, last_time: null, last_msg: '' },
  ];
  const seen = {};
  seen[OFFICIAL_CHANNEL] = seen[PUBLIC_CHANNEL] = 1;
  (rows || []).forEach(r => {
    if (seen[r.id]) return;
    seen[r.id] = 1;
    cs.push({
      id: r.id,
      name: r.name || '会话',
      type: r.type || 'private',
      unread: 0,
      last_time: null,
      last_msg: '',
    });
  });
  return cs;
}

function previewOf(conv, me) {
  if (conv.type === 'official') {
    const posts = local.get(CACHE_OFFICIAL_KEY, []);
    return posts && posts.length ? '[链接] ' + (posts[0].title || '公告') : '官方消息';
  }
  const last = cache.lastMsg();
  const text = last[conv.id];
  if (text) {
    if (conv.type === 'public') return text;
    const who = last[conv.id + '_who'];
    return who ? who + '：' + text : text;
  }
  return conv.type === 'public' ? '公共频道' : conv.type === 'private' ? '私聊' : '群聊';
}

/* ============================ 页面：聊天 ============================ */
function initChatPage() {
  let supabase;
  try {
    if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase SDK 未加载');
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    logError('supabase', e);
    const screen = $('#loadingScreen');
    if (screen) {
      screen.innerHTML = '<div style="font-size:40px">❌</div><p>SDK 加载失败，请检查网络后重试</p>' +
        '<button class="btn-primary" style="margin-top:12px" onclick="location.reload()">重试</button>';
    }
    return;
  }

  const me = loadUser();
  if (!me || !me.id) { location.replace(LOGIN_URL); return; }

  const state = {
    me: me,
    deviceId: local.raw('deviceId', ''),
    conversations: [],
    currentId: null,
    currentType: null,
    messages: [],
    realtimeState: 'idle',
    pollTimer: null,
    lastRealtimeAt: 0,
  };
  if (!state.deviceId) {
    state.deviceId = 'h5-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('deviceId', state.deviceId); } catch (e) {}
  }

  const el = {
    list: $('#list'),
    listContacts: $('#listContacts'),
    listDiscover: $('#listDiscover'),
    tabBadge: $('#tabBadge'),
    chatView: $('#chatView'),
    messages: $('#messages'),
    chatTitle: $('#chatTitle'),
    chatSub: $('#chatSub'),
    composer: $('#composer'),
    input: $('#msgInput'),
    sendBtn: $('#sendBtn'),
    readonlyNote: $('#readonlyNote'),
    searchInput: $('#searchInput'),
    searchBar: $('#searchBar'),
    settingsView: $('#settingsView'),
  };

  /* ---------- 界面工具 ---------- */
  function onUi(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 0);
  }

  function updateBadge() {
    const total = state.conversations.reduce((s, c) => s + (c.unread || 0), 0);
    if (!el.tabBadge) return;
    if (settings.showBadge && total > 0) {
      el.tabBadge.textContent = total > 99 ? '99+' : String(total);
      el.tabBadge.classList.add('show');
    } else {
      el.tabBadge.classList.remove('show');
    }
  }

  function openChatView() {
    if (el.chatView) el.chatView.classList.add('open');
    pushOverlay('chat');
  }
  function closeChatView() {
    if (el.chatView) el.chatView.classList.remove('open');
  }
  function openSettingsView() {
    if (el.settingsView) el.settingsView.classList.add('open');
    pushOverlay('settings');
    renderSettingsAccount();
    updateCacheInfo();
    loadDevices();
  }
  function closeSettingsView() {
    if (el.settingsView) el.settingsView.classList.remove('open');
  }

  function pushOverlay(name) {
    try { history.pushState(Object.assign(history.state || {}, { overlay: name }), ''); } catch (e) {}
  }

  /* ---------- 会话列表渲染 ---------- */
  function avatarClass(conv) {
    return conv.type === 'official' ? 'avatar official' : 'avatar';
  }
  function avatarText(conv) {
    if (conv.type === 'official') return '📢';
    const n = (conv.name || '?').trim();
    return esc(n.charAt(0).toUpperCase());
  }

  function renderConversations() {
    if (!el.list) return;
    state.conversations = state.conversations.slice().sort((a, b) => {
      const order = { official: 0, public: 1 };
      const oa = order[a.type] === undefined ? 2 : order[a.type];
      const ob = order[b.type] === undefined ? 2 : order[b.type];
      if (oa !== ob) return oa - ob;
      return new Date(b.last_time || 0) - new Date(a.last_time || 0);
    });
    cache.setConversations(state.conversations.map(c => ({
      id: c.id, name: c.name, type: c.type, last_time: c.last_time, unread: c.unread,
    })));

    if (!state.conversations.length) {
      el.list.innerHTML = '<div class="empty-tip">暂无会话<br>点右上角 ＋ 发起群聊或添加好友</div>';
      updateBadge();
      return;
    }

    el.list.innerHTML = state.conversations.map(conv => {
      const preview = settings.showPreview ? previewOf(conv, state.me) : '';
      const badge = (settings.showBadge && conv.unread > 0)
        ? (conv.unread > 99
          ? '<div class="unread-badge">99+</div>'
          : (conv.type === 'public' || conv.type === 'official'
            ? '<div class="unread-badge">' + conv.unread + '</div>'
            : '<div class="unread-dot"></div>'))
        : '';
      const actions = conv.type === 'group'
        ? '<div class="item-actions"><button class="danger" data-swipe="leave">退群</button></div>'
        : conv.type === 'private'
          ? '<div class="item-actions"><button class="danger" data-swipe="delete">删除</button></div>'
          : '<div class="item-actions"><button class="brand" data-swipe="read">已读</button></div>';
      return '' +
        '<div class="list-item" data-id="' + esc(conv.id) + '" data-type="' + esc(conv.type) + '">' +
          actions +
          '<div class="item-inner">' +
            '<div class="' + avatarClass(conv) + '">' + avatarText(conv) + '</div>' +
            '<div class="item-body">' +
              '<div class="item-name">' + esc(conv.name) + '</div>' +
              (preview ? '<div class="item-preview">' + esc(preview) + '</div>' : '') +
            '</div>' +
            '<div class="item-meta">' +
              '<div class="item-time">' + esc(timeLabel(conv.last_time)) + '</div>' +
              badge +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    bindListItems();
    updateBadge();
  }

  function bindListItems() {
    $$('#list .list-item').forEach(item => {
      const conv = state.conversations.find(c => c.id === item.dataset.id);
      if (!conv) return;
      bindSwipe(item, conv);
      const inner = item.querySelector('.item-inner');
      if (inner) {
        inner.addEventListener('click', () => {
          if (item.dataset.swiped === '1') { resetSwipe(item); return; }
          openChannel(conv);
        });
      }
    });
  }

  /* 左滑操作 */
  function bindSwipe(item, conv) {
    const inner = item.querySelector('.item-inner');
    if (!inner) return;
    const action = item.querySelector('[data-swipe]');
    if (action) {
      action.addEventListener('click', ev => {
        ev.stopPropagation();
        resetSwipe(item);
        const kind = action.dataset.swipe;
        if (kind === 'read') {
          markRead(conv.id).then(() => { conv.unread = 0; renderConversations(); });
        } else if (kind === 'delete') {
          openSheet('删除该会话？', [{
            label: '删除并清空本机记录', danger: true,
            run: () => removeConversation(conv),
          }]);
        } else if (kind === 'leave') {
          openSheet('退出「' + conv.name + '」？', [{
            label: '退出群聊', danger: true,
            run: () => leaveGroup(conv),
          }]);
        }
      });
    }

    let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, locked = false;
    const width = 72;

    inner.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0; dragging = true; decided = false; locked = false;
      item.classList.add('dragging');
    }, { passive: true });

    inner.addEventListener('touchmove', e => {
      if (!dragging || e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        decided = true;
        locked = Math.abs(my) > Math.abs(mx);
      }
      if (locked) return;
      dx = Math.max(-width, Math.min(0, mx - (item.dataset.swiped === '1' ? width : 0)));
      inner.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });

    inner.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      item.classList.remove('dragging');
      if (locked) return;
      const open = dx < -width / 2;
      inner.style.transform = open ? 'translateX(-' + width + 'px)' : '';
      item.dataset.swiped = open ? '1' : '0';
    });
  }
  function resetSwipe(item) {
    const inner = item.querySelector('.item-inner');
    if (inner) inner.style.transform = '';
    item.dataset.swiped = '0';
  }

  /* ---------- 打开会话 ---------- */
  async function openChannel(conv) {
    state.currentId = conv.id;
    state.currentType = conv.type;
    if (el.chatTitle) el.chatTitle.textContent = conv.name || '聊天';
    if (el.chatSub) el.chatSub.textContent = conv.type === 'group' ? '群聊'
      : conv.type === 'public' ? '公共频道'
      : conv.type === 'official' ? '官方通知' : '';

    const readonly = conv.type === 'official';
    if (el.composer) el.composer.style.display = readonly ? 'none' : '';
    if (el.readonlyNote) el.readonlyNote.style.display = readonly ? '' : 'none';
    const clearHint = $('#clearChatHint');
    if (clearHint) clearHint.textContent = conv.name;

    openChatView();

    if (readonly) {
      await loadOfficial();
    } else {
      await loadMessages(conv.id, true);
    }
    await markRead(conv.id);
    conv.unread = 0;
    renderConversations();
  }

  /* ---------- 消息 ---------- */
  function decorate(list) {
    const profiles = cache.profiles();
    return list.map(m => ({
      id: m.id,
      user_id: m.user_id,
      content: m.content,
      created_at: m.created_at,
      nick: (m.user_id === state.me.id)
        ? (state.me.username || '我')
        : ((profiles[m.user_id] && profiles[m.user_id].nickname) || m.user_id),
      self: m.user_id === state.me.id,
    }));
  }

  function messageHtml(m) {
    const initial = esc((m.nick || '?').charAt(0).toUpperCase());
    return '' +
      '<div class="msg' + (m.self ? ' self' : '') + '">' +
        '<div class="msg-avatar">' + initial + '</div>' +
        '<div class="msg-body">' +
          '<div class="msg-name">' + esc(m.nick) + '</div>' +
          '<div class="msg-bubble">' + esc(m.content) + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderMessages(list) {
    if (!el.messages) return;
    if (!list.length) {
      el.messages.innerHTML = '<div class="empty-state"><div class="empty-logo"></div>' +
        '<p>还没有消息，发送第一条吧</p></div>';
      return;
    }
    let html = '';
    let prevKey = '';
    list.forEach(m => {
      const key = new Date(m.created_at).toDateString();
      if (key !== prevKey) {
        html += '<div class="day-sep">' + esc(daySeparator(m.created_at)) + '</div>';
        prevKey = key;
      }
      html += messageHtml(m);
    });
    el.messages.innerHTML = html;
    scrollToEnd();
  }

  function appendMessage(m) {
    if (!el.messages) return;
    const empty = el.messages.querySelector('.empty-state, .empty-tip');
    if (empty) el.messages.innerHTML = '';
    el.messages.insertAdjacentHTML('beforeend', messageHtml(m));
    scrollToEnd();
  }

  function scrollToEnd(smooth) {
    if (!el.messages) return;
    const top = el.messages.scrollHeight;
    if (smooth && el.messages.scrollTo) el.messages.scrollTo({ top: top, behavior: 'smooth' });
    else el.messages.scrollTop = top;
  }

  async function ensureProfiles(ids) {
    const profiles = cache.profiles();
    const missing = ids.filter(id => id && id !== state.me.id && !profiles[id]);
    if (!missing.length) return;
    try {
      const { data } = await supabase.from('profiles').select('id, nickname').in('id', missing);
      (data || []).forEach(p => { profiles[p.id] = p; });
      cache.setProfiles(profiles);
    } catch (e) { logError('ensureProfiles', e); }
  }

  async function loadMessages(channelId, scroll) {
    const cached = cache.msgs(channelId);
    if (cached.length) {
      renderMessages(decorate(cached));
      ensureProfiles(cached.map(m => m.user_id)).then(() => {
        if (state.currentId === channelId) renderMessages(decorate(cache.msgs(channelId)));
      });
    } else if (el.messages) {
      el.messages.innerHTML = '<div class="empty-tip">加载中…</div>';
    }

    try {
      let query = supabase.from('messages')
        .select('id, user_id, content, created_at')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true });
      if (cached.length) query = query.gt('created_at', cached[cached.length - 1].created_at);
      else query = query.limit(CACHE_MSG_LIMIT);

      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length) {
        await ensureProfiles(data.map(m => m.user_id));
        if (!cached.length) cache.setMsgs(channelId, data);
        else data.forEach(m => cache.addMsg(channelId, m));
        if (state.currentId === channelId) {
          renderMessages(decorate(cache.msgs(channelId)));
          if (scroll) scrollToEnd();
        }
        rememberLast(channelId, data[data.length - 1]);
      } else if (!cached.length && el.messages) {
        el.messages.innerHTML = '<div class="empty-state"><div class="empty-logo"></div>' +
          '<p>还没有消息，发送第一条吧</p></div>';
      }
    } catch (e) {
      logError('loadMessages', e);
      if (!cached.length && el.messages) {
        el.messages.innerHTML = '<div class="empty-tip">加载失败：' + esc(e.message || e) + '</div>';
      }
    }
  }

  function rememberLast(channelId, msg) {
    if (!msg) return;
    const map = cache.lastMsg();
    map[channelId] = flatten(msg.content, 50);
    map[channelId + '_who'] = (msg.user_id === state.me.id)
      ? (state.me.username || '我')
      : ((cache.profiles()[msg.user_id] || {}).nickname || '');
    cache.setLastMsg(map);
  }

  /* ---------- 官方公告 ---------- */
  async function loadOfficial() {
    const cached = local.get(CACHE_OFFICIAL_KEY, null);
    if (cached && cached.length) renderOfficial(cached);
    else if (el.messages) el.messages.innerHTML = '<div class="empty-tip">加载公告中…</div>';

    try {
      const url = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + encodeURIComponent(AIRTABLE_TABLE);
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + AIRTABLE_TOKEN } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const json = await r.json();
      const posts = (json.records || []).map(rec => {
        const f = rec.fields || {};
        return {
          id: rec.id,
          title: f['标题'] || '无标题',
          subtitle: f['小标题'] || '',
          publisher: f['发布者'] || '系统服务',
          publishDate: f['发布时间'] || new Date().toISOString(),
          imageUrl: f['附图链接'] || '',
        };
      }).sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
      local.set(CACHE_OFFICIAL_KEY, posts);
      renderOfficial(posts);
    } catch (e) {
      logError('loadOfficial', e);
      if (!cached && el.messages) el.messages.innerHTML = '<div class="empty-tip">公告加载失败</div>';
    }
  }

  function renderOfficial(posts) {
    if (!el.messages) return;
    if (!posts.length) {
      el.messages.innerHTML = '<div class="empty-tip">暂无公告</div>';
      return;
    }
    el.messages.innerHTML = posts.map(p => '' +
      '<div class="msg official">' +
        '<div class="msg-avatar">📢</div>' +
        '<div class="msg-body">' +
          '<div class="article">' +
            '<div class="a-publisher">📢 ' + esc(p.publisher) + '</div>' +
            '<div class="a-title">' + esc(p.title) + '</div>' +
            (p.subtitle ? '<div class="a-sub">' + esc(p.subtitle) + '</div>' : '') +
            ((p.imageUrl && settings.autoDownloadImage)
              ? '<img class="a-img" loading="lazy" src="' + esc(p.imageUrl) + '" onerror="this.style.display=\'none\'">'
              : '') +
            '<div class="a-time">' + esc(timeLabel(p.publishDate)) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>').join('');
    if (el.messages.scrollTo) el.messages.scrollTo({ top: 0 });
    else el.messages.scrollTop = 0;
  }

  /* ---------- 发送 ---------- */
  async function sendMessage() {
    if (!state.currentId || state.currentType === 'official' || !el.input) return;
    const content = el.input.value.trim();
    if (!content) return;

    const channelId = state.currentId;
    el.input.value = '';
    autoGrow();
    if (el.sendBtn) el.sendBtn.disabled = true;

    const tempId = 'temp_' + Date.now();
    const temp = {
      id: tempId, channel_id: channelId, user_id: state.me.id,
      content: content, created_at: new Date().toISOString(),
    };
    cache.addMsg(channelId, temp);
    appendMessage(decorate([temp])[0]);
    rememberLast(channelId, temp);

    try {
      const { data, error } = await supabase.from('messages').insert({
        channel_id: channelId, user_id: state.me.id, content: content,
      }).select('id, user_id, content, created_at').single();
      if (error) throw error;

      const list = cache.msgs(channelId).filter(m => m.id !== tempId);
      list.push(data);
      cache.setMsgs(channelId, list);

      const conv = state.conversations.find(c => c.id === channelId);
      if (conv) {
        conv.last_time = data.created_at;
        conv.last_msg = flatten(content, 50);
        const map = cache.lastMsg();
        map[channelId] = conv.last_msg;
        map[channelId + '_who'] = state.me.username || '我';
        cache.setLastMsg(map);
      }
      renderConversations();
    } catch (e) {
      logError('sendMessage', e);
      toast('发送失败：' + (e.message || e));
      const list = cache.msgs(channelId).filter(m => m.id !== tempId);
      cache.setMsgs(channelId, list);
      if (state.currentId === channelId) renderMessages(decorate(list));
      el.input.value = content;
    } finally {
      if (el.sendBtn) el.sendBtn.disabled = false;
    }
  }

  function autoGrow() {
    if (!el.input) return;
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 110) + 'px';
  }

  /* ---------- 已读 ---------- */
  async function markRead(channelId) {
    cache.setReadAt(channelId, new Date().toISOString());
    try {
      await supabase.from('channel_read_state').upsert({
        user_id: state.me.id,
        device_id: state.deviceId,
        channel_id: channelId,
        last_read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,device_id,channel_id' });
    } catch (e) { logError('markRead', e); }
  }

  /* ---------- 会话增删 ---------- */
  async function removeConversation(conv) {
    try {
      await supabase.from('channels').delete().eq('id', conv.id).eq('user_id', state.me.id);
      local.del(CACHE_MSG_PREFIX + conv.id);
      state.conversations = state.conversations.filter(c => c.id !== conv.id);
      if (state.currentId === conv.id) { closeChatView(); state.currentId = null; }
      renderConversations();
      toast('已删除会话');
    } catch (e) {
      logError('removeConversation', e);
      toast('删除失败：' + (e.message || e));
    }
  }

  async function leaveGroup(conv) {
    try {
      await supabase.rpc('leave_group', { p_group_id: conv.id, p_user_id: state.me.id });
      local.del(CACHE_MSG_PREFIX + conv.id);
      state.conversations = state.conversations.filter(c => c.id !== conv.id);
      if (state.currentId === conv.id) { closeChatView(); state.currentId = null; }
      renderConversations();
      toast('已退出群聊');
    } catch (e) {
      logError('leaveGroup', e);
      toast('退出失败：' + (e.message || e));
    }
  }

  async function createGroup() {
    openSheet('发起群聊', [
      {
        label: '输入群名称', run: () => {
          const name = (prompt('输入群名称（最多 20 字）') || '').trim();
          if (!name) return;
          doCreateGroup(name);
        },
      },
    ]);
  }
  async function doCreateGroup(name) {
    try {
      const { data, error } = await supabase.rpc('create_group', { p_name: name, p_creator: state.me.id });
      if (error) throw error;
      toast('群聊已创建');
      await refreshFromServer();
      if (data) {
        const conv = state.conversations.find(c => c.id === data);
        if (conv) openChannel(conv);
      }
    } catch (e) {
      logError('createGroup', e);
      toast('创建失败：' + (e.message || e));
    }
  }

  async function startPrivateChat(otherId) {
    if (!otherId || otherId === state.me.id) { toast('不能和自己聊天'); return; }
    try {
      const { data, error } = await supabase.rpc('get_or_create_private_chat', {
        p_user_a: state.me.id, p_user_b: otherId,
      });
      if (error) throw error;
      await refreshFromServer();
      let conv = state.conversations.find(c => c.id === data);
      if (!conv) {
        conv = { id: data, name: nicknameOf(otherId, state.me), type: 'private', unread: 0, last_time: null, last_msg: '' };
        state.conversations.push(conv);
      }
      switchTab('chats');
      openChannel(conv);
    } catch (e) {
      logError('startPrivateChat', e);
      toast('创建私聊失败：' + (e.message || e));
    }
  }

  async function addFriend(userId) {
    try {
      await supabase.rpc('add_friend', { p_user: state.me.id, p_friend: userId });
      toast('已加为好友');
    } catch (e) {
      logError('addFriend', e);
      toast('加好友失败');
    }
  }

  /* ---------- 通讯录 / 发现 / 搜索 ---------- */
  async function loadContacts() {
    if (!el.listContacts) return;
    el.listContacts.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const { data: friends, error } = await supabase.from('friends')
        .select('friend_id').eq('user_id', state.me.id);
      if (error) throw error;
      const ids = (friends || []).map(f => f.friend_id).filter(Boolean);
      if (!ids.length) {
        el.listContacts.innerHTML = '<div class="empty-tip">还没有好友<br>在「微信」页搜索 ID 加好友</div>';
        return;
      }
      await ensureProfiles(ids);
      const profiles = cache.profiles();
      el.listContacts.innerHTML = ids.map(id => {
        const name = (profiles[id] && profiles[id].nickname) || id;
        return personHtml(id, name, id, '');
      }).join('');
      bindPeople(el.listContacts);
    } catch (e) {
      logError('loadContacts', e);
      el.listContacts.innerHTML = '<div class="empty-tip">加载失败：' + esc(e.message || e) + '</div>';
    }
  }

  async function loadDiscover() {
    if (!el.listDiscover) return;
    el.listDiscover.innerHTML = '<div class="empty-tip">加载中…</div>';
    try {
      const { data, error } = await supabase.from('profiles')
        .select('id, nickname').neq('id', state.me.id).limit(100);
      if (error) throw error;
      if (!data || !data.length) {
        el.listDiscover.innerHTML = '<div class="empty-tip">还没有其他用户</div>';
        return;
      }
      const profiles = cache.profiles();
      data.forEach(p => { profiles[p.id] = p; });
      cache.setProfiles(profiles);
      el.listDiscover.innerHTML = data.map(p => personHtml(p.id, p.nickname || p.id, p.id, '')).join('');
      bindPeople(el.listDiscover);
    } catch (e) {
      logError('loadDiscover', e);
      el.listDiscover.innerHTML = '<div class="empty-tip">加载失败：' + esc(e.message || e) + '</div>';
    }
  }

  function personHtml(id, name, desc, badge) {
    return '' +
      '<div class="list-item" data-uid="' + esc(id) + '">' +
        '<div class="item-inner">' +
          '<div class="avatar">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>' +
          '<div class="item-body">' +
            '<div class="item-name">' + esc(name) + '</div>' +
            '<div class="item-preview">' + esc(desc || '') + '</div>' +
          '</div>' +
          (badge ? '<div class="item-meta">' + badge + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  function bindPeople(container) {
    $$('#' + container.id + ' .list-item').forEach(item => {
      const uid = item.dataset.uid;
      item.querySelector('.item-inner').addEventListener('click', () => {
        openSheet(nicknameOf(uid, state.me), [
          { label: '发消息', run: () => startPrivateChat(uid) },
          { label: '加为好友', run: () => addFriend(uid) },
        ]);
      });
    });
  }

  async function doSearch(keyword) {
    const q = (keyword || '').trim();
    if (!q) { switchTab('chats'); renderConversations(); return; }
    if (!el.listDiscover) return;
    switchTab('discover');
    el.listDiscover.innerHTML = '<div class="empty-tip">搜索中…</div>';
    try {
      const { data, error } = await supabase.from('profiles')
        .select('id, nickname')
        .or('id.eq.' + q + ',nickname.ilike.%' + q + '%')
        .limit(30);
      if (error) throw error;
      const list = (data || []).filter(p => p.id !== state.me.id);
      if (!list.length) {
        el.listDiscover.innerHTML = '<div class="empty-tip">没有找到匹配的用户</div>';
        return;
      }
      const profiles = cache.profiles();
      list.forEach(p => { profiles[p.id] = p; });
      cache.setProfiles(profiles);
      el.listDiscover.innerHTML = list.map(p => personHtml(p.id, p.nickname || p.id, p.id, '')).join('');
      bindPeople(el.listDiscover);
    } catch (e) {
      logError('doSearch', e);
      el.listDiscover.innerHTML = '<div class="empty-tip">搜索失败：' + esc(e.message || e) + '</div>';
    }
  }

  /* ---------- 服务器同步 ---------- */
  async function refreshFromServer() {
    try {
      const { data: rows, error } = await supabase.from('channels')
        .select('id, name, type')
        .eq('user_id', state.me.id)
        .gt('slot', 0);
      if (error) throw error;

      const convs = buildConversations(rows, state.me);

      // 私聊名字取对方昵称
      const privates = convs.filter(c => c.type === 'private');
      for (const conv of privates) {
        try {
          const { data: peer } = await supabase.from('channels')
            .select('user_id').eq('id', conv.id).neq('user_id', state.me.id).limit(1).maybeSingle();
          if (peer && peer.user_id) {
            await ensureProfiles([peer.user_id]);
            conv.name = nicknameOf(peer.user_id, state.me);
          }
        } catch (e) { logError('peerName', e); }
      }

      // 一次性取最近消息：得到最后时间 / 预览 / 未读
      const ids = convs.filter(c => c.type !== 'official').map(c => c.id);
      let recent = [];
      if (ids.length) {
        const { data } = await supabase.from('messages')
          .select('id, channel_id, user_id, content, created_at')
          .in('channel_id', ids)
          .order('created_at', { ascending: false })
          .limit(200);
        recent = data || [];
      }
      await ensureProfiles(recent.map(m => m.user_id));

      const lastMap = cache.lastMsg();
      convs.forEach(conv => {
        if (conv.type === 'official') return;
        const mine = recent.filter(m => m.channel_id === conv.id);
        const last = mine[0];
        if (last) {
          conv.last_time = last.created_at;
          const who = (last.user_id === state.me.id)
            ? (state.me.username || '我')
            : ((cache.profiles()[last.user_id] || {}).nickname || '');
          lastMap[conv.id] = flatten(last.content, 50);
          lastMap[conv.id + '_who'] = who;
          const since = cache.readAt(conv.id);
          conv.unread = since ? mine.filter(m => new Date(m.created_at) > new Date(since)).length : 0;
        }
      });
      cache.setLastMsg(lastMap);

      state.conversations = convs;
      renderConversations();
      preloadLastMessages(convs);
    } catch (e) {
      logError('refreshFromServer', e);
      const cached = cache.conversations();
      if (cached && cached.length) {
        state.conversations = cached.map(c => Object.assign({ unread: 0, last_msg: '' }, c));
        renderConversations();
      } else {
        state.conversations = buildConversations([], state.me);
        renderConversations();
      }
      toast('会话加载失败，请检查网络');
    }
  }

  /* 后台预取最近消息，保证点进去立刻有内容
     注意：supabase 的查询构造器是 thenable（只有 then，没有 catch），
     必须用 Promise.resolve 包一层再挂 catch。 */
  function preloadLastMessages(convs) {
    convs.filter(c => c.type !== 'official').forEach(conv => {
      if (cache.msgs(conv.id).length) return;
      Promise.resolve(
        supabase.from('messages')
          .select('id, user_id, content, created_at')
          .eq('channel_id', conv.id)
          .order('created_at', { ascending: true })
          .limit(50)
      )
        .then(({ data }) => { if (data && data.length) cache.setMsgs(conv.id, data); })
        .catch(e => logError('preload', e));
    });
  }

  /* ---------- 实时 + 轮询兜底 ---------- */
  function subscribeRealtime() {
    try {
      supabase.channel('chat-rt')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
          const m = payload.new;
          state.lastRealtimeAt = Date.now();
          cache.addMsg(m.channel_id, m);
          const conv = state.conversations.find(c => c.id === m.channel_id);
          const mine = m.user_id === state.me.id;

          ensureProfiles([m.user_id]).then(() => {
            if (state.currentId === m.channel_id && state.currentType !== 'official') {
              appendMessage(decorate([m])[0]);
              markRead(m.channel_id);
            } else if (conv) {
              conv.unread = (conv.unread || 0) + 1;
              const map = cache.lastMsg();
              map[conv.id] = flatten(m.content, 50);
              map[conv.id + '_who'] = mine ? (state.me.username || '我')
                : ((cache.profiles()[m.user_id] || {}).nickname || '');
              cache.setLastMsg(map);
              renderConversations();
            } else {
              refreshFromServer();
            }
            if (!mine && state.currentId !== m.channel_id) {
              beep();
              desktopNotify('梓睿聊天 · ' + nicknameOf(m.user_id, state.me), flatten(m.content, 80));
            }
          });
        })
        .subscribe(status => {
          state.realtimeState = status;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            logError('realtime', status);
          }
        });
    } catch (e) { logError('subscribeRealtime', e); }
  }

  function startPolling() {
    state.pollTimer = setInterval(() => {
      if (state.realtimeState === 'SUBSCRIBED' && Date.now() - state.lastRealtimeAt < 60000) return;
      if (document.visibilityState !== 'visible') return;
      refreshFromServer();
    }, 15000);
  }

  /* ---------- 设置页 ---------- */
  function renderSettingsAccount() {
    const avatar = $('#stAvatar');
    if (avatar) avatar.textContent = (state.me.username || '?').charAt(0).toUpperCase();
    const name = $('#stName');
    if (name) name.textContent = state.me.username || '用户';
    const id = $('#stId');
    if (id) id.textContent = 'ID：' + state.me.id;
    const email = $('#stEmail');
    if (email) email.textContent = state.me.email || '未绑定';
    const role = $('#stRole');
    if (role) role.textContent = state.me.role || 'user';
    const nick = $('#stNickname');
    if (nick) nick.value = state.me.username || '';
    syncSettingsUI();
  }

  function syncSettingsUI() {
    const seg = (sel, val) => {
      const box = $(sel);
      if (!box) return;
      $$(sel + ' button').forEach(b => b.classList.toggle('active', b.dataset.value === val));
    };
    seg('#segTheme', settings.theme);
    seg('#segSize', settings.fontSize);
    seg('#segDensity', settings.bubbleDensity);
    const sw = (sel, val) => { const e2 = $(sel); if (e2) e2.checked = !!val; };
    sw('#swPreview', settings.showPreview);
    sw('#swBadge', settings.showBadge);
    sw('#swSound', settings.notifySound);
    sw('#swDesktop', settings.notifyDesktop);
    sw('#swDnd', settings.dnd);
    sw('#swAutoImg', settings.autoDownloadImage);
  }

  function setSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applyTheme();
    syncSettingsUI();
    if (key === 'showPreview' || key === 'showBadge') renderConversations();
    if (key === 'theme' && state.currentType === 'official') renderOfficial(local.get(CACHE_OFFICIAL_KEY, []));
  }

  async function saveNickname() {
    const input = $('#stNickname');
    const btn = $('#btnSaveNick');
    const value = (input && input.value || '').trim();
    if (value.length < 2 || value.length > 20) { toast('昵称需 2–20 个字符'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '保存中'; }
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: state.me.id, nickname: value, last_seen_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;

      state.me.username = value;
      const profiles = cache.profiles();
      profiles[state.me.id] = { id: state.me.id, nickname: value };
      cache.setProfiles(profiles);
      Cookie.set('displayName', value, 7);
      try { sessionStorage.setItem('displayName', value); } catch (e) {}
      const raw = Cookie.get('user_data') || sessionStorage.getItem('user_data');
      if (raw) {
        try {
          const u = JSON.parse(raw);
          u.username = value;
          Cookie.set('user_data', JSON.stringify(u), 7);
          sessionStorage.setItem('user_data', JSON.stringify(u));
        } catch (e) {}
      }
      renderSettingsAccount();
      toast('昵称已更新');
    } catch (e) {
      logError('saveNickname', e);
      toast('保存失败：' + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  }

  async function changePassword() {
    const oldPwd = ($('#stOldPwd') || {}).value || '';
    const p1 = ($('#stNewPwd') || {}).value || '';
    const p2 = ($('#stNewPwd2') || {}).value || '';
    const btn = $('#btnChangePwd');
    if (!oldPwd || !p1 || !p2) { toast('请填写完整的密码信息'); return; }
    if (p1.length < 6) { toast('新密码至少 6 位'); return; }
    if (p1 !== p2) { toast('两次输入的新密码不一致'); return; }

    if (btn) { btn.disabled = true; btn.textContent = '提交中'; }
    try {
      const token = Cookie.get('auth_token') || sessionStorage.getItem('auth_token') || '';
      const r = await fetch(API_BASE + '/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ user_id: state.me.id, old_password: oldPwd, new_password: p1 }),
      });
      let data = {};
      try { data = await r.json(); } catch (e) {}
      if (r.ok && (data.success || data.ok)) {
        toast('密码修改成功');
        ['#stOldPwd', '#stNewPwd', '#stNewPwd2'].forEach(s => { const i = $(s); if (i) i.value = ''; });
      } else {
        toast('修改失败：' + (data.error || data.message || ('HTTP ' + r.status)));
      }
    } catch (e) {
      logError('changePassword', e);
      toast('无法连接账号服务器');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '修改密码'; }
    }
  }

  async function loadDevices() {
    const box = $('#deviceList');
    if (!box) return;
    box.innerHTML = '<div class="cell"><span class="cell-desc">加载中…</span></div>';
    try {
      const { data, error } = await supabase.from('user_devices')
        .select('device_id, device_name, last_active_at')
        .eq('user_id', state.me.id)
        .order('last_active_at', { ascending: false });
      if (error) throw error;
      const title = $('#deviceTitle');
      if (title) title.textContent = '登录设备管理（' + (data || []).length + '/3）';
      if (!data || !data.length) {
        box.innerHTML = '<div class="cell"><span class="cell-desc">暂无记录</span></div>';
        return;
      }
      box.innerHTML = data.map(d => {
        const current = d.device_id === state.deviceId;
        const icon = /Windows/i.test(d.device_name || '') ? '🖥️'
          : /macOS/i.test(d.device_name || '') ? '💻'
          : /Android|iOS/i.test(d.device_name || '') ? '📱' : '🌐';
        return '' +
          '<div class="device-item">' +
            '<div class="device-icon">' + icon + '</div>' +
            '<div class="device-body">' +
              '<div class="device-name">' + esc(d.device_name || '未知设备') +
                (current ? '<span class="device-current">当前</span>' : '') +
              '</div>' +
              '<div class="device-meta">最近活跃：' + esc(fullTime(d.last_active_at)) + '</div>' +
            '</div>' +
            (current ? '' : '<button class="mini-btn" data-kick="' + esc(d.device_id) + '">退出</button>') +
          '</div>';
      }).join('');

      $$('#deviceList [data-kick]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.kick;
          openSheet('退出该设备？该设备需要重新登录', [{
            label: '退出该设备', danger: true,
            run: async () => {
              try {
                await supabase.from('user_devices').delete()
                  .eq('user_id', state.me.id).eq('device_id', id);
                toast('已退出该设备');
                loadDevices();
              } catch (e) { logError('kickDevice', e); toast('操作失败'); }
            },
          }]);
        });
      });
    } catch (e) {
      logError('loadDevices', e);
      box.innerHTML = '<div class="cell"><span class="cell-desc">设备列表加载失败</span></div>';
    }
  }

  function updateCacheInfo() {
    const desc = $('#cacheDesc');
    if (!desc) return;
    let total = 0, count = 0, msgs = 0, msgCount = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || '';
        const b = (k.length + v.length) * 2;
        total += b; count++;
        if (k.indexOf(CACHE_MSG_PREFIX) === 0) { msgs += b; msgCount++; }
      }
    } catch (e) {}
    desc.textContent = '共 ' + count + ' 项 · 约 ' + bytes(total) +
      '（' + msgCount + ' 个会话约 ' + bytes(msgs) + '）';
  }

  function clearCurrentChannel() {
    if (!state.currentId) { toast('请先打开一个会话'); return; }
    const id = state.currentId;
    openSheet('清空当前会话的本机记录？', [{
      label: '清空', danger: true,
      run: () => {
        local.del(CACHE_MSG_PREFIX + id);
        if (state.currentId === id) renderMessages([]);
        updateCacheInfo();
        toast('已清空本机记录');
      },
    }]);
  }

  function clearAll() {
    openSheet('清空本机全部聊天记录？', [{
      label: '清空（不影响服务器）', danger: true,
      run: () => {
        try {
          const del = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k.indexOf(CACHE_MSG_PREFIX) === 0 || k === CACHE_LASTMSG_KEY ||
                k === CACHE_PROFILE_KEY || k === CACHE_OFFICIAL_KEY || k === CACHE_CONV_KEY) del.push(k);
          }
          del.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
        state.conversations.forEach(c => { c.unread = 0; });
        renderConversations();
        updateCacheInfo();
        toast('已清空本机聊天记录');
      },
    }]);
  }

  function resetSettings() {
    openSheet('恢复默认设置？', [{
      label: '恢复默认', danger: true,
      run: () => {
        Object.keys(DEFAULT_SETTINGS).forEach(k => { settings[k] = DEFAULT_SETTINGS[k]; });
        saveSettings();
        applyTheme();
        syncSettingsUI();
        renderConversations();
        toast('已恢复默认设置');
      },
    }]);
  }

  async function checkUpdate() {
    const state2 = $('#updateState');
    if (state2) state2.textContent = '检查中';
    try {
      await fetch(HOME_URL, { method: 'HEAD', cache: 'no-store' });
      if (state2) state2.textContent = '已是最新';
      toast('当前已是最新版本');
    } catch (e) {
      if (state2) state2.textContent = '离线';
      toast('网络不可用');
    }
  }

  async function checkNetwork() {
    const elState = $('#netState');
    if (elState) elState.textContent = '检测中';
    const parts = [];
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1);
      parts.push(error ? '聊天服务异常' : '聊天服务正常');
    } catch (e) { parts.push('聊天服务异常'); }
    try {
      await fetch(API_BASE + '/health', { signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined });
      parts.push('账号服务器正常');
    } catch (e) { parts.push('账号服务器不可达'); }
    const text = parts.join(' · ');
    if (elState) elState.textContent = text;
    toast('网络检测：' + text);
  }

  function copyId() {
    const text = state.me.id;
    const done = () => toast('已复制用户 ID');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(done);
    else {
      const i = document.createElement('input');
      i.value = text;
      document.body.appendChild(i);
      i.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(i);
      done();
    }
  }

  /* ---------- 软键盘适配 ---------- */
  function bindViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const open = keyboard > 80;
      document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      if (el.composer) {
        el.composer.style.transform = open ? 'translateY(-' + keyboard + 'px)' : '';
        el.composer.style.position = open ? 'fixed' : '';
        el.composer.style.left = open ? '0' : '';
        el.composer.style.right = open ? '0' : '';
        el.composer.style.bottom = open ? '0' : '';
      }
      if (el.readonlyNote && open) el.readonlyNote.style.transform = 'translateY(-' + keyboard + 'px)';
      if (open) setTimeout(() => scrollToEnd(), 60);
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    bindTabbar(tab => {
      // 首次进入标签时按需加载
      if (tab === 'contacts') loadContacts();
      if (tab === 'discover') loadDiscover();
      if (tab === 'me') renderSettingsAccount();
    });

    const topSearch = $('#btnTopSearch');
    if (topSearch) {
      topSearch.addEventListener('click', () => {
        const bar = $('#searchBar');
        if (!bar) return;
        const show = !bar.classList.contains('show');
        bar.classList.toggle('show', show);
        bar.dataset.forced = show ? '1' : '0';
        if (show && el.searchInput) setTimeout(() => el.searchInput.focus(), 120);
      });
    }

    const topAdd = $('#btnTopAdd');
    if (topAdd) {
      topAdd.addEventListener('click', () => {
        openSheet('更多', [
          { label: '发起群聊', run: createGroup },
          {
            label: '添加好友（按 ID / 昵称搜索）', run: () => {
              const bar = $('#searchBar');
              if (bar) { bar.classList.add('show'); bar.dataset.forced = '1'; }
              switchTab('chats');
              if (el.searchInput) setTimeout(() => el.searchInput.focus(), 120);
            },
          },
          { label: '刷新会话列表', run: () => { refreshFromServer(); toast('已刷新'); } },
          { label: '设置', run: openSettingsView },
        ]);
      });
    }

    if (el.searchInput) {
      el.searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.searchInput.blur(); doSearch(el.searchInput.value); }
      });
    }

    const chatBack = $('#chatBack');
    if (chatBack) chatBack.addEventListener('click', () => history.back());
    const setBack = $('#setBack');
    if (setBack) setBack.addEventListener('click', () => history.back());

    const chatMore = $('#chatMore');
    if (chatMore) {
      chatMore.addEventListener('click', () => {
        if (!state.currentId) { toast('请先选择一个会话'); return; }
        const actions = [{ label: '设置', run: openSettingsView }];
        if (state.currentType === 'group') {
          actions.unshift({
            label: '退出群聊', danger: true, run: () => {
              const conv = state.conversations.find(c => c.id === state.currentId);
              if (conv) leaveGroup(conv);
            },
          });
        }
        if (state.currentType === 'private') {
          actions.unshift({
            label: '删除会话', danger: true, run: () => {
              const conv = state.conversations.find(c => c.id === state.currentId);
              if (conv) removeConversation(conv);
            },
          });
        }
        if (state.currentType === 'official') {
          actions.unshift({ label: '刷新公告', run: () => loadOfficial() });
        }
        if (state.currentType !== 'official') {
          actions.push({
            label: '清空本机记录', run: () => {
              local.del(CACHE_MSG_PREFIX + state.currentId);
              renderMessages([]);
              toast('已清空本机记录');
            },
          });
        }
        openSheet('操作', actions);
      });
    }

    if (el.sendBtn) el.sendBtn.addEventListener('click', sendMessage);
    if (el.input) {
      el.input.addEventListener('input', autoGrow);
      el.input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
      });
    }
    const btnEmoji = $('#btnEmoji');
    if (btnEmoji) {
      btnEmoji.addEventListener('click', () => {
        openEmoji(ch => {
          if (!el.input) return;
          el.input.value += ch;
          autoGrow();
          el.input.focus();
        });
      });
    }

    // 设置页交互
    const segBind = (sel, key) => {
      $$(sel + ' button').forEach(b => {
        b.addEventListener('click', () => setSetting(key, b.dataset.value));
      });
    };
    segBind('#segTheme', 'theme');
    segBind('#segSize', 'fontSize');
    segBind('#segDensity', 'bubbleDensity');

    const swBind = (sel, key, after) => {
      const input = $(sel);
      if (!input) return;
      input.addEventListener('change', async () => {
        if (key === 'notifyDesktop' && input.checked) {
          const ok = await ensureNotifyPermission(true);
          if (!ok) { input.checked = false; toast('需要浏览器通知权限'); return; }
        }
        setSetting(key, input.checked);
        if (typeof after === 'function') after(input.checked);
      });
    };
    swBind('#swPreview', 'showPreview');
    swBind('#swBadge', 'showBadge');
    swBind('#swSound', 'notifySound', v => { if (v) beep(); });
    swBind('#swDesktop', 'notifyDesktop');
    swBind('#swDnd', 'dnd');
    swBind('#swAutoImg', 'autoDownloadImage');

    const saveNick = $('#btnSaveNick');
    if (saveNick) saveNick.addEventListener('click', saveNickname);
    const chPwd = $('#btnChangePwd');
    if (chPwd) chPwd.addEventListener('click', changePassword);
    const copyBtn = $('#btnCopyId');
    if (copyBtn) copyBtn.addEventListener('click', copyId);
    const refreshCache = $('#btnRefreshCache');
    if (refreshCache) refreshCache.addEventListener('click', () => { updateCacheInfo(); toast('已刷新'); });

    $$('#settingsScroll [data-act]').forEach(cell => {
      cell.addEventListener('click', () => {
        const act = cell.dataset.act;
        if (act === 'testNotify') {
          beep();
          if (settings.notifyDesktop) desktopNotify('梓睿聊天 · 测试通知', '如果你看到这条通知，说明桌面通知已生效 🎉');
          toast(settings.notifySound ? '已播放测试提示音' : '提示音已关闭');
        } else if (act === 'clearChat') clearCurrentChannel();
        else if (act === 'clearAll') clearAll();
        else if (act === 'resetSet') resetSettings();
        else if (act === 'checkUpdate') checkUpdate();
        else if (act === 'checkNet') checkNetwork();
        else if (act === 'openWeb') location.href = '../index.html';
        else if (act === 'logout') logout();
      });
    });

    // 「我」页交互（聊天页里的「我」）
    $$('#paneMe [data-act]').forEach(cell => {
      cell.addEventListener('click', () => {
        const act = cell.dataset.act;
        if (act === 'settings') openSettingsView();
        else if (act === 'about') toast('梓睿聊天 · 手机版 v1.0.0');
        else if (act === 'logout') logout();
      });
    });

    // 返回键：先关全屏页
    window.addEventListener('popstate', () => {
      if ($('#settingsView') && $('#settingsView').classList.contains('open')) { closeSettingsView(); return; }
      if ($('#chatView') && $('#chatView').classList.contains('open')) {
        closeChatView();
        if (state.currentId) markRead(state.currentId);
      }
    });

    // 页面回到前台时刷新
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshFromServer();
        if (state.currentId && state.currentType !== 'official') loadMessages(state.currentId, false);
      }
    });

    document.addEventListener('click', e => {
      if (e.target.closest('#toast')) $('#toast').classList.remove('show');
    });
  }

  /* ---------- 启动 ---------- */
  async function start() {
    bindEvents();
    bindViewport();
    renderSettingsAccount();
    switchTab((history.state && history.state.tab) || 'chats');

    // 先用本机缓存秒开
    const cachedConvs = cache.conversations();
    if (cachedConvs && cachedConvs.length) {
      state.conversations = cachedConvs.map(c => Object.assign({ unread: 0, last_msg: '' }, c));
      renderConversations();
    }

    const loader = $('#loadingScreen');
    if (loader) loader.style.display = 'none';
    const app = $('#app');
    if (app) app.style.display = 'flex';

    await refreshFromServer();
    subscribeRealtime();
    startPolling();

    // 打开会话的直达链接：chat.html?channel=xxx
    const params = new URLSearchParams(location.search);
    const direct = params.get('channel');
    if (direct) {
      const conv = state.conversations.find(c => c.id === direct);
      if (conv) openChannel(conv);
    }
    const focus = params.get('focus');
    if (focus === 'settings') openSettingsView();
    else if (focus === 'discover') switchTab('discover', () => loadDiscover());
    else if (focus === 'contacts') switchTab('contacts', () => loadContacts());
    else if (focus === 'group') createGroup();
    else if (focus === 'search') {
      const bar = $('#searchBar');
      if (bar) { bar.classList.add('show'); bar.dataset.forced = '1'; }
      if (el.searchInput) setTimeout(() => el.searchInput.focus(), 200);
    }
  }

  start().catch(e => {
    logError('start', e);
    toast('启动失败：' + (e.message || e));
  });
}

/* ============================ 页面：首页 ============================ */
function initHomePage() {
  const me = loadUser();
  const app = $('#app');
  const guest = $('#guestState');

  if (!me) {
    if (guest) guest.style.display = 'flex';
    return;
  }
  if (app) app.style.display = 'flex';

  function paint() {
    const name = me.username || (me.email ? me.email.split('@')[0] : '用户');
    const initial = (name || '?').charAt(0).toUpperCase();
    const avatar = $('#meAvatar');
    if (avatar) avatar.textContent = initial;
    const n = $('#meName');
    if (n) n.textContent = name;
    const id = $('#meId');
    if (id) id.textContent = me.id;
    const hint = $('#homeAccountHint');
    if (hint) hint.textContent = '已登录：' + name;
    const themeHint = $('#meThemeHint');
    if (themeHint) themeHint.textContent = resolvedTheme() === 'dark' ? '深色' : '浅色';
    const setHint = $('#meSettingsHint');
    if (setHint) setHint.textContent = '账号、外观、通知';
  }
  paint();

  // 最近会话（读聊天页写入的缓存）
  const recent = cache.conversations();
  const box = $('#recentList');
  if (box) {
    if (!recent || !recent.length) {
      box.innerHTML = '<div class="cell"><span class="cell-desc">打开聊天页后会在这里显示最近会话</span></div>';
    } else {
      const sorted = recent.slice().sort((a, b) => new Date(b.last_time || 0) - new Date(a.last_time || 0)).slice(0, 5);
      box.innerHTML = sorted.map(c => '' +
        '<a class="cell" href="chat.html?channel=' + encodeURIComponent(c.id) + '">' +
          '<span class="avatar' + (c.type === 'official' ? ' official' : '') + '">' +
            (c.type === 'official' ? '📢' : esc((c.name || '?').charAt(0).toUpperCase())) +
          '</span>' +
          '<span class="cell-main">' +
            '<span class="cell-label">' + esc(c.name || '会话') + '</span>' +
            '<span class="cell-desc">' + esc(timeLabel(c.last_time) || '暂无消息') + '</span>' +
          '</span>' +
          (c.unread > 0 && settings.showBadge
            ? '<span class="badge-inline">' + (c.unread > 99 ? '99+' : c.unread) + '</span>'
            : '') +
          '<span class="cell-arrow"></span>' +
        '</a>').join('');
    }
  }

  bindTabbar();

  document.addEventListener('click', e => {
    const cell = e.target.closest('[data-act]');
    if (!cell) return;
    const act = cell.dataset.act;
    if (act === 'goChat') {
      const focus = cell.dataset.focus || '';
      location.href = 'chat.html' + (focus ? ('?focus=' + encodeURIComponent(focus)) : '');
    } else if (act === 'toggleTheme') {
      settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
      saveSettings();
      applyTheme();
      paint();
      toast(settings.theme === 'dark' ? '已切换到深色' : '已切换到浅色');
    } else if (act === 'about') {
      openSheet('梓睿聊天 · 手机版', [
        { label: '版本 1.0.0', run: () => {} },
        { label: '打开电脑版', run: () => { location.href = '../index.html'; } },
        { label: '检查更新', run: () => toast('当前已是最新版本') },
      ]);
    } else if (act === 'logout') {
      logout();
    }
  });

  switchTab((history.state && history.state.tab) || 'chats');
}

/* ============================ 启动分发 ============================ */
function boot() {
  try {
    if (document.getElementById('chatView')) initChatPage();
    else if (document.getElementById('app')) initHomePage();
  } catch (e) {
    logError('boot', e);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();

(function() {
'use strict';

const SUPABASE_URL = 'https://uigzsxmkulephkfkiebj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_OgyvGDiFuFAKKGYMmnq3GA_nXqIRCmW';
const PUBLIC_CHANNEL = '11111111-1111-1111-1111-111111111111';
const OFFICIAL_CHANNEL = '22222222-2222-2222-2222-222222222222';

const AIRTABLE_TOKEN = 'patdZcEB92LMLW3bQ.44a613d94083deff3df9f4fda69a7b7a6c851c56faf900b16c72c6ddff7021ea';
const AIRTABLE_BASE  = 'app9G6YeDcFq7g09r';
const AIRTABLE_TABLE = '聊天公告';

const LOGIN_URL = 'login.html';
const HOME_URL  = 'index.html';
const API_BASE  = 'https://webcloud.ziruicloud.de5.net';
const APP_VERSION = '1.0.0';

const CACHE_MSG_PREFIX = 'chat_msgs_';
const CACHE_MSG_LIMIT = 200;
const CACHE_PROFILE_KEY = 'chat_profiles_cache';
const CACHE_OFFICIAL_KEY = 'chat_official_cache';
const CACHE_READ_PREFIX = 'chat_read_';
const CACHE_OFFICIAL_TTL = 10 * 60 * 1000;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const isMobile = () => window.innerWidth <= 768;

/* ============================================================
   本机设置
   ============================================================ */
const SETTINGS_KEY = 'chat_settings';
const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 'normal',
  bubbleDensity: 'standard',
  showPreview: true,
  showBadge: true,
  notifySound: true,
  notifyDesktop: false,
  dnd: false,
  autoDownloadImage: true,
};
const SETTING_TYPES = {
  showPreview: 'bool', showBadge: 'bool', notifySound: 'bool',
  notifyDesktop: 'bool', dnd: 'bool', autoDownloadImage: 'bool',
};
let settings = Object.assign({}, DEFAULT_SETTINGS);

function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) {}
  if (raw && typeof raw === 'object') {
    Object.keys(DEFAULT_SETTINGS).forEach(k => {
      if (raw[k] === undefined || raw[k] === null) return;
      settings[k] = SETTING_TYPES[k] === 'bool' ? !!raw[k] : String(raw[k]);
    });
    // 兼容旧主题键
    if (!raw.theme) {
      const legacy = localStorage.getItem('theme');
      if (legacy) settings.theme = legacy;
    }
  } else {
    const legacy = localStorage.getItem('theme');
    if (legacy) settings.theme = legacy;
  }
}

function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  if (settings.theme && settings.theme !== 'system') {
    try { localStorage.setItem('theme', settings.theme); } catch (e) {}
  }
}

function resolvedTheme() {
  if (settings.theme === 'system') {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  return settings.theme === 'dark' ? 'dark' : 'light';
}

function applySettings() {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolvedTheme());
  root.setAttribute('data-size', settings.fontSize);
  root.setAttribute('data-density', settings.bubbleDensity);
  if (settings.notifyDesktop) ensureNotifyPermission(false);
}

function setSetting(key, value) {
  settings[key] = value;
  persistSettings();
  applySettings();
  syncSettingsUI();
  if (key === 'showPreview' || key === 'showBadge') renderList();
  if (key === 'autoDownloadImage') {
    if (currentChannelId) {
      const ch = channels.find(c => c.id === currentChannelId);
      if (ch && ch.type === 'official') loadOfficial();
    }
  }
}

/* ============================================================
   基础工具
   ============================================================ */
function getCookie(name) {
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
  }
  return null;
}
function setCookie(name, value, days) {
  let expires = '';
  if (days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    expires = '; expires=' + d.toUTCString();
  }
  document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatTime(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const diffMs = now - d;
  const diffDay = Math.floor(diffMs / 86400000);
  if (d.toDateString() === now.toDateString()) {
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  if (diffDay < 7) {
    const wd = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    return wd;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return (d.getMonth()+1) + '月' + d.getDate() + '日';
  }
  return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate();
}
function formatFullTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function formatBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
}
function deviceName() {
  const ua = navigator.userAgent;
  const b = ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Browser';
  const o = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') ? 'iOS' : 'OS';
  return b + ' / ' + o;
}
function deviceIcon(name) {
  const n = String(name || '');
  if (/Windows/i.test(n)) return '🖥️';
  if (/macOS/i.test(n)) return '💻';
  if (/Android/i.test(n)) return '📱';
  if (/iOS/i.test(n)) return '📱';
  return '🌐';
}
function toast(msg) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}
function showFatal(title, detail) {
  const s = document.getElementById('loadingScreen');
  s.innerHTML = `
    <div style="font-size:48px;margin-bottom:16px;">❌</div>
    <h2 style="color:var(--text);font-size:18px;margin-bottom:10px;">${escapeHtml(title)}</h2>
    <p style="color:var(--text-3);font-size:14px;max-width:420px;text-align:center;line-height:1.6;word-break:break-all;">${escapeHtml(detail)}</p>
    <button onclick="location.reload()" style="margin-top:20px;padding:10px 24px;background:var(--brand);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">重试</button>
  `;
}

/* ============================================================
   本地缓存
   ============================================================ */
function getCachedMsgs(channelId) {
  try { return JSON.parse(localStorage.getItem(CACHE_MSG_PREFIX + channelId) || '[]'); }
  catch (e) { return []; }
}
function setCachedMsgs(channelId, msgs) {
  try {
    const sorted = [...msgs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    localStorage.setItem(CACHE_MSG_PREFIX + channelId, JSON.stringify(sorted.slice(-CACHE_MSG_LIMIT)));
  } catch (e) {}
}
function appendCachedMsg(channelId, msg) {
  const msgs = getCachedMsgs(channelId);
  if (msgs.some(m => m.id === msg.id)) return;
  msgs.push(msg);
  setCachedMsgs(channelId, msgs);
}
function clearCachedMsgs(channelId) {
  try { localStorage.removeItem(CACHE_MSG_PREFIX + channelId); } catch (e) {}
}

let profilesCache = {};
try { profilesCache = JSON.parse(localStorage.getItem(CACHE_PROFILE_KEY) || '{}'); } catch (e) {}
function saveProfilesCache() {
  try { localStorage.setItem(CACHE_PROFILE_KEY, JSON.stringify(profilesCache)); } catch (e) {}
}
async function ensureProfiles(ids) {
  const missing = ids.filter(id => id && !profilesCache[id]);
  if (!missing.length) return;
  const { data } = await supabase.from('profiles').select('id, nickname').in('id', missing);
  (data || []).forEach(p => profilesCache[p.id] = p);
  saveProfilesCache();
}

// 本机已读位点（未登录设备也会记录，减少一次查询）
function getLocalRead(channelId) {
  try { return localStorage.getItem(CACHE_READ_PREFIX + (userId || '') + '_' + channelId); } catch (e) { return null; }
}
function setLocalRead(channelId, t) {
  try { localStorage.setItem(CACHE_READ_PREFIX + (userId || '') + '_' + channelId, t || new Date().toISOString()); } catch (e) {}
}

let lastOfficialPosts = [];
// 会话列表“最后一条消息”预览
let lastMsgCache = {};
try { lastMsgCache = JSON.parse(localStorage.getItem('chat_lastmsg_cache') || '{}') || {}; } catch (e) { lastMsgCache = {}; }
function saveLastMsgCache() {
  try { localStorage.setItem('chat_lastmsg_cache', JSON.stringify(lastMsgCache)); } catch (e) {}
}

/* ============================================================
   状态
   ============================================================ */
let me = null, userId = null, userName = '';
let deviceId = null;
let currentChannelId = null;
let currentView = 'chats';
let channels = [];
let unreadTotal = 0;
let pinnedCollapsed = false;
let settingsTab = 'account';

/* ============================================================
   读取用户
   ============================================================ */
function loadUser() {
  const params = new URLSearchParams(location.search);
  const userParam = params.get('user');
  if (userParam) {
    try {
      const u = JSON.parse(decodeURIComponent(userParam));
      if (u && u.id) {
        const displayName = u.username || (u.email ? u.email.split('@')[0] : '用户');
        sessionStorage.setItem('userId', u.id);
        sessionStorage.setItem('displayName', displayName);
        sessionStorage.setItem('user_data', JSON.stringify(u));
        history.replaceState({}, document.title, location.pathname);
        return u;
      }
    } catch (e) {}
  }
  const uid = getCookie('userId') || sessionStorage.getItem('userId');
  if (uid) {
    const raw = getCookie('user_data') || sessionStorage.getItem('user_data');
    if (raw) {
      try {
        const u = JSON.parse(raw);
        if (u && u.id) return u;
      } catch (e) {}
    }
    return {
      id: uid,
      username: getCookie('displayName') || sessionStorage.getItem('displayName') || '',
      email: getCookie('userEmail') || '',
      role: getCookie('role') || 'user',
    };
  }
  return null;
}

/* ============================================================
   初始化
   ============================================================ */
async function init() {
  try {
    if (!window.supabase || !window.supabase.createClient) {
      showFatal('Supabase SDK 未加载', 'CDN 加载失败，请检查网络后重试');
      return;
    }
    loadSettings();
    applySettings();

    me = loadUser();
    if (!me || !me.id) { location.href = LOGIN_URL; return; }

    userId = me.id;
    userName = me.username || (me.email ? me.email.split('@')[0] : '用户');

    deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('deviceId', deviceId);
    }

    const initial = userName.charAt(0).toUpperCase();
    $('#meAvatar').textContent = initial;
    $('#aboutVer').textContent = APP_VERSION;
    renderSettingsAccount();

    await ensureProfile();
    await ensureDevice();
    await loadChannels();
    await renderList();
    subscribeRealtime();
    bindSettingsEvents();

    setInterval(() => {
      supabase.from('user_devices').update({ last_active_at: new Date().toISOString() })
        .eq('user_id', userId).eq('device_id', deviceId);
    }, 30000);

    $('#loadingScreen').style.display = 'none';
    $('#app').style.display = 'flex';
    renderSettingsDevices();
  } catch (e) {
    console.error('初始化失败:', e);
    showFatal('初始化失败', e.message);
  }
}

async function ensureProfile() {
  const { error } = await supabase.from('profiles').upsert({
    id: userId, nickname: userName, last_seen_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  profilesCache[userId] = { id: userId, nickname: userName };
  saveProfilesCache();
}

async function ensureDevice() {
  const { data: devices, error } = await supabase
    .from('user_devices').select('device_id, last_active_at')
    .eq('user_id', userId).order('last_active_at', { ascending: false });
  if (error) throw new Error(error.message);

  const mine = (devices || []).find(d => d.device_id === deviceId);
  if (mine) {
    await supabase.from('user_devices').update({ last_active_at: new Date().toISOString() })
      .eq('user_id', userId).eq('device_id', deviceId);
    return;
  }
  if (devices && devices.length >= 3) {
    const oldest = devices[devices.length - 1];
    await supabase.from('user_devices').delete().eq('user_id', userId).eq('device_id', oldest.device_id);
    toast('已登出最久未使用的设备');
  }
  await supabase.from('user_devices').insert({ user_id: userId, device_id: deviceId, device_name: deviceName() });
}

/* ============================================================
   频道
   ============================================================ */
async function loadChannels() {
  channels = [
    { id: OFFICIAL_CHANNEL, name: '官方通知', type: 'official', unread: 0, last_time: null, last_msg: '' },
    { id: PUBLIC_CHANNEL, name: '公共聊天', type: 'public', unread: 0, last_time: null, last_msg: '' },
  ];

  const { data: my, error } = await supabase.from('channels')
    .select('id, name, type').eq('user_id', userId).gt('slot', 0);
  if (error) throw new Error(error.message);

  const seen = new Set();
  for (const c of my || []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    let name = c.name;
    if (c.type === 'private') {
      const { data: other } = await supabase.from('channels')
        .select('user_id').eq('id', c.id).neq('user_id', userId).limit(1).maybeSingle();
      if (other) {
        if (!profilesCache[other.user_id]) {
          const { data: p } = await supabase.from('profiles').select('id, nickname').eq('id', other.user_id).maybeSingle();
          if (p) { profilesCache[p.id] = p; saveProfilesCache(); }
        }
        name = profilesCache[other.user_id]?.nickname || other.user_id;
      }
    }
    channels.push({ id: c.id, name, type: c.type, unread: 0, last_time: null, last_msg: '' });
  }

  // 拉每个频道最后一条 + 未读数
  for (const ch of channels) {
    if (ch.type !== 'official') {
      ch.unread = await calcUnread(ch.id);
    }
    ch.last_time = await getLastMessageTime(ch.id);
  }

  // 排序：官方置顶 > 公共 > 群/私聊按时间
  channels.sort((a, b) => {
    const order = { official: 0, public: 1 };
    const oa = order[a.type] ?? 2, ob = order[b.type] ?? 2;
    if (oa !== ob) return oa - ob;
    return new Date(b.last_time || 0) - new Date(a.last_time || 0);
  });

  unreadTotal = channels.reduce((s, c) => s + (c.unread || 0), 0);
  updateTabBadge();
}

async function getLastMessageTime(channelId) {
  const { data } = await supabase.from('messages')
    .select('created_at').eq('channel_id', channelId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.created_at || null;
}

async function calcUnread(channelId) {
  let since = null;
  const { data: state } = await supabase.from('channel_read_state')
    .select('last_read_at').eq('user_id', userId).eq('device_id', deviceId)
    .eq('channel_id', channelId).maybeSingle();
  since = state?.last_read_at;
  if (!since) since = getLocalRead(channelId);
  if (!since) {
    const { data: dev } = await supabase.from('user_devices').select('last_active_at')
      .eq('user_id', userId).eq('device_id', deviceId).maybeSingle();
    since = dev?.last_active_at || '1970-01-01';
  }
  const { count } = await supabase.from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId).gt('created_at', since);
  return count || 0;
}

async function markRead(channelId) {
  setLocalRead(channelId);
  await supabase.from('channel_read_state').upsert({
    user_id: userId, device_id: deviceId, channel_id: channelId,
    last_read_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,device_id,channel_id' });
}

function unreadText(n) {
  if (!n) return '';
  return n > 99 ? '99+' : String(n);
}

function updateTabBadge() {
  const txt = settings.showBadge ? unreadText(unreadTotal) : '';
  const tab = $('#tabBadgeChats');
  if (tab) {
    if (txt) { tab.textContent = txt; tab.classList.add('show'); }
    else tab.classList.remove('show');
  }
  const rail = $('#railBadgeChats');
  if (rail) {
    // 已经在聊天列表里时，侧栏不再重复提示
    if (txt && currentView !== 'chats') { rail.textContent = txt; rail.classList.add('show'); }
    else rail.classList.remove('show');
  }
}

/* ============================================================
   会话列表
   ============================================================ */
function channelPreview(ch) {
  if (ch.type === 'official') {
    if (lastOfficialPosts.length) {
      return '[链接] ' + (lastOfficialPosts[0].title || '公告');
    }
    return '官方消息';
  }
  const last = ch.id ? lastMsgCache[ch.id] : null;
  const text = (last && settings.showPreview) ? last : (settings.showPreview ? (ch.last_msg || '') : '');
  if (text) {
    if (ch.type === 'public') return text;
    const name = (last && lastMsgCache[ch.id + '_who']) ? lastMsgCache[ch.id + '_who'] : '';
    return name ? name + '：' + text : text;
  }
  return ch.type === 'public' ? '公共频道' : ch.type === 'private' ? '私聊' : '群聊';
}

async function renderList() {
  const box = $('#list');
  updateTabBadge();
  updatePinToggle();

  if (currentView === 'chats') {
    if (!channels.length) { box.innerHTML = '<div class="empty-tip">暂无会话</div>'; return; }
    box.innerHTML = channels.map(ch => {
      const preview = settings.showPreview ? channelPreview(ch) : '';
      const timeStr = ch.last_time ? formatTime(ch.last_time) : '';
      const pinned = ch.type === 'official' || ch.type === 'public';
      const unread = ch.unread > 0;
      const badgeHtml = (unread && settings.showBadge)
        ? (ch.type === 'public' || ch.type === 'official'
            ? `<div class="badge">${unreadText(ch.unread)}</div>`
            : `<div class="dot-unread"></div>`)
        : '';
      return `
        <div class="list-item ${ch.id === currentChannelId ? 'active' : ''} ${pinned ? 'pinned' : ''} ${pinned && pinnedCollapsed ? 'pinned-collapsed' : ''}" data-id="${ch.id}">
          <div class="item-avatar" style="${ch.type === 'official' ? 'background:#576b95;' : ''}">
            ${ch.type === 'official' ? '📢' : escapeHtml((ch.name || '?').charAt(0))}
            ${unread ? '<span class="dot"></span>' : ''}
          </div>
          <div class="item-body">
            <div class="item-name">${escapeHtml(ch.name || '')}</div>
            ${preview ? `<div class="item-preview">${escapeHtml(preview)}</div>` : ''}
          </div>
          <div class="item-meta">
            <div class="item-time">${timeStr}</div>
            ${badgeHtml}
          </div>
        </div>
      `;
    }).join('');
    bindListItems();

  } else if (currentView === 'contacts') {
    const { data: friends } = await supabase.from('friends')
      .select('friend_id').eq('user_id', userId);
    const ids = (friends || []).map(f => f.friend_id).filter(Boolean);
    if (!ids.length) {
      box.innerHTML = '<div class="empty-tip">还没有好友<br>点右上角 ＋ 加好友</div>';
      return;
    }
    const { data: ps } = await supabase.from('profiles').select('id, nickname').in('id', ids);
    (ps || []).forEach(p => profilesCache[p.id] = p);
    saveProfilesCache();
    box.innerHTML = (ps || []).map(p => `
      <div class="list-item" data-uid="${p.id}">
        <div class="item-avatar">${escapeHtml((p.nickname || '?').charAt(0))}</div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(p.nickname || p.id)}</div>
          <div class="item-preview">${escapeHtml(p.id)}</div>
        </div>
      </div>
    `).join('');
    bindContactItems();

  } else if (currentView === 'strangers') {
    const { data: ps } = await supabase.from('profiles').select('id, nickname')
      .neq('id', userId).limit(200);
    (ps || []).forEach(p => profilesCache[p.id] = p);
    saveProfilesCache();
    if (!ps || !ps.length) { box.innerHTML = '<div class="empty-tip">还没有其他用户</div>'; return; }
    box.innerHTML = ps.map(p => `
      <div class="list-item" data-uid="${p.id}">
        <div class="item-avatar" style="background:#999">${escapeHtml((p.nickname || '?').charAt(0))}</div>
        <div class="item-body">
          <div class="item-name">${escapeHtml(p.nickname || p.id)}</div>
          <div class="item-preview">${escapeHtml(p.id)}</div>
        </div>
      </div>
    `).join('');
    bindContactItems();

  } else if (currentView === 'profile') {
    const initial = userName.charAt(0).toUpperCase();
    box.innerHTML = `
      <div class="profile-card">
        <div class="profile-avatar">${escapeHtml(initial)}</div>
        <div class="profile-name">${escapeHtml(userName)}</div>
        <div class="profile-id">${escapeHtml(userId)}</div>
      </div>
      <div class="profile-menu">
        <div class="set-row clickable" data-act="settings">
          <div class="row-main"><div class="row-label">设置</div></div>
          <span class="row-arrow"></span>
        </div>
        <div class="set-row clickable" data-act="clear">
          <div class="row-main"><div class="row-label">清空聊天记录</div></div>
          <span class="row-arrow"></span>
        </div>
        <div class="set-row clickable" data-act="home">
          <div class="row-main"><div class="row-label">返回首页</div></div>
          <span class="row-arrow"></span>
        </div>
        <div class="set-row clickable" data-act="logout">
          <div class="row-main"><div class="row-label" style="color:var(--danger);">退出登录</div></div>
          <span class="row-arrow"></span>
        </div>
        <div class="set-row">
          <div class="row-main">
            <div class="row-label" style="color:var(--text-3);font-size:12px;">梓睿聊天 · Windows 版 v${APP_VERSION}</div>
          </div>
        </div>
      </div>
    `;
    box.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'settings') openSettings('account');
        else if (act === 'home') location.href = HOME_URL;
        else if (act === 'clear') clearAllHistory();
        else if (act === 'logout') logout();
      });
    });
  }
}

function bindListItems() {
  $$('.list-item[data-id]').forEach(el => {
    el.addEventListener('click', () => openChannel(el.dataset.id));
    let timer;
    el.addEventListener('touchstart', () => {
      timer = setTimeout(() => showChannelMenu(el.dataset.id, el), 600);
    }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('touchmove', () => clearTimeout(timer));
    el.addEventListener('contextmenu', e => { e.preventDefault(); showChannelMenu(el.dataset.id, el); });
  });
}

function showChannelMenu(channelId, el) {
  const ch = channels.find(c => c.id === channelId);
  if (!ch) return;
  const menu = $('#ctxMenu');
  menu.classList.remove('emoji-menu');
  let html = '';
  if (ch.type === 'group') html = '<button data-act="leave">退出群聊</button>';
  else if (ch.type === 'private') html = '<button data-act="delete">删除会话</button>';
  else if (ch.type === 'public') html = '<button data-act="clear">清空本机聊天记录</button>';
  else html = '<button data-act="refresh">刷新公告</button>';

  menu.innerHTML = html;
  const r = el.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left + 40, window.innerWidth - 180)) + 'px';
  menu.style.top = Math.min(r.top, window.innerHeight - 120) + 'px';
  menu.classList.add('show');

  menu.querySelector('button').onclick = async () => {
    menu.classList.remove('show');
    const act = menu.querySelector('button').dataset.act;
    if (act === 'leave') {
      if (!confirm('确定退出该群聊？')) return;
      const { error } = await supabase.rpc('leave_group', { p_group_id: channelId, p_user_id: userId });
      if (error) { toast('退出失败'); return; }
      toast('已退出群聊');
    } else if (act === 'delete') {
      if (!confirm('确定删除该会话？')) return;
      await supabase.from('channels').delete().eq('id', channelId).eq('user_id', userId);
      clearCachedMsgs(channelId);
      toast('已删除');
    } else if (act === 'clear') {
      clearCachedMsgs(channelId);
      toast('已清空本机记录');
      return;
    } else if (act === 'refresh') {
      try { localStorage.removeItem(CACHE_OFFICIAL_KEY); } catch (e) {}
      await loadOfficial(true);
      toast('公告已刷新');
      return;
    }
    await loadChannels();
    if (currentChannelId === channelId) {
      currentChannelId = null;
      closeChat();
    }
    renderList();
  };
}

function bindContactItems() {
  $$('.list-item[data-uid]').forEach(el => {
    el.addEventListener('click', () => openPrivateChat(el.dataset.uid));
    let timer;
    const show = () => {
      const uid = el.dataset.uid;
      const menu = $('#ctxMenu');
      menu.innerHTML = `<button data-act="chat">发消息</button><button data-act="add">加好友</button>`;
      const r = el.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(r.left + 40, window.innerWidth - 180)) + 'px';
      menu.style.top = Math.min(r.top, window.innerHeight - 120) + 'px';
      menu.classList.add('show');
      menu.querySelectorAll('button').forEach(b => {
        b.onclick = async () => {
          menu.classList.remove('show');
          if (b.dataset.act === 'chat') await openPrivateChat(uid);
          if (b.dataset.act === 'add')  await addFriend(uid);
        };
      });
    };
    el.addEventListener('touchstart', () => { timer = setTimeout(show, 600); }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('touchmove', () => clearTimeout(timer));
    el.addEventListener('contextmenu', e => { e.preventDefault(); show(); });
  });
}

/* 折叠置顶聊天 */
function updatePinToggle() {
  const btn = $('#pinToggle');
  if (!btn) return;
  const show = currentView === 'chats' && channels.some(c => c.type === 'official' || c.type === 'public');
  btn.style.display = show ? 'flex' : 'none';
  btn.classList.toggle('collapsed', pinnedCollapsed);
  const t = $('#pinToggleText');
  if (t) t.textContent = pinnedCollapsed ? '展开置顶聊天' : '折叠置顶聊天';
}

/* ============================================================
   打开频道
   ============================================================ */
async function openChannel(channelId) {
  if (currentChannelId && currentChannelId !== channelId) await markRead(currentChannelId);
  currentChannelId = channelId;

  const ch = channels.find(c => c.id === channelId);
  if (!ch) return;

  $('#chatTitle').textContent = ch.name || '';
  $('#chatSub').textContent = ch.type === 'group' ? '群聊' : ch.type === 'private' ? '' : '';
  $('#inputArea').style.display = ch.type === 'official' ? 'none' : 'flex';

  if (ch.type === 'official') await loadOfficial();
  else await loadMessages(channelId);

  await markRead(channelId);
  ch.unread = 0;
  updateTabBadge();
  renderList();

  if (isMobile()) $('#chatPanel').classList.add('show');
}

function closeChat() {
  if (isMobile()) $('#chatPanel').classList.remove('show');
  currentChannelId = null;
  $('#chatTitle').textContent = '选择一个会话';
  $('#chatSub').textContent = '';
  $('#messages').innerHTML = '<div class="empty"></div>';
  $('#inputArea').style.display = 'none';
}

async function openPrivateChat(otherId) {
  if (otherId === userId) { toast('不能和自己聊天'); return; }
  const { data, error } = await supabase.rpc('get_or_create_private_chat', {
    p_user_a: userId, p_user_b: otherId,
  });
  if (error) { console.error(error); toast('创建私聊失败'); return; }
  await loadChannels();
  switchView('chats');
  await renderList();
  await openChannel(data);
}

async function addFriend(friendId) {
  if (friendId === userId) { toast('不能加自己'); return; }
  const { error } = await supabase.rpc('add_friend', { p_user: userId, p_friend: friendId });
  if (error) { toast('加好友失败'); return; }
  toast('已加为好友');
  if (currentView === 'contacts') renderList();
}

/* ============================================================
   消息加载
   ============================================================ */
async function loadMessages(channelId) {
  const box = $('#messages');
  const cached = getCachedMsgs(channelId);

  if (cached.length) {
    renderMessages(decorate(cached));
    const ids = [...new Set(cached.map(m => m.user_id).filter(Boolean))];
    ensureProfiles(ids).then(() => {
      renderMessages(decorate(getCachedMsgs(channelId)));
    });
  } else {
    box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-3);font-size:13px;">加载中...</div>';
  }

  try {
    let query = supabase.from('messages')
      .select('id, user_id, content, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true });
    if (cached.length) {
      query = query.gt('created_at', cached[cached.length - 1].created_at);
    } else {
      query = query.limit(200);
    }
    const { data: newMsgs, error } = await query;
    if (error) throw error;

    if (newMsgs && newMsgs.length) {
      const ids = [...new Set(newMsgs.map(m => m.user_id).filter(Boolean))];
      await ensureProfiles(ids);
      if (!cached.length) setCachedMsgs(channelId, newMsgs);
      else newMsgs.forEach(m => appendCachedMsg(channelId, m));
      const all = getCachedMsgs(channelId).map(m => ({
        ...m, nickname: profilesCache[m.user_id]?.nickname || m.user_id,
        isSelf: m.user_id === userId,
      }));
      renderMessages(all);
      rememberLastMsg(channelId, all[all.length - 1]);
    } else if (!cached.length) {
      box.innerHTML = '<div class="empty-tip" style="margin-top:40px;">还没有消息，发送第一条吧</div>';
    }
  } catch (e) {
    console.error('拉取消息失败:', e);
    if (!cached.length) box.innerHTML = '<div class="empty-tip">加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

function decorate(list) {
  return list.map(m => ({
    ...m,
    nickname: profilesCache[m.user_id]?.nickname || m.user_id,
    isSelf: m.user_id === userId,
  }));
}

function rememberLastMsg(channelId, msg) {
  if (!msg) return;
  lastMsgCache[channelId] = String(msg.content || '').slice(0, 60);
  lastMsgCache[channelId + '_who'] = msg.isSelf ? userName : (msg.nickname || '');
  saveLastMsgCache();
}

async function loadOfficial(force) {
  const box = $('#messages');
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(CACHE_OFFICIAL_KEY) || 'null'); } catch (e) {}
  if (!force && cache && cache.data && (Date.now() - cache.time < CACHE_OFFICIAL_TTL)) {
    lastOfficialPosts = cache.data;
    renderOfficial(cache.data); return;
  }
  if (!lastOfficialPosts.length) {
    box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-3);font-size:13px;">加载公告中...</div>';
  }
  const posts = await fetchAirtable();
  lastOfficialPosts = posts;
  try { localStorage.setItem(CACHE_OFFICIAL_KEY, JSON.stringify({ time: Date.now(), data: posts })); } catch (e) {}
  renderOfficial(posts);
  renderList();
}

function renderOfficial(posts) {
  const box = $('#messages');
  if (!posts.length) { box.innerHTML = '<div class="empty-tip">暂无公告</div>'; return; }
  box.innerHTML = posts.map(p => `
    <div class="msg official">
      <div class="msg-avatar">📢</div>
      <div class="msg-body">
        <div class="article">
          <div class="a-publisher">📢 ${escapeHtml(p.publisher)}</div>
          <div class="a-title">${escapeHtml(p.title)}</div>
          ${p.subtitle ? `<div class="a-sub">${escapeHtml(p.subtitle)}</div>` : ''}
          ${(p.imageUrl && settings.autoDownloadImage) ? `<img class="a-img" src="${escapeHtml(p.imageUrl)}" onerror="this.style.display='none'">` : ''}
          <div class="a-time">${formatTime(p.publishDate)}</div>
        </div>
      </div>
    </div>
  `).join('');
  box.scrollTop = 0;
}

async function fetchAirtable() {
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + AIRTABLE_TOKEN } });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.records || []).map(rec => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        title: f['标题'] || '无标题',
        subtitle: f['小标题'] || '',
        publisher: f['发布者'] || '系统服务',
        publishDate: f['发布时间'] || new Date().toISOString(),
        imageUrl: f['附图链接'] || '',
      };
    }).sort((a,b) => new Date(b.publishDate) - new Date(a.publishDate));
  } catch (e) { return []; }
}

/* ============================================================
   渲染消息
   ============================================================ */
let lastDayKey = '';

function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}

function renderMessages(msgs) {
  const box = $('#messages');
  if (!msgs.length) {
    box.innerHTML = '<div class="empty-tip" style="margin-top:40px;">还没有消息，发送第一条吧</div>';
    return;
  }
  let html = '';
  let prevKey = '';
  msgs.forEach(m => {
    const k = dayKey(m.created_at);
    if (k !== prevKey) {
      html += `<div class="day-sep">${escapeHtml(formatTime(m.created_at))}</div>`;
      prevKey = k;
    }
    html += msgHtml(m);
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function msgHtml(m) {
  const initial = (m.nickname || '?').charAt(0).toUpperCase();
  return `
    <div class="msg ${m.isSelf ? 'self' : ''}">
      <div class="msg-avatar" title="${escapeHtml(m.nickname || '')}">${escapeHtml(initial)}</div>
      <div class="msg-body">
        <div class="msg-name">${escapeHtml(m.nickname || '')}</div>
        <div class="msg-bubble">${escapeHtml(m.content)}</div>
      </div>
    </div>
  `;
}

function appendMessage(m) {
  const box = $('#messages');
  if (box.querySelector('.empty, .empty-tip')) box.innerHTML = '';
  box.insertAdjacentHTML('beforeend', msgHtml(m));
  box.scrollTop = box.scrollHeight;
}

/* ============================================================
   发送
   ============================================================ */
async function sendMessage() {
  const input = $('#msgInput');
  const content = input.value.trim();
  if (!content || !currentChannelId) return;
  const ch = channels.find(c => c.id === currentChannelId);
  if (ch && ch.type === 'official') { toast('官方频道不能发送消息'); return; }

  input.value = '';
  input.style.height = 'auto';
  $('#sendBtn').disabled = true;

  const tempMsg = {
    id: 'temp_' + Date.now(),
    user_id: userId, content, created_at: new Date().toISOString(),
  };
  appendCachedMsg(currentChannelId, tempMsg);
  appendMessage({ ...tempMsg, nickname: userName, isSelf: true });
  lastMsgCache[currentChannelId] = content.slice(0, 60);
  lastMsgCache[currentChannelId + '_who'] = userName;
  saveLastMsgCache();

  const { data, error } = await supabase.from('messages').insert({
    channel_id: currentChannelId, user_id: userId, content,
  }).select('id, user_id, content, created_at').single();
  $('#sendBtn').disabled = false;

  if (error) {
    console.error('发送失败:', error);
    toast('发送失败：' + error.message);
    const msgs = getCachedMsgs(currentChannelId).filter(m => m.id !== tempMsg.id);
    setCachedMsgs(currentChannelId, msgs);
    return;
  }
  const msgs = getCachedMsgs(currentChannelId).filter(m => m.id !== tempMsg.id);
  msgs.push(data);
  setCachedMsgs(currentChannelId, msgs);

  const c = channels.find(c => c.id === currentChannelId);
  if (c) { c.last_time = data.created_at; c.last_msg = content; }
  renderList();
}

/* ============================================================
   通知（提示音 / 桌面通知）
   ============================================================ */
let audioCtx = null;
function playBeep() {
  if (!settings.notifySound || settings.dnd) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    // 微信风格「咚」：两个短促的音
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
  } catch (e) {}
}

function notifySupported() { return 'Notification' in window; }

async function ensureNotifyPermission(ask) {
  const desc = $('#notifyPermDesc');
  if (!notifySupported()) {
    if (desc) desc.textContent = '当前浏览器不支持桌面通知';
    return false;
  }
  let perm = Notification.permission;
  if (ask && perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (e) {}
  }
  if (desc) {
    desc.textContent = perm === 'granted' ? '已授权 · 窗口不在前台时推送系统通知'
      : perm === 'denied' ? '已被浏览器拒绝，请在浏览器设置中允许通知'
      : '窗口不在前台时推送系统通知（点击右侧开关授权）';
  }
  const btn = $('#btnNotifyPerm');
  if (btn) btn.textContent = perm === 'granted' ? '已授权' : '检查权限';
  if (perm !== 'granted' && settings.notifyDesktop) {
    settings.notifyDesktop = false;
    persistSettings();
    syncSettingsUI();
  }
  return perm === 'granted';
}

function showDesktopNotification(title, body) {
  if (!settings.notifyDesktop || settings.dnd) return;
  if (!notifySupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, {
      body,
      tag: 'zirui-chat',
      icon: 'https://zirui6.github.io/logo1.png',
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) {}
}

function notifyIncoming(m, isSelf) {
  if (isSelf) return;
  playBeep();
  const who = profilesCache[m.user_id]?.nickname || '新消息';
  showDesktopNotification('梓睿聊天 · ' + who, String(m.content || '').slice(0, 80));
}

/* ============================================================
   Realtime
   ============================================================ */
function subscribeRealtime() {
  supabase.channel('chat-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
      const m = payload.new;
      appendCachedMsg(m.channel_id, m);

      const c = channels.find(ch => ch.id === m.channel_id);
      if (c) { c.last_time = m.created_at; }

      if (m.channel_id === currentChannelId) {
        if (!profilesCache[m.user_id]) {
          const { data: p } = await supabase.from('profiles').select('id, nickname').eq('id', m.user_id).maybeSingle();
          if (p) { profilesCache[p.id] = p; saveProfilesCache(); }
        }
        const decorated = {
          ...m, nickname: profilesCache[m.user_id]?.nickname || m.user_id,
          isSelf: m.user_id === userId,
        };
        appendMessage(decorated);
        rememberLastMsg(m.channel_id, decorated);
        await markRead(m.channel_id);
        if (c) c.last_msg = m.content;
        if (!decorated.isSelf) notifyIncoming(decorated, false);
        renderList();
      } else {
        if (c) {
          c.unread = (c.unread || 0) + 1;
          c.last_msg = m.content;
          if (c.type === 'private' || c.type === 'group') {
            const who = profilesCache[m.user_id]?.nickname || '';
            lastMsgCache[c.id] = String(m.content || '').slice(0, 60);
            lastMsgCache[c.id + '_who'] = m.user_id === userId ? userName : who;
            saveLastMsgCache();
          }
          unreadTotal = channels.reduce((s, x) => s + (x.unread || 0), 0);
          updateTabBadge();
          renderList();
        } else if (m.channel_id !== OFFICIAL_CHANNEL) {
          await loadChannels();
          await renderList();
        }
        notifyIncoming({ ...m, nickname: profilesCache[m.user_id]?.nickname || m.user_id }, m.user_id === userId);
      }
    })
    .subscribe();
}

/* ============================================================
   建群 / 群设置
   ============================================================ */
async function openCreateGroup() {
  $('#groupNameInput').value = '';
  $('#createGroupModal').classList.add('show');
  $('#groupNameInput').focus();
}
function closeCreateGroup() {
  $('#createGroupModal').classList.remove('show');
}
async function doCreateGroup() {
  const name = $('#groupNameInput').value.trim();
  if (!name) { toast('请输入群名称'); return; }
  const btn = $('#confirmGroupBtn');
  btn.disabled = true; btn.textContent = '创建中...';
  try {
    const { data: groupId, error } = await supabase.rpc('create_group', {
      p_name: name, p_creator: userId,
    });
    if (error) throw error;
    toast('群聊已创建');
    closeCreateGroup();
    await loadChannels();
    switchView('chats');
    await renderList();
    await openChannel(groupId);
  } catch (e) {
    console.error('建群失败:', e);
    toast('创建失败：' + e.message);
  }
  btn.disabled = false; btn.textContent = '创建';
}

async function openGroupSettings() {
  if (!currentChannelId) return;
  const ch = channels.find(c => c.id === currentChannelId);
  if (!ch || ch.type !== 'group') { toast('仅群聊可用'); return; }

  $('#gsTitle').textContent = ch.name || '群聊';
  $('#groupSettingsModal').classList.add('show');
  $('#gsMemberList').innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px;">加载中...</div>';
  $('#gsFriendList').innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px;">加载中...</div>';

  const { data: members } = await supabase.from('channels')
    .select('user_id, slot').eq('id', currentChannelId).gt('slot', 0)
    .not('user_id', 'is', null).order('slot', { ascending: true });

  const memberIds = (members || []).map(m => m.user_id).filter(Boolean);
  await ensureProfiles(memberIds);

  $('#gsCount').textContent = `（${memberIds.length}/100）`;
  $('#gsMemberList').innerHTML = memberIds.map(uid => `
    <div class="member-item">
      <div class="m-avatar">${escapeHtml((profilesCache[uid]?.nickname || uid).charAt(0))}</div>
      <div class="m-name">${escapeHtml(profilesCache[uid]?.nickname || uid)}${uid === userId ? '（我）' : ''}</div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px;">暂无成员</div>';

  const { data: friends } = await supabase.from('friends').select('friend_id').eq('user_id', userId);
  const friendIds = (friends || []).map(f => f.friend_id).filter(Boolean)
    .filter(id => !memberIds.includes(id));

  if (!friendIds.length) {
    $('#gsFriendList').innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px;">没有可邀请的好友</div>';
  } else {
    await ensureProfiles(friendIds);
    $('#gsFriendList').innerHTML = friendIds.map(fid => `
      <div class="member-item">
        <div class="m-avatar">${escapeHtml((profilesCache[fid]?.nickname || fid).charAt(0))}</div>
        <div class="m-name">${escapeHtml(profilesCache[fid]?.nickname || fid)}</div>
        <button class="m-action" data-invite="${fid}">邀请</button>
      </div>
    `).join('');
    $('#gsFriendList').querySelectorAll('button[data-invite]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fid = btn.dataset.invite;
        btn.disabled = true; btn.textContent = '...';
        const { error } = await supabase.rpc('join_group', { p_group_id: currentChannelId, p_user_id: fid });
        if (error) { toast('邀请失败'); btn.disabled = false; btn.textContent = '邀请'; return; }
        btn.textContent = '已加入';
        btn.classList.add('done');
        openGroupSettings();
      });
    });
  }
}
function closeGroupSettings() {
  $('#groupSettingsModal').classList.remove('show');
}
async function leaveCurrentGroup() {
  if (!currentChannelId) return;
  if (!confirm('确定退出该群聊？')) return;
  const { error } = await supabase.rpc('leave_group', { p_group_id: currentChannelId, p_user_id: userId });
  if (error) { toast('退出失败'); return; }
  toast('已退出群聊');
  closeGroupSettings();
  currentChannelId = null;
  await loadChannels();
  renderList();
  closeChat();
}

/* ============================================================
   搜索
   ============================================================ */
async function doSearch() {
  const q = $('#searchInput').value.trim();
  if (!q) { switchView('chats'); renderList(); return; }
  const { data, error } = await supabase.from('profiles')
    .select('id, nickname').or(`id.eq.${q},nickname.ilike.%${q}%`).limit(20);
  if (error) { toast('搜索失败'); return; }
  if (!data || !data.length) { toast('没找到'); return; }
  (data || []).forEach(p => profilesCache[p.id] = p);
  saveProfilesCache();

  if (data.length === 1 && data[0].id !== userId) {
    if (confirm(`找到用户：${data[0].nickname || data[0].id}\n是否加为好友？`)) {
      await addFriend(data[0].id);
    }
    return;
  }
  switchView('strangers');
  const box = $('#list');
  const filtered = data.filter(p => p.id !== userId);
  if (!filtered.length) { box.innerHTML = '<div class="empty-tip">没有匹配的用户</div>'; return; }
  box.innerHTML = filtered.map(p => `
    <div class="list-item" data-uid="${p.id}">
      <div class="item-avatar" style="background:#999">${escapeHtml((p.nickname || '?').charAt(0))}</div>
      <div class="item-body">
        <div class="item-name">${escapeHtml(p.nickname || p.id)}</div>
        <div class="item-preview">${escapeHtml(p.id)}</div>
      </div>
    </div>
  `).join('');
  bindContactItems();
}

/* ============================================================
   视图切换
   ============================================================ */
function switchView(view) {
  currentView = view;
  $$('.sidebar nav button[data-view], .mobile-tabbar button[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  updateTabBadge();
}

/* ============================================================
   设置面板
   ============================================================ */
function openSettings(tab) {
  settingsTab = tab || settingsTab || 'account';
  switchSettingsTab(settingsTab);
  $('#settingsOverlay').classList.add('show');
  if (settingsTab === 'account') { renderSettingsAccount(); renderSettingsDevices(); }
  if (settingsTab === 'chat') updateCacheInfo();
  if (settingsTab === 'notify') ensureNotifyPermission(false);
}
function closeSettings() {
  $('#settingsOverlay').classList.remove('show');
}
function switchSettingsTab(tab) {
  settingsTab = tab;
  $$('#settingsNav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.settings-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  if (tab === 'account') { renderSettingsAccount(); renderSettingsDevices(); }
  if (tab === 'chat') updateCacheInfo();
  if (tab === 'notify') ensureNotifyPermission(false);
}

function renderSettingsAccount() {
  if (!userId) return;
  const initial = (userName || '?').charAt(0).toUpperCase();
  const av = $('#stAvatar'); if (av) av.textContent = initial;
  const nm = $('#stName'); if (nm) nm.textContent = userName || '用户';
  const id = $('#stId'); if (id) id.textContent = 'ID：' + userId;
  const em = $('#stEmail'); if (em) em.textContent = (me && me.email) || (getCookie('userEmail')) || '未绑定';
  const rl = $('#stRole'); if (rl) rl.textContent = (me && me.role) || 'user';
  const nk = $('#stNickname'); if (nk) nk.value = userName || '';
}

function syncSettingsUI() {
  const seg = (sel, val) => {
    const box = $(sel);
    if (!box) return;
    box.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === val));
  };
  seg('#segTheme', settings.theme);
  seg('#segSize', settings.fontSize);
  seg('#segDensity', settings.bubbleDensity);
  const sw = (sel, val) => { const el = $(sel); if (el) el.checked = !!val; };
  sw('#swPreview', settings.showPreview);
  sw('#swBadge', settings.showBadge);
  sw('#swSound', settings.notifySound);
  sw('#swDesktop', settings.notifyDesktop);
  sw('#swDnd', settings.dnd);
  sw('#swAutoImg', settings.autoDownloadImage);
  updateTabBadge();
}

async function renderSettingsDevices() {
  const box = $('#stDeviceList');
  if (!box || !userId) return;
  const { data, error } = await supabase.from('user_devices')
    .select('device_id, device_name, last_active_at')
    .eq('user_id', userId).order('last_active_at', { ascending: false });
  if (error) {
    box.innerHTML = '<div class="device-item"><div class="d-body"><div class="d-meta">设备列表加载失败：' + escapeHtml(error.message) + '</div></div></div>';
    return;
  }
  const list = data || [];
  const cnt = $('#stDeviceCount');
  if (cnt) cnt.textContent = `（${list.length}/3）`;
  if (!list.length) {
    box.innerHTML = '<div class="device-item"><div class="d-body"><div class="d-meta">暂无记录</div></div></div>';
    return;
  }
  box.innerHTML = list.map(d => {
    const isCurrent = d.device_id === deviceId;
    return `
      <div class="device-item">
        <div class="d-icon">${deviceIcon(d.device_name)}</div>
        <div class="d-body">
          <div class="d-name">${escapeHtml(d.device_name || '未知设备')}${isCurrent ? '<span class="d-current">当前设备</span>' : ''}</div>
          <div class="d-meta">最近活跃：${escapeHtml(formatFullTime(d.last_active_at))}</div>
        </div>
        ${isCurrent ? '' : `<button class="d-kick" data-device="${escapeHtml(d.device_id)}">退出</button>`}
      </div>
    `;
  }).join('');

  box.querySelectorAll('.d-kick').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.device;
      if (!confirm('退出该设备？该设备上的聊天将需要重新登录。')) return;
      btn.disabled = true; btn.textContent = '...';
      const { error } = await supabase.from('user_devices').delete()
        .eq('user_id', userId).eq('device_id', id);
      if (error) { toast('退出失败：' + error.message); btn.disabled = false; btn.textContent = '退出'; return; }
      toast('已退出该设备');
      renderSettingsDevices();
    });
  });
}

function localStorageUsage() {
  let total = 0, count = 0, msgs = 0, msgCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      const bytes = (k.length + v.length) * 2;
      total += bytes;
      count++;
      if (k.indexOf(CACHE_MSG_PREFIX) === 0) { msgs += bytes; msgCount++; }
    }
  } catch (e) {}
  return { total, count, msgs, msgCount };
}

function updateCacheInfo() {
  const desc = $('#cacheDesc');
  if (!desc) return;
  const u = localStorageUsage();
  desc.textContent = `共 ${u.count} 项 · 约 ${formatBytes(u.total)}（其中 ${u.msgCount} 个会话记录约 ${formatBytes(u.msgs)}）`;
}

function clearAllHistory() {
  if (!confirm('清空本机全部聊天记录？\n（服务器上的消息不会被删除）')) return;
  try {
    const del = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.indexOf(CACHE_MSG_PREFIX) === 0 || k.indexOf('chat_lastmsg_cache') === 0)) del.push(k);
    }
    del.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(CACHE_PROFILE_KEY);
    localStorage.removeItem(CACHE_OFFICIAL_KEY);
  } catch (e) {}
  lastMsgCache = {};
  channels.forEach(c => { if (c.type !== 'official') c.unread = 0; });
  unreadTotal = 0;
  updateTabBadge();
  updateCacheInfo();
  renderList();
  toast('已清空本机聊天记录');
}

function resetAllSettings() {
  if (!confirm('恢复默认设置？\n外观、通知等本机设置将还原（聊天记录保留）')) return;
  settings = Object.assign({}, DEFAULT_SETTINGS);
  persistSettings();
  applySettings();
  syncSettingsUI();
  renderList();
  toast('已恢复默认设置');
}

async function changeNickname() {
  const input = $('#stNickname');
  const btn = $('#btnSaveNick');
  const val = (input.value || '').trim();
  if (val.length < 2 || val.length > 20) { toast('昵称需 2–20 个字符'); return; }
  if (val === userName) { toast('昵称没有变化'); return; }

  btn.disabled = true; btn.textContent = '保存中...';
  const { error } = await supabase.from('profiles')
    .upsert({ id: userId, nickname: val, last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
  btn.disabled = false; btn.textContent = '保存昵称';
  if (error) { toast('保存失败：' + error.message); return; }

  userName = val;
  profilesCache[userId] = { id: userId, nickname: val };
  saveProfilesCache();

  if (me) me.username = val;
  const raw = getCookie('user_data') || sessionStorage.getItem('user_data');
  if (raw) {
    try {
      const u = JSON.parse(raw);
      u.username = val;
      setCookie('user_data', JSON.stringify(u), 7);
      sessionStorage.setItem('user_data', JSON.stringify(u));
    } catch (e) {}
  }
  setCookie('displayName', val, 7);
  sessionStorage.setItem('displayName', val);

  const initial = val.charAt(0).toUpperCase();
  $('#meAvatar').textContent = initial;
  renderSettingsAccount();
  renderList();
  toast('昵称已更新');
}

async function changePassword() {
  const oldPwd = $('#stOldPwd').value;
  const p1 = $('#stNewPwd').value;
  const p2 = $('#stNewPwd2').value;
  const btn = $('#btnChangePwd');

  if (!oldPwd || !p1 || !p2) { toast('请填写完整的密码信息'); return; }
  if (p1.length < 6) { toast('新密码至少 6 位'); return; }
  if (p1 !== p2) { toast('两次输入的新密码不一致'); return; }
  if (p1 === oldPwd) { toast('新密码不能与当前密码相同'); return; }

  btn.disabled = true; btn.textContent = '提交中...';
  try {
    const token = getCookie('auth_token') || sessionStorage.getItem('auth_token') || '';
    const r = await fetch(API_BASE + '/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ user_id: userId, old_password: oldPwd, new_password: p1 }),
    });
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (r.ok && (data.success || data.ok)) {
      toast('密码修改成功');
      if (data.token) {
        setCookie('auth_token', data.token, 7);
        sessionStorage.setItem('auth_token', data.token);
      }
      $('#stOldPwd').value = ''; $('#stNewPwd').value = ''; $('#stNewPwd2').value = '';
    } else {
      toast('修改失败：' + (data.error || data.message || ('HTTP ' + r.status)));
    }
  } catch (e) {
    toast('无法连接账号服务器，请稍后再试');
  }
  btn.disabled = false; btn.textContent = '修改密码';
}

async function checkUpdate() {
  const el = $('#updateState');
  if (el) el.textContent = '检查中...';
  try {
    const r = await fetch('https://zirui6.github.io/index.html', { method: 'HEAD', cache: 'no-store' });
    if (r.ok) {
      if (el) el.textContent = '已是最新 ' + APP_VERSION;
      toast('当前已是最新版本 ' + APP_VERSION);
    } else {
      if (el) el.textContent = '检查失败';
    }
  } catch (e) {
    if (el) el.textContent = '离线';
    toast('网络不可用，无法检查更新');
  }
}

async function checkNetwork() {
  const el = $('#netState');
  if (el) el.textContent = '检测中...';
  const results = [];
  try {
    const r = await supabase.from('profiles').select('id').limit(1);
    results.push(r.error ? '聊天服务异常' : '聊天服务正常');
  } catch (e) { results.push('聊天服务异常'); }
  try {
    await fetch(API_BASE + '/health', { signal: AbortSignal.timeout(6000) });
    results.push('账号服务器正常');
  } catch (e) {
    results.push('账号服务器不可达');
  }
  const txt = results.join(' · ');
  if (el) el.textContent = txt;
  toast('网络检测：' + txt);
}

function bindSettingsEvents() {
  syncSettingsUI();
  ensureNotifyPermission(false);

  $('#railSettings').addEventListener('click', () => openSettings('account'));
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsOverlay').addEventListener('click', e => {
    if (e.target === $('#settingsOverlay')) closeSettings();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#settingsOverlay').classList.contains('show')) closeSettings();
  });

  $$('#settingsNav button').forEach(b => {
    b.addEventListener('click', () => switchSettingsTab(b.dataset.tab));
  });

  // 分段选择
  $('#segTheme').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => setSetting('theme', b.dataset.value));
  });
  $('#segSize').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => setSetting('fontSize', b.dataset.value));
  });
  $('#segDensity').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => setSetting('bubbleDensity', b.dataset.value));
  });

  // 开关
  $('#swPreview').addEventListener('change', e => setSetting('showPreview', e.target.checked));
  $('#swBadge').addEventListener('change', e => setSetting('showBadge', e.target.checked));
  $('#swSound').addEventListener('change', e => {
    setSetting('notifySound', e.target.checked);
    if (e.target.checked) playBeep();
  });
  $('#swDnd').addEventListener('change', e => setSetting('dnd', e.target.checked));
  $('#swAutoImg').addEventListener('change', e => setSetting('autoDownloadImage', e.target.checked));
  $('#swDesktop').addEventListener('change', async e => {
    if (e.target.checked) {
      const ok = await ensureNotifyPermission(true);
      if (!ok) { toast('需要浏览器通知权限'); e.target.checked = false; return; }
      setSetting('notifyDesktop', true);
      toast('桌面通知已开启');
    } else {
      setSetting('notifyDesktop', false);
    }
  });

  // 通知
  $('#btnNotifyPerm').addEventListener('click', async () => {
    const ok = await ensureNotifyPermission(true);
    toast(ok ? '通知权限已授权' : '通知权限未授权');
  });
  $('#rowTestNotify').addEventListener('click', () => {
    playBeep();
    if (settings.notifyDesktop && notifySupported() && Notification.permission === 'granted') {
      try { new Notification('梓睿聊天 · 测试通知', { body: '如果你看到这条通知，说明桌面通知已生效 🎉' }); } catch (e) {}
      toast('已发送测试通知');
    } else {
      toast(settings.notifySound ? '已播放测试提示音' : '提示音已关闭');
    }
  });

  // 账号
  $('#btnSaveNick').addEventListener('click', changeNickname);
  $('#btnChangePwd').addEventListener('click', changePassword);
  $('#stNickname').addEventListener('keydown', e => { if (e.key === 'Enter') changeNickname(); });
  $('#btnCopyId').addEventListener('click', () => {
    const done = () => toast('已复制用户 ID');
    if (navigator.clipboard) navigator.clipboard.writeText(userId).then(done).catch(done);
    else {
      const i = document.createElement('input');
      i.value = userId; document.body.appendChild(i); i.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(i); done();
    }
  });

  // 聊天
  $('#rowClearCurrent').addEventListener('click', () => {
    if (!currentChannelId) { toast('请先打开一个会话'); return; }
    if (!confirm('清空当前会话的本机记录？')) return;
    clearCachedMsgs(currentChannelId);
    updateCacheInfo();
    toast('已清空当前会话记录');
  });
  $('#btnRefreshCache').addEventListener('click', () => { updateCacheInfo(); toast('已刷新'); });
  $('#rowClearAll').addEventListener('click', clearAllHistory);
  $('#rowResetSet').addEventListener('click', resetAllSettings);

  // 关于
  $('#rowCheckUpdate').addEventListener('click', checkUpdate);
  $('#rowCheckNet').addEventListener('click', checkNetwork);
  $('#rowHome').addEventListener('click', () => location.href = HOME_URL);
  $('#rowLogout').addEventListener('click', logout);
}

/* ============================================================
   退出登录
   ============================================================ */
function logout() {
  if (!confirm('确定退出登录吗？')) return;
  ['auth_token','user_data','isLoggedIn','userId','userEmail','displayName','role'].forEach(k => {
    document.cookie = k + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });
  try {
    Object.keys(sessionStorage).forEach(k => sessionStorage.removeItem(k));
  } catch (e) { sessionStorage.clear(); }
  location.href = LOGIN_URL;
}

/* ============================================================
   事件绑定
   ============================================================ */
$$('.sidebar nav button[data-view], .mobile-tabbar button[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
    renderList();
  });
});

$('#sendBtn').addEventListener('click', sendMessage);
$('#msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('#msgInput').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});
$('#toolEmoji').addEventListener('click', e => {
  e.stopPropagation();
  const emojis = ['😀','😂','🥰','😎','🤔','😭','👍','👏','🙏','🎉','❤️','🔥','🌹','☕','🐶','🐱','✨','💪','🍀','😴'];
  const menu = $('#ctxMenu');
  menu.classList.add('emoji-menu');
  menu.innerHTML = emojis.map(x => `<button type="button" data-emoji="${x}">${x}</button>`).join('');
  const r = $('#toolEmoji').getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - 240) + 'px';
  menu.style.top = Math.max(8, r.top - 108) + 'px';
  menu.classList.add('show');
  menu.querySelectorAll('button[data-emoji]').forEach(b => {
    b.onclick = () => {
      const input = $('#msgInput');
      input.value += b.dataset.emoji;
      input.dispatchEvent(new Event('input'));
      menu.classList.remove('show');
      menu.classList.remove('emoji-menu');
      input.focus();
    };
  });
});

$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
  if (e.key === 'Escape') { $('#searchInput').value = ''; switchView('chats'); renderList(); }
});

$('#openAddBtn').addEventListener('click', e => {
  e.stopPropagation();
  const menu = $('#ctxMenu');
  menu.innerHTML = `<button data-act="addFriend">🔍 加好友</button>
    <button data-act="createGroup">👥 发起群聊</button>
    <button data-act="settings">⚙️ 设置</button>`;
  const r = $('#openAddBtn').getBoundingClientRect();
  menu.style.left = Math.max(8, r.right - 140) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  menu.classList.add('show');
  menu.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      menu.classList.remove('show');
      if (b.dataset.act === 'addFriend') {
        const q = prompt('输入对方的 ID 或昵称：');
        if (q) { $('#searchInput').value = q; doSearch(); }
      } else if (b.dataset.act === 'createGroup') {
        openCreateGroup();
      } else if (b.dataset.act === 'settings') {
        openSettings('account');
      }
    };
  });
});

$('#pinToggle').addEventListener('click', () => {
  pinnedCollapsed = !pinnedCollapsed;
  renderList();
});

$('#closeGroupModal').addEventListener('click', closeCreateGroup);
$('#cancelGroupBtn').addEventListener('click', closeCreateGroup);
$('#confirmGroupBtn').addEventListener('click', doCreateGroup);
$('#groupNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') doCreateGroup(); });

$('#closeGsModal').addEventListener('click', closeGroupSettings);
$('#closeGsBtn').addEventListener('click', closeGroupSettings);
$('#leaveGroupBtn').addEventListener('click', leaveCurrentGroup);

$('#backBtn').addEventListener('click', () => location.href = HOME_URL);
$('#backMobile').addEventListener('click', closeChat);
$('#meAvatar').addEventListener('click', () => openSettings('account'));

$('#moreBtn').addEventListener('click', e => {
  e.stopPropagation();
  if (!currentChannelId) { toast('请先选择一个会话'); return; }
  const ch = channels.find(c => c.id === currentChannelId);
  const menu = $('#ctxMenu');
  let items = '<button data-act="settings">⚙️ 设置</button>';
  if (ch && ch.type === 'group') items = '<button data-act="members">👥 群成员</button>' + items;
  if (ch && ch.type === 'private') items += '<button data-act="delete" class="danger">🗑️ 删除会话</button>';
  if (ch && (ch.type === 'public' || ch.type === 'group')) items += '<button data-act="clear">🧹 清空本机记录</button>';
  menu.innerHTML = items;
  const r = $('#moreBtn').getBoundingClientRect();
  menu.style.left = Math.max(8, r.right - 150) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  menu.classList.add('show');

  menu.querySelectorAll('button').forEach(b => {
    b.onclick = async () => {
      menu.classList.remove('show');
      const act = b.dataset.act;
      if (act === 'settings') openSettings('account');
      else if (act === 'members') openGroupSettings();
      else if (act === 'clear') { clearCachedMsgs(currentChannelId); toast('已清空本机记录'); }
      else if (act === 'delete') {
        if (!confirm('删除该会话？')) return;
        await supabase.from('channels').delete().eq('id', currentChannelId).eq('user_id', userId);
        clearCachedMsgs(currentChannelId);
        currentChannelId = null;
        closeChat();
        await loadChannels();
        renderList();
      }
    };
  });
});

// 点击空白关闭菜单
document.addEventListener('click', e => {
  if (!e.target.closest('#ctxMenu')) {
    const m = $('#ctxMenu');
    m.classList.remove('show');
    m.classList.remove('emoji-menu');
  }
});
document.addEventListener('contextmenu', e => {
  if (!e.target.closest('.list-item')) e.preventDefault();
});

// 跟随系统主题变化
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => { if (settings.theme === 'system') applySettings(); };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
}

// 窗口重新获得焦点时刷新未读数
window.addEventListener('focus', () => {
  if (currentChannelId) markRead(currentChannelId);
});

window.addEventListener('beforeunload', () => {
  if (currentChannelId && userId) {
    const body = JSON.stringify({
      user_id: userId, device_id: deviceId, channel_id: currentChannelId,
      last_read_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(
        SUPABASE_URL + '/rest/v1/channel_read_state?on_conflict=user_id,device_id,channel_id',
        blob
      );
    }
  }
});

init();
})();

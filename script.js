// ============================================================
// 梓睿聊天 · 主逻辑 v3（微信风格 + Supabase Realtime 即时刷新）
// ============================================================

// ============================================================
// 配置
// ============================================================
const CONFIG = {
    SUPABASE_URL: 'https://uigzsxmkulephkfkiebj.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_OgyvGDiFuFAKKGYMmnq3GA_nXqIRCmW',
    WEBSITE: 'https://zirui6.github.io',
    POLL_INTERVAL: 4000,          // 轮询兜底间隔（Realtime 不可用时）
    HISTORY_LIMIT: 500,
};

const AIRTABLE_CONFIG = {
    API_TOKEN: 'patdZcEB92LMLW3bQ.44a613d94083deff3df9f4fda69a7b7a6c851c56faf900b16c72c6ddff7021ea',
    BASE_ID: 'app9G6YeDcFq7g09r',
    TABLE_NAME: '聊天公告',
};

// ============================================================
// DOM 引用
// ============================================================
const $ = (id) => document.getElementById(id);

// ============================================================
// Toast
// ============================================================
let toastTimer = null;
function showToast(message, type = 'info') {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast ' + type + ' show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

// ============================================================
// 工具函数
// ============================================================
function getLocalUser() {
    try { const data = localStorage.getItem('chat_user_data'); if (data) return JSON.parse(data); } catch (e) {}
    try { const data = sessionStorage.getItem('user_data'); if (data) return JSON.parse(data); } catch (e) {}
    return null;
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + '天前';
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

// 微信式消息时间（间隔超过5分钟显示时间条）
function formatMsgTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const diffDays = Math.floor((today - thatDay) / 86400000);
    if (diffDays === 0) return hm;
    if (diffDays === 1) return '昨天 ' + hm;
    if (diffDays < 7) return d.toLocaleDateString('zh-CN', { weekday: 'long' }) + ' ' + hm;
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + hm;
}

function getInitials(name) {
    if (!name) return 'U';
    return name.charAt(0).toUpperCase();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// 页面切换
// ============================================================
function switchToPhone() {
    window.location.href = 'phone.html' + window.location.search;
}
function switchToDesktop() {
    window.location.href = 'index.html' + window.location.search;
}

// ============================================================
// 登录管理
// ============================================================
function goToLogin() {
    window.location.href = CONFIG.WEBSITE + '/user.html?redirect=' + encodeURIComponent(window.location.href);
}
function goToTest() {
    window.location.href = 'test.html';
}

// ============================================================
// 未读消息管理
// ============================================================
function getUnreadCount(chatId) {
    const key = 'chat_unread_' + chatId;
    try { const data = localStorage.getItem(key); return data ? parseInt(data) : 0; } catch (e) { return 0; }
}
function setUnreadCount(chatId, count) {
    const key = 'chat_unread_' + chatId;
    try { if (count > 0) { localStorage.setItem(key, String(count)); } else { localStorage.removeItem(key); } } catch (e) {}
}
function incrementUnread(chatId) {
    if (chatId === 'system' || chatId === 'public' || chatId === '-1') return;
    setUnreadCount(chatId, getUnreadCount(chatId) + 1);
    updateTotalBadge();
}
function clearUnread(chatId) {
    if (chatId === 'system') return;
    setUnreadCount(chatId, 0);
    updateTotalBadge();
}
function updateTotalBadge() {
    let total = 0;
    chatList.forEach(chat => {
        if (chat.id !== 'system' && chat.id !== 'public' && chat.id !== '-1') {
            total += getUnreadCount(chat.id);
        }
    });
    const badge = $('totalBadge');
    if (badge) {
        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : total;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
    return total;
}

// ============================================================
// 在线状态管理
// ============================================================
async function updateUserStatus(status) {
    if (!currentUser) return;
    try {
        await fetch(CONFIG.SUPABASE_URL + '/rest/v1/user_status', {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                user_id: currentUser.id,
                status: status,
                last_seen: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
        });
        updateOnlineStatus(status);
    } catch (error) { console.error('更新状态失败:', error); }
}

function updateOnlineStatus(status) {
    const statusText = document.getElementById('onlineStatusText');
    const dot = document.getElementById('onlineStatusDot');
    if (dot) dot.className = 'online-dot ' + status;
    if (statusText) {
        const labels = { 'online': '在线', 'offline': '离线', 'away': '离开' };
        statusText.textContent = labels[status] || '在线';
    }
}

async function getUsersStatus(userIds) {
    if (!userIds || userIds.length === 0) return {};
    try {
        const ids = userIds.join(',');
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/user_status?user_id=in.(${ids})&select=user_id,status,last_seen`,
            { headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY } }
        );
        if (response.ok) {
            const data = await response.json();
            const result = {};
            data.forEach(item => { result[item.user_id] = { status: item.status || 'offline', last_seen: item.last_seen }; });
            return result;
        }
        return {};
    } catch (error) { return {}; }
}

// ============================================================
// 登录日志
// ============================================================
async function logLogin(user) {
    if (!user) return;
    try {
        await fetch(CONFIG.SUPABASE_URL + '/rest/v1/login_logs', {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                user_id: user.id,
                username: user.username || user.display_name || '用户',
                login_time: new Date().toISOString(),
                status: 'online',
                user_agent: navigator.userAgent || ''
            })
        });
    } catch (error) { console.error('记录登录日志失败:', error); }
}

async function logLogout(user) {
    if (!user) return;
    try {
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/login_logs?user_id=eq.${encodeURIComponent(user.id)}&order=login_time.desc&limit=1`,
            { headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY } }
        );
        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                await fetch(CONFIG.SUPABASE_URL + `/rest/v1/login_logs?id=eq.${data[0].id}`, {
                    method: 'PATCH',
                    headers: {
                        'apikey': CONFIG.SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ logout_time: new Date().toISOString(), status: 'offline' })
                });
            }
        }
    } catch (error) { console.error('更新登出日志失败:', error); }
}

// ============================================================
// 全局状态
// ============================================================
let currentUser = null;
let isLoggedIn = false;
let pollingInterval = null;
let realtimeChannel = null;
let realtimeOk = false;
let messages = [];                 // 当前会话消息（已按 id 去重）
const knownMessageIds = new Set(); // 当前会话已知消息 id
let currentChat = null;
let chatList = [];
let chatListVersion = 0;           // 渲染版本号，防止竞态覆盖

const DEFAULT_AVATAR = 'https://zirui6.github.io/touxiang.jpg';

const DEFAULT_CONTACTS = [
    { id: 'system', username: '系统服务', display_name: '📢 系统公告', avatar_url: 'https://zirui6.github.io/icon48.png', is_default: true, type: 'system' },
    { id: 'public', username: '公共频道', display_name: '🌐 公共频道', avatar_url: 'https://zirui6.github.io/icon48.png', is_default: true, type: 'public' },
    { id: '-1', username: '文件传输助手', display_name: '📎 文件传输助手', avatar_url: 'https://zirui6.github.io/icon48.png', is_default: true, type: 'self' }
];

// ============================================================
// Airtable（系统公告）
// ============================================================
async function fetchAirtableData() {
    try {
        const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.BASE_ID}/${encodeURIComponent(AIRTABLE_CONFIG.TABLE_NAME)}`;
        const response = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + AIRTABLE_CONFIG.API_TOKEN, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return (data.records || []).map(record => {
            const fields = record.fields || {};
            return {
                id: record.id,
                title: fields['标题'] || '无标题',
                subtitle: fields['小标题'] || '',
                publisher: fields['发布者'] || '系统',
                publishDate: fields['发布时间'] || new Date().toISOString(),
                imageUrl: fields['附图链接'] || '',
            };
        }).sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
    } catch (error) { return []; }
}

async function loadSystemMessages() {
    const items = await fetchAirtableData();
    return items.map((item, index) => ({
        id: 'system_' + (item.id || index),
        sender_id: 'system',
        sender_name: '系统服务',
        content: item.title,
        subtitle: item.subtitle,
        publisher: item.publisher,
        publish_date: item.publishDate,
        image_url: item.imageUrl,
        created_at: item.publishDate,
        is_system: true,
        is_article: true
    }));
}

// ============================================================
// 检查登录状态
// ============================================================
function checkLoginStatus() {
    const user = getLocalUser();
    if (user && user.id) {
        currentUser = user;
        isLoggedIn = true;
        $('loginOverlay')?.classList.remove('show');
        updateUIForLoggedIn();
        return true;
    }
    isLoggedIn = false;
    currentUser = null;
    $('loginOverlay')?.classList.add('show');
    updateUIForGuest();
    return false;
}

// ============================================================
// UI 更新
// ============================================================
function updateUIForLoggedIn() {
    if (!currentUser) return;
    const avatar = $('myAvatar');
    if (avatar) { avatar.src = currentUser.avatar_url || DEFAULT_AVATAR; }
    logLogin(currentUser);
    updateUserStatus('online');
    loadChats();
    startRealtime();   // 优先 Realtime
    startPolling();    // 轮询兜底（Realtime 不通时自动接管）
}

function updateUIForGuest() {
    const list = $('chatList');
    if (list) {
        list.innerHTML = `<div class="sidebar-empty"><div class="empty-icon">🔒</div><p>请先登录</p></div>`;
    }
    const chatInput = $('chatInput');
    const chatHeader = $('chatHeader');
    const emptyState = $('emptyState');
    if (chatInput) chatInput.style.display = 'none';
    if (chatHeader) chatHeader.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    const messageList = $('messageList');
    if (messageList) messageList.innerHTML = '';
}

// ============================================================
// 加载聊天列表
// ============================================================
async function loadChats() {
    if (!isLoggedIn) return;
    const myVersion = ++chatListVersion;
    try {
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/messages?order=created_at.desc&limit=${CONFIG.HISTORY_LIMIT}`,
            { headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY } }
        );

        let userChats = [];
        if (response.ok) {
            const data = await response.json();
            const userSet = new Set();
            data.forEach(msg => {
                if (msg.sender_id === 'system' || msg.receiver_id === 'system') return;
                if (msg.receiver_id === 'public' || msg.receiver_id === 'null' || msg.receiver_id === null) return;
                if (msg.sender_id === '-1' || msg.receiver_id === '-1') return;
                if (msg.sender_id) userSet.add(msg.sender_id);
                if (msg.receiver_id) userSet.add(msg.receiver_id);
            });

            userChats = Array.from(userSet)
                .filter(id => id !== currentUser.id)
                .map(id => {
                    const msgs = data.filter(m =>
                        (m.sender_id === id && m.receiver_id === currentUser.id) ||
                        (m.sender_id === currentUser.id && m.receiver_id === id)
                    );
                    const lastMsg = msgs.length > 0 ? msgs[0] : null;
                    const anyMsg = lastMsg || data.find(m => m.sender_id === id);
                    return {
                        id: id,
                        username: anyMsg?.sender_name || '用户',
                        display_name: anyMsg?.sender_name || '用户',
                        avatar_url: DEFAULT_AVATAR,
                        last_message: lastMsg?.content || '暂无消息',
                        last_time: lastMsg?.created_at || anyMsg?.created_at || new Date().toISOString(),
                        type: 'friend'
                    };
                });
        }

        const existingIds = new Set(userChats.map(c => c.id));
        const allChats = [...DEFAULT_CONTACTS.filter(c => !existingIds.has(c.id)), ...userChats];
        const seen = new Set();
        chatList = allChats.filter(c => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
        }).sort((a, b) => {
            if (a.is_default && !b.is_default) return -1;
            if (!a.is_default && b.is_default) return 1;
            return new Date(b.last_time) - new Date(a.last_time);
        });

        if (myVersion !== chatListVersion) return; // 已有更新渲染
        renderChatList();

        if (chatList.length > 0 && !currentChat) {
            const systemChat = chatList.find(c => c.id === 'system');
            selectChat(systemChat || chatList[0]);
        }
    } catch (error) {
        console.error('加载聊天失败:', error);
        chatList = DEFAULT_CONTACTS;
        renderChatList();
        if (chatList.length > 0 && !currentChat) selectChat(chatList[0]);
    }
}

// ============================================================
// 渲染聊天列表
// ============================================================
function renderChatList() {
    const list = $('chatList');
    if (!list) return;

    if (chatList.length === 0) {
        list.innerHTML = `<div class="sidebar-empty"><div class="empty-icon">👥</div><p>暂无聊天</p></div>`;
        return;
    }

    const userIds = chatList
        .map(c => c.id)
        .filter(id => id && id !== 'system' && id !== 'public' && id !== '-1');

    getUsersStatus(userIds).then(statusMap => {
        if (chatListVersion === 0) return;
        list.innerHTML = chatList.map(chat => {
            const active = currentChat && currentChat.id === chat.id;
            const name = escapeHtml(chat.display_name || chat.username || '用户');
            const avatar = chat.avatar_url || DEFAULT_AVATAR;
            const lastMsg = escapeHtml(chat.last_message || '暂无消息');
            const time = chat.last_time ? formatTime(chat.last_time) : '';
            const unread = chat.id !== 'system' ? getUnreadCount(chat.id) : 0;
            let statusDot = '';
            if (chat.type === 'friend' && chat.id !== '-1') {
                const st = statusMap[chat.id];
                statusDot = st && st.status === 'online'
                    ? '<span class="status-dot-online"></span>'
                    : '<span class="status-dot-offline"></span>';
            }
            return `
                <div class="chat-item ${active ? 'active' : ''}" data-id="${chat.id}" onclick="selectChatById('${chat.id}')">
                    <div class="avatar-wrapper">
                        <img src="${avatar}" class="avatar" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                        <div class="avatar default" style="display:none;">${getInitials(chat.display_name || chat.username)}</div>
                        ${statusDot}
                    </div>
                    <div class="info">
                        <div class="name">${name}</div>
                        <div class="last-msg">${lastMsg}</div>
                    </div>
                    <div class="meta">
                        <div class="time">${time}</div>
                        ${unread > 0 ? `<div class="unread-badge">${unread > 99 ? '99+' : unread}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        updateTotalBadge();
    });
}

// ============================================================
// 就地更新聊天列表（新消息到达时，不重排整个 DOM）
// ============================================================
function touchChatList(chatId, content, time) {
    const chat = chatList.find(c => String(c.id) === String(chatId));
    if (!chat) { loadChats(); return; }
    chat.last_message = content;
    chat.last_time = time || new Date().toISOString();
    // 非默认联系人按时间置顶
    if (!chat.is_default) {
        chatList.sort((a, b) => {
            if (a.is_default && !b.is_default) return -1;
            if (!a.is_default && b.is_default) return 1;
            return new Date(b.last_time) - new Date(a.last_time);
        });
    }
    renderChatList();
}

// ============================================================
// 选择聊天
// ============================================================
function selectChat(chat) {
    if (!chat) return;
    currentChat = chat;
    if (chat.type !== 'system') clearUnread(chat.id);

    if (!window.location.pathname.includes('phone.html')) {
        renderChatList();
        $('emptyState') && ($('emptyState').style.display = 'none');
        const chatHeader = $('chatHeader');
        const chatInput = $('chatInput');
        if (chatHeader) chatHeader.style.display = 'flex';
        if (chatInput) chatInput.style.display = 'block';
        const name = chat.display_name || chat.username || '用户';
        if ($('chatName')) $('chatName').textContent = name;
        if ($('chatStatus')) $('chatStatus').textContent = '在线';
    } else {
        $('mainView')?.classList.remove('active');
        $('chatView')?.classList.add('active');
        const name = chat.display_name || chat.username || '用户';
        if ($('chatName')) $('chatName').textContent = name;
    }

    if (chat.type === 'system' || chat.id === 'system') {
        loadSystemChat();
    } else {
        loadChatHistory(chat.id);
    }
}

function selectChatById(id) {
    const chat = chatList.find(c => String(c.id) === String(id));
    if (chat) selectChat(chat);
}

// ============================================================
// 加载聊天历史
// ============================================================
function resetMessages() {
    messages = [];
    knownMessageIds.clear();
}

async function loadChatHistory(chatId) {
    const list = $('messageList');
    if (!list) return;
    list.innerHTML = '<div class="msg-loading">📥 加载历史消息...</div>';
    resetMessages();

    try {
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/messages?order=created_at.asc&limit=${CONFIG.HISTORY_LIMIT}`,
            { headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY } }
        );

        if (response.ok) {
            const data = await response.json();
            const filtered = data.filter(msg => messageBelongsToChat(msg, chatId));
            messages = filtered;
            filtered.forEach(m => knownMessageIds.add(m.id));
            if (filtered.length === 0 && chatId === 'public') {
                messages = [{
                    id: Date.now(),
                    sender_id: 'system',
                    sender_name: '系统',
                    content: '👋 欢迎来到公共频道！在这里可以自由交流。',
                    created_at: new Date().toISOString(),
                    is_system: true
                }];
            }
            saveLocalMessages(chatId);
            renderMessages(true);
        } else {
            loadLocalMessages(chatId);
        }
    } catch (error) {
        console.error('加载历史失败:', error);
        loadLocalMessages(chatId);
    }
}

// 判断消息是否属于某会话
function messageBelongsToChat(msg, chatId) {
    if (chatId === 'public') {
        return msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public';
    }
    if (chatId === '-1') {
        return msg.receiver_id === '-1' || msg.sender_id === '-1';
    }
    const fromOtherToMe = msg.sender_id === chatId && msg.receiver_id === currentUser.id;
    const fromMeToOther = msg.sender_id === currentUser.id && msg.receiver_id === chatId;
    return fromOtherToMe || fromMeToOther;
}

// ============================================================
// 加载系统聊天
// ============================================================
async function loadSystemChat() {
    const list = $('messageList');
    if (!list) return;
    list.innerHTML = '<div class="msg-loading">📥 加载公告中...</div>';
    resetMessages();

    const items = await loadSystemMessages();
    if (items.length === 0) {
        list.innerHTML = `
            <div class="sidebar-empty">
                <div class="empty-icon">📢</div>
                <p>暂无公告</p>
                <button class="btn-refresh" onclick="loadSystemChat()">🔄 刷新</button>
            </div>
        `;
        return;
    }
    messages = items;
    renderMessages(true);
}

// ============================================================
// 本地消息存储
// ============================================================
function loadLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try {
        const data = localStorage.getItem(key);
        messages = data ? JSON.parse(data) : [];
        messages.forEach(m => knownMessageIds.add(m.id));
        renderMessages(true);
    } catch (e) { messages = []; }
}
function saveLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try { localStorage.setItem(key, JSON.stringify(messages)); } catch (e) {}
}

// ============================================================
// 渲染消息（增量追加，保持滚动位置）
// ============================================================
let lastRenderedTime = 0;
const TIME_GAP = 5 * 60 * 1000;

function renderMessages(forceScroll) {
    const list = $('messageList');
    if (!list) return;

    if (!messages || messages.length === 0) {
        list.innerHTML = `<div class="sidebar-empty"><div class="empty-icon">💬</div><p>暂无消息</p><p class="empty-hint">发送第一条消息吧</p></div>`;
        return;
    }

    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;

    let html = '';
    let prevTime = 0;
    messages.forEach(msg => {
        if (msg.is_system && msg.is_article) { html += renderArticleMessage(msg); return; }

        const t = new Date(msg.created_at).getTime();
        if (t - prevTime > TIME_GAP) {
            html += `<div class="msg-time-divider">${formatMsgTime(msg.created_at)}</div>`;
        }
        prevTime = t;

        const isSent = msg.sender_id === currentUser?.id;
        const senderName = escapeHtml(msg.sender_name || '用户');
        const avatar = isSent
            ? (currentUser?.avatar_url || DEFAULT_AVATAR)
            : (currentChat?.avatar_url || DEFAULT_AVATAR);
        const mine = isSent ? 'sent' : 'received';

        html += `
            <div class="message ${mine}">
                <img src="${avatar}" class="msg-avatar" alt="" onerror="this.src='${DEFAULT_AVATAR}'" />
                <div class="msg-body">
                    ${isSent ? '' : `<div class="msg-sender">${senderName}</div>`}
                    <div class="msg-bubble">${escapeHtml(msg.content || '')}</div>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;

    // 只有本来在底部（或强制）才滚到底，避免打断阅读
    if (forceScroll || nearBottom) scrollToBottom(false);
}

function renderArticleMessage(msg) {
    const time = formatTime(msg.publish_date || msg.created_at);
    const imageHtml = msg.image_url
        ? `<div class="article-image" onclick="window.open('${msg.image_url}','_blank')"><img src="${msg.image_url}" alt="" loading="lazy" onerror="this.style.display='none'" /></div>`
        : '';
    return `
        <div class="msg-time-divider">${time}</div>
        <div class="message received">
            <div class="msg-avatar system-avatar">📢</div>
            <div class="msg-body">
                <div class="msg-sender">系统服务</div>
                <div class="msg-bubble article-bubble">
                    <div class="article-publisher">📢 ${escapeHtml(msg.publisher || '系统服务')}</div>
                    <div class="article-title">${escapeHtml(msg.content)}</div>
                    ${msg.subtitle ? `<div class="article-subtitle">${escapeHtml(msg.subtitle)}</div>` : ''}
                    ${imageHtml}
                </div>
            </div>
        </div>
    `;
}

// 追加单条消息（即时刷新核心：不重载整页）
function appendIncomingMessage(msg) {
    if (!currentChat) return;
    if (knownMessageIds.has(msg.id)) return;
    knownMessageIds.add(msg.id);
    messages.push(msg);
    saveLocalMessages(currentChat.id);
    renderMessages(false);
}

// ============================================================
// 发送消息
// ============================================================
let tempIdCounter = -1;

async function sendMessage() {
    const input = $('messageInput');
    const content = input.value.trim();

    if (!content) return;
    if (!currentChat) { showToast('请先选择聊天', 'warning'); return; }
    if (!currentUser) { showToast('请先登录', 'error'); return; }
    if (currentChat.type === 'system') { showToast('⚠️ 系统公告频道不能发送消息', 'warning'); return; }

    let receiverId = null;
    if (currentChat.type === 'public' || currentChat.id === 'public') { receiverId = null; }
    else if (currentChat.id === '-1') { receiverId = '-1'; }
    else { receiverId = currentChat.id; }

    const msgData = {
        content: content,
        sender_id: currentUser.id,
        sender_name: currentUser.username || currentUser.display_name || '用户',
        receiver_id: receiverId,
        created_at: new Date().toISOString()
    };

    // 乐观渲染（临时负 id，服务器回包/订阅推送后替换）
    const tempId = tempIdCounter--;
    const localMsg = { ...msgData, id: tempId };
    messages.push(localMsg);
    knownMessageIds.add(tempId);
    saveLocalMessages(currentChat.id);
    renderMessages(true);

    input.value = '';
    input.style.height = 'auto';

    touchChatList(currentChat.id, content, msgData.created_at);

    try {
        const response = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/messages', {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(msgData)
        });
        if (response.ok) {
            // 用真实 id 替换临时 id
            const saved = await response.json();
            if (Array.isArray(saved) && saved.length > 0) {
                const idx = messages.findIndex(m => m.id === tempId);
                if (idx >= 0) {
                    knownMessageIds.delete(tempId);
                    messages[idx] = saved[0];
                    knownMessageIds.add(saved[0].id);
                    saveLocalMessages(currentChat.id);
                }
            }
        } else {
            showToast('⚠️ 本地已保存，云端同步失败', 'error');
        }
    } catch (error) {
        showToast('⚠️ 本地已保存，云端同步失败', 'error');
    }
}

// ============================================================
// ★ 即时刷新核心 1：Supabase Realtime（WebSocket 订阅）
// ============================================================
function startRealtime() {
    if (!window.supabase || !window.supabase.createClient) { console.warn('Realtime SDK 未加载'); return; }
    if (realtimeChannel) { try { window.supabase.removeChannel(realtimeChannel); } catch (e) {} }

    try {
        const client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        realtimeChannel = client
            .channel('messages-instant-' + Date.now())
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                payload => {
                    realtimeOk = true;
                    handleIncomingMessage(payload.new);
                }
            )
            .subscribe(status => {
                if (status === 'SUBSCRIBED') {
                    realtimeOk = true;
                    console.log('⚡ Realtime 已连接，即时刷新生效');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    realtimeOk = false;
                    console.warn('Realtime 连接异常，轮询兜底接管');
                }
            });
    } catch (e) {
        console.error('Realtime 初始化失败:', e);
    }
}

// ============================================================
// ★ 即时刷新核心 2：增量轮询（Realtime 兜底 + 断线补偿）
// ============================================================
let pollingBusy = false;

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        if (!isLoggedIn) return;
        if (document.hidden) return;                    // 后台不轮询，回前台时全量拉一次
        if (pollingBusy) return;
        pollingBusy = true;
        try {
            // 已在系统公告页：只低频刷新公告
            if (currentChat && (currentChat.type === 'system' || currentChat.id === 'system')) {
                if (!realtimeOk) loadSystemChat();
                return;
            }

            // 增量查询：只取比当前会话最新消息更新的
            let url = CONFIG.SUPABASE_URL + '/rest/v1/messages?order=created_at.asc&limit=100';
            const maxId = getMaxKnownMessageId();
            if (maxId > 0) url += `&id=gt.${maxId}`;

            const response = await fetch(url, {
                headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY }
            });
            if (!response.ok) return;

            const data = await response.json();
            if (!Array.isArray(data) || data.length === 0) return;

            // 与服务端全量对账：避免 Realtime 丢消息导致两端不一致
            let hasNewForMe = false;
            data.forEach(msg => {
                const related = isMessageRelatedToMe(msg);
                if (related) { hasNewForMe = true; handleIncomingMessage(msg, true); }
            });
            // 长时间无增量时定期校验会话完整性（每 ~5 分钟）
            if (hasNewForMe || Date.now() - (window._lastFullSync || 0) > 5 * 60 * 1000) {
                window._lastFullSync = Date.now();
                reconcileCurrentChat();
                loadChats();
            }
        } catch (error) {
            console.error('轮询错误:', error);
        } finally {
            pollingBusy = false;
        }
    }, CONFIG.POLL_INTERVAL);
}

function getMaxKnownMessageId() {
    let max = 0;
    knownMessageIds.forEach(id => { if (typeof id === 'number' && id > max) max = id; });
    return max;
}

function isMessageRelatedToMe(msg) {
    if (!currentUser) return false;
    if (msg.sender_id === currentUser.id) return true;
    if (msg.receiver_id === currentUser.id) return true;
    if (msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public') return true;
    if (msg.receiver_id === '-1' || msg.sender_id === '-1') return true;
    return false;
}

// 当前会话与服务端对账（补漏 Realtime 可能丢失的消息）
let reconciling = false;
async function reconcileCurrentChat() {
    if (!currentChat || reconciling) return;
    if (currentChat.type === 'system' || currentChat.id === 'system') return;
    reconciling = true;
    try {
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/messages?order=created_at.asc&limit=${CONFIG.HISTORY_LIMIT}`,
            { headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY } }
        );
        if (!response.ok) return;
        const data = await response.json();
        const filtered = data.filter(m => messageBelongsToChat(m, currentChat.id));
        const filteredIds = new Set(filtered.map(m => m.id));

        let changed = false;
        // 服务端有而本地没有 → 补上
        filtered.forEach(m => {
            if (!knownMessageIds.has(m.id)) {
                knownMessageIds.add(m.id);
                messages.push(m);
                changed = true;
            }
        });
        // 本地临时消息已被服务端确认 → 替换
        messages = messages.map(m => {
            if (typeof m.id === 'number' && m.id < 0 && m.sender_id === currentUser.id) {
                const match = filtered.find(s =>
                    s.sender_id === m.sender_id && s.receiver_id === m.receiver_id &&
                    s.content === m.content && new Date(s.created_at) >= new Date(m.created_at) - 1000
                );
                if (match) { knownMessageIds.delete(m.id); knownMessageIds.add(match.id); changed = true; return match; }
            }
            return m;
        });
        // 本地有而服务端没有（被删除）→ 移除
        messages = messages.filter(m => {
            if (m.is_system) return true;
            if (typeof m.id === 'number' && m.id < 0) return true; // 尚未确认的本地消息保留
            if (!filteredIds.has(m.id)) { changed = true; return false; }
            return true;
        });
        messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        if (changed) {
            saveLocalMessages(currentChat.id);
            renderMessages(false);
        }
    } catch (e) {
        console.error('对账失败:', e);
    } finally {
        reconciling = false;
    }
}

// 统一入口：处理新消息（Realtime 推送 或 轮询增量）
function handleIncomingMessage(msg, fromPolling) {
    if (!msg || !currentUser) return;

    const isMine = msg.sender_id === currentUser.id;

    // 与我无关的消息直接忽略
    if (!isMessageRelatedToMe(msg)) return;

    // 属于我的其他设备发出的消息 → 也可能在当前会话
    if (currentChat && messageBelongsToChat(msg, currentChat.id)) {
        if (msg.is_system && msg.is_article) return;
        // 自己发的：若已有临时消息，替换而非重复追加
        if (isMine && typeof msg.id === 'number') {
            const tempIdx = messages.findIndex(m => m.id < 0 && m.content === msg.content && m.sender_id === msg.sender_id);
            if (tempIdx >= 0) {
                knownMessageIds.delete(messages[tempIdx].id);
                messages[tempIdx] = msg;
                knownMessageIds.add(msg.id);
                saveLocalMessages(currentChat.id);
                renderMessages(false);
                touchChatList(currentChat.id, msg.content, msg.created_at);
                return;
            }
        }
        appendIncomingMessage(msg);
        touchChatList(currentChat.id, msg.content, msg.created_at);
        return;
    }

    // 非当前会话：更新未读 + 列表预览
    if (!isMine) {
        const chatId = msg.sender_id;
        if (chatId && chatId !== 'system') {
            incrementUnread(chatId);
            touchChatList(chatId, msg.content, msg.created_at);
            // 列表里没有这个联系人 → 重新拉取
            if (!chatList.some(c => String(c.id) === String(chatId))) loadChats();
        }
    }
}

// ============================================================
// 滚动
// ============================================================
function scrollToBottom(smooth) {
    const list = $('messageList');
    setTimeout(() => {
        if (!list) return;
        list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }, 30);
}

// ============================================================
// 从 URL 获取用户
// ============================================================
function getUserFromURL() {
    const params = new URLSearchParams(window.location.search);
    const userParam = params.get('user');
    if (userParam) {
        try {
            const data = JSON.parse(decodeURIComponent(userParam));
            if (data && data.id) { localStorage.setItem('chat_user_data', JSON.stringify(data)); return data; }
        } catch (e) {}
    }
    return null;
}

// ============================================================
// 切换标签页
// ============================================================
function switchTab(tab) {
    if (!window.location.pathname.includes('phone.html')) {
        document.querySelectorAll('.func-item[data-tab]').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.func-item[data-tab="${tab}"]`)?.classList.add('active');

        const map = { chat: 'sidebarChat', friends: 'sidebarFriends', settings: 'sidebarSettings' };
        Object.entries(map).forEach(([key, id]) => {
            const el = $(id);
            if (el) el.style.display = tab === key ? 'flex' : 'none';
        });
        if (tab === 'friends') loadFriendList();
        return;
    }

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');

    if (tab === 'chat') {
        $('mainView')?.classList.add('active');
        $('chatView')?.classList.remove('active');
    } else if (tab === 'friends') {
        showToast('👥 通讯录功能开发中', 'info');
    } else if (tab === 'profile') {
        showToast('👤 个人中心开发中', 'info');
    } else if (tab === 'settings') {
        showToast('⚙️ 请使用桌面版进行设置', 'info');
    }
}

// ============================================================
// 手机版视图切换
// ============================================================
function closeChat() {
    $('mainView')?.classList.add('active');
    $('chatView')?.classList.remove('active');
}

function switchToChatView(chatId) {
    $('mainView')?.classList.remove('active');
    $('chatView')?.classList.add('active');
    if (chatId) {
        const chat = chatList.find(c => String(c.id) === String(chatId));
        if (chat) selectChat(chat);
    }
}

// ============================================================
// 好友功能
// ============================================================
function openAddFriend() { $('addFriendModal').classList.add('show'); $('addFriendInput').focus(); }
function closeAddFriend() {
    $('addFriendModal').classList.remove('show');
    $('addFriendInput').value = '';
    $('addFriendMsg').value = '';
    $('searchResults').innerHTML = '';
}
function searchAndAddFriend() {
    const keyword = $('addFriendInput').value.trim();
    if (!keyword) { showToast('请输入用户ID或用户名', 'warning'); return; }
    showToast('🔍 搜索功能开发中', 'info');
}
function loadFriendList() {
    const list = $('friendList');
    if (!list) return;
    list.innerHTML = `<div class="sidebar-empty"><div class="empty-icon">👥</div><p>好友功能开发中</p><p class="empty-hint">点击 ➕ 添加好友</p></div>`;
}

// ============================================================
// 清除缓存
// ============================================================
function clearAllData() {
    if (confirm('确定要清除所有本地缓存数据吗？')) {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('chat_messages_') || key.startsWith('chat_unread_')) localStorage.removeItem(key);
        });
        showToast('✅ 缓存已清除', 'success');
        if (currentChat) loadChatHistory(currentChat.id);
        updateTotalBadge();
    }
}

// ============================================================
// 退出登录
// ============================================================
function logout() {
    if (confirm('确定要退出登录吗？')) {
        logLogout(currentUser);
        updateUserStatus('offline');
        localStorage.removeItem('chat_user_data');
        localStorage.removeItem('auth_token');
        sessionStorage.clear();
        isLoggedIn = false;
        currentUser = null;
        currentChat = null;
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        if (realtimeChannel) { try { window.supabase.removeChannel(realtimeChannel); } catch (e) {} realtimeChannel = null; }
        $('loginOverlay')?.classList.add('show');
        updateUIForGuest();
        showToast('已退出登录', 'info');
    }
}

// ============================================================
// 二维码
// ============================================================
function openQR() {
    $('qrModal')?.classList.add('show');
    const userIdEl = $('qrUserId');
    if (userIdEl && currentUser) userIdEl.textContent = currentUser.id || '-';
}
function closeQR() { $('qrModal')?.classList.remove('show'); }
function copyUserId() {
    if (currentUser && currentUser.id) {
        const id = String(currentUser.id);
        if (navigator.clipboard) {
            navigator.clipboard.writeText(id).then(() => showToast('✅ 用户ID已复制', 'success'));
        } else {
            const input = document.createElement('input');
            input.value = id;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            showToast('✅ 用户ID已复制', 'success');
        }
    }
}

// ============================================================
// 主题切换
// ============================================================
function toggleTheme() {
    const html = document.documentElement;
    const next = (html.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    const statusEl = $('themeStatus');
    if (statusEl) statusEl.textContent = next === 'dark' ? '深色模式' : '浅色模式';
    showToast(next === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式', 'info');
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const statusEl = $('themeStatus');
    if (statusEl) statusEl.textContent = saved === 'dark' ? '深色模式' : '浅色模式';
}

// ============================================================
// 页面可见性监听
// ============================================================
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        updateUserStatus('offline');
    } else {
        updateUserStatus('online');
        if (isLoggedIn && currentChat) {
            if (currentChat.type === 'system') loadSystemChat();
            else { reconcileCurrentChat(); loadChats(); }
        }
    }
});

window.addEventListener('beforeunload', function() {
    logLogout(currentUser);
    updateUserStatus('offline');
});

// ============================================================
// 初始化
// ============================================================
function init() {
    console.log('🚀 梓睿聊天 v3 启动（微信风格 + 即时刷新）');

    const urlUser = getUserFromURL();
    if (urlUser) window.history.replaceState({}, document.title, window.location.pathname);

    const loggedIn = checkLoginStatus();
    if (!loggedIn) {
        const user = getLocalUser();
        if (user && user.id) {
            currentUser = user;
            isLoggedIn = true;
            $('loginOverlay')?.classList.remove('show');
            updateUIForLoggedIn();
        }
    }
}

// ============================================================
// 事件绑定
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    loadTheme();

    const sendBtn = $('sendBtn');
    const messageInput = $('messageInput');

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
    }

    $('fileInput')?.addEventListener('change', function() {
        if (this.files.length > 0) showToast(`📎 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
        this.value = '';
    });
    $('imageInput')?.addEventListener('change', function() {
        if (this.files.length > 0) showToast(`🖼️ 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
        this.value = '';
    });
    $('addFriendSubmit')?.addEventListener('click', searchAndAddFriend);
    $('addFriendInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') searchAndAddFriend();
    });
    $('avatarBtn')?.addEventListener('click', openQR);
    $('copyIdBtn')?.addEventListener('click', copyUserId);

    if (window.location.pathname.includes('phone.html')) {
        const chatListEl = $('chatList');
        if (chatListEl) {
            chatListEl.addEventListener('click', function(e) {
                const item = e.target.closest('.chat-item');
                if (item && item.dataset.id) switchToChatView(item.dataset.id);
            });
        }
    }
});

// ============================================================
// 暴露全局函数
// ============================================================
window.goToLogin = goToLogin;
window.goToTest = goToTest;
window.switchTab = switchTab;
window.switchToPhone = switchToPhone;
window.switchToDesktop = switchToDesktop;
window.openAddFriend = openAddFriend;
window.closeAddFriend = closeAddFriend;
window.searchAndAddFriend = searchAndAddFriend;
window.clearAllData = clearAllData;
window.logout = logout;
window.openQR = openQR;
window.closeQR = closeQR;
window.copyUserId = copyUserId;
window.sendMessage = sendMessage;
window.toggleTheme = toggleTheme;
window.selectChatById = selectChatById;
window.closeChat = closeChat;
window.switchToChatView = switchToChatView;
window.loadSystemChat = loadSystemChat;

// 启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

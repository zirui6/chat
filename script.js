// ============================================================
// 梓睿聊天 · 主逻辑（Supabase + Airtable）
// ============================================================

// ============================================================
// 配置
// ============================================================
const CONFIG = {
    SUPABASE_URL: 'https://uigzsxmkulephkfkiebj.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_OgyvGDiFuFAKKGYMmnq3GA_nXqIRCmW',
    WEBSITE: 'https://zirui6.github.io',
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
// 禁用右键和快捷键
// ============================================================
document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); return false; }
    if (e.key === 'F12') { e.preventDefault(); return false; }
});

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

function getInitials(name) {
    if (!name) return 'U';
    return name.charAt(0).toUpperCase();
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
    const current = getUnreadCount(chatId);
    setUnreadCount(chatId, current + 1);
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
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }
    return total;
}

// ============================================================
// 登录日志管理
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
        console.log('✅ 登录日志已记录');
    } catch (error) {
        console.error('记录登录日志失败:', error);
    }
}

async function logLogout(user) {
    if (!user) return;
    try {
        // 更新最新的一条日志
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/login_logs?user_id=eq.${encodeURIComponent(user.id)}&order=login_time.desc&limit=1`,
            {
                headers: {
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
                }
            }
        );
        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                const logId = data[0].id;
                await fetch(CONFIG.SUPABASE_URL + `/rest/v1/login_logs?id=eq.${logId}`, {
                    method: 'PATCH',
                    headers: {
                        'apikey': CONFIG.SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        logout_time: new Date().toISOString(),
                        status: 'offline'
                    })
                });
                console.log('✅ 登出日志已更新');
            }
        }
    } catch (error) {
        console.error('更新登出日志失败:', error);
    }
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
        // 更新顶栏状态
        updateOnlineStatus(status);
    } catch (error) {
        console.error('更新状态失败:', error);
    }
}

// 更新顶栏在线状态
function updateOnlineStatus(status) {
    const statusDot = document.getElementById('onlineStatusDot');
    const statusText = document.getElementById('onlineStatusText');
    if (statusDot) {
        statusDot.className = 'online-dot ' + status;
    }
    if (statusText) {
        const labels = {
            'online': '在线',
            'offline': '离线',
            'away': '离开'
        };
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
// 登录管理
// ============================================================
function goToLogin() {
    window.location.href = CONFIG.WEBSITE + '/user.html?redirect=' + encodeURIComponent(window.location.href);
}
function goToTest() {
    window.location.href = 'test.html';
}

let currentUser = null;
let isLoggedIn = false;
let pollingInterval = null;
let lastMessageId = {};

function checkLoginStatus() {
    const user = getLocalUser();
    if (user && user.id) {
        currentUser = user;
        isLoggedIn = true;
        const overlay = $('loginOverlay');
        if (overlay) overlay.classList.remove('show');
        updateUIForLoggedIn();
        return true;
    }
    isLoggedIn = false;
    currentUser = null;
    const overlay = $('loginOverlay');
    if (overlay) overlay.classList.add('show');
    updateUIForGuest();
    return false;
}

// ============================================================
// UI 更新
// ============================================================
function updateUIForLoggedIn() {
    if (!currentUser) return;
    const avatar = $('myAvatar');
    if (avatar) { avatar.src = currentUser.avatar_url || 'https://zirui6.github.io/touxiang.jpg'; }
    // 记录登录日志
    logLogin(currentUser);
    updateUserStatus('online');
    loadChats();
    startPolling();
}

function updateUIForGuest() {
    const list = $('chatList');
    if (list) {
        list.innerHTML = `<div style="text-align:center;padding:40px 0;color:#666688;"><div style="font-size:40px;margin-bottom:12px;">🔒</div><p>请先登录</p></div>`;
    }
    const chatInput = $('chatInput');
    const chatHeader = $('chatHeader');
    const emptyState = $('emptyState');
    const messageList = $('messageList');
    if (chatInput) chatInput.style.display = 'none';
    if (chatHeader) chatHeader.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    if (messageList) messageList.innerHTML = '';
}

// ============================================================
// 消息相关
// ============================================================
let messages = [];
let currentChat = null;
let chatList = [];

const DEFAULT_CONTACTS = [
    { id: 'system', username: '系统服务', display_name: '📢 系统公告', avatar_url: 'https://zirui6.github.io/icon48.png', is_default: true, type: 'system' },
    { id: 'public', username: '公共频道', display_name: '🌐 公共频道', avatar_url: 'https://zirui6.github.io/icon48.png', is_default: true, type: 'public' },
    { id: '-1', username: '文件传输助手', display_name: '📎 文件传输助手', avatar_url: 'https://zirui6.github.io/icon48.png', is_default: true, type: 'self' }
];

// ============================================================
// Airtable API 调用
// ============================================================
async function fetchAirtableData() {
    try {
        const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.BASE_ID}/${encodeURIComponent(AIRTABLE_CONFIG.TABLE_NAME)}`;
        const response = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + AIRTABLE_CONFIG.API_TOKEN, 'Content-Type': 'application/json' }
        });
        if (!response.ok) { console.error('Airtable 错误:', response.status); return []; }
        const data = await response.json();
        const records = data.records || [];
        return records.map(record => {
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
    } catch (error) { console.error('Airtable 错误:', error); return []; }
}

async function loadSystemMessages() {
    try {
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
            is_article: true,
            _raw: item
        }));
    } catch (error) { return []; }
}

// ============================================================
// 加载聊天列表（从 Supabase 读取）
// ============================================================
async function loadChats() {
    if (!isLoggedIn) return;
    try {
        const response = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/messages?order=created_at.desc&limit=200', {
            headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY }
        });

        let userChats = [];
        if (response.ok) {
            const data = await response.json();
            // 过滤当前用户参与的消息
            const filtered = data.filter(msg => {
                if (msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public') return true;
                if (msg.receiver_id === currentUser.id) return true;
                if (msg.sender_id === currentUser.id) return true;
                if (msg.receiver_id === '-1' || msg.sender_id === '-1') return true;
                return false;
            });
            // 按发送者分组
            const grouped = {};
            filtered.forEach(msg => {
                const key = msg.sender_id || 'unknown';
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(msg);
            });
            userChats = Object.keys(grouped).map(senderId => {
                const msgs = grouped[senderId];
                const lastMsg = msgs[0];
                return {
                    id: senderId,
                    username: lastMsg.sender_name || '用户',
                    display_name: lastMsg.sender_name || '用户',
                    avatar_url: 'https://zirui6.github.io/touxiang.jpg',
                    last_message: lastMsg.content || '',
                    last_time: lastMsg.created_at || new Date().toISOString(),
                    type: 'friend'
                };
            });
        }

        const existingIds = new Set(userChats.map(c => c.id));
        const defaultFiltered = DEFAULT_CONTACTS.filter(c => !existingIds.has(c.id));
        chatList = [...defaultFiltered, ...userChats];

        renderChatList();

        if (chatList.length > 0) {
            const systemChat = chatList.find(c => c.id === 'system');
            if (systemChat) { selectChat(systemChat); } else { selectChat(chatList[0]); }
        }
    } catch (error) {
        console.error('加载聊天失败:', error);
        chatList = DEFAULT_CONTACTS;
        renderChatList();
        if (chatList.length > 0) selectChat(chatList[0]);
    }
}

// ============================================================
// 渲染聊天列表
// ============================================================
function renderChatList() {
    const list = $('chatList');
    if (!list) return;

    if (chatList.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:40px 0;color:#666688;"><div style="font-size:40px;margin-bottom:12px;">👥</div><p>暂无聊天</p></div>`;
        return;
    }

    const userIds = chatList.filter(c => c.type === 'friend' || c.type === 'public').map(c => c.id).filter(id => id && id !== 'system' && id !== 'public' && id !== '-1');

    getUsersStatus(userIds).then(statusMap => {
        list.innerHTML = chatList.map(chat => {
            const active = currentChat && currentChat.id === chat.id;
            const name = chat.display_name || chat.username || '用户';
            const avatar = chat.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
            const lastMsg = chat.last_message || '暂无消息';
            const time = chat.last_time ? formatTime(chat.last_time) : '';
            const unread = chat.id !== 'system' ? getUnreadCount(chat.id) : 0;
            let statusDot = '';
            if (chat.type === 'friend' && chat.id !== '-1') {
                const status = statusMap[chat.id];
                statusDot = status && status.status === 'online' ? '<span class="status-dot-online"></span>' : '<span class="status-dot-offline"></span>';
            }
            return `
                <div class="chat-item ${active ? 'active' : ''}" data-id="${chat.id}" onclick="selectChatById('${chat.id}')">
                    <div class="avatar-wrapper">
                        <img src="${avatar}" class="avatar" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                        <div class="avatar default" style="display:none;">${getInitials(name)}</div>
                        ${statusDot}
                    </div>
                    <div class="info">
                        <div class="name">${name} ${chat.is_default ? '📌' : ''}</div>
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
// 选择聊天 - 从 Supabase 加载历史消息
// ============================================================
function selectChat(chat) {
    if (!chat) return;
    currentChat = chat;

    if (chat.type !== 'system') { clearUnread(chat.id); }

    // 桌面版渲染
    if (!window.location.pathname.includes('phone.html')) {
        renderChatList();
        const emptyState = $('emptyState');
        const chatHeader = $('chatHeader');
        const chatInput = $('chatInput');
        if (emptyState) emptyState.style.display = 'none';
        if (chatHeader) chatHeader.style.display = 'flex';
        if (chatInput) chatInput.style.display = 'block';
        const name = chat.display_name || chat.username || '用户';
        const chatName = $('chatName');
        const chatStatus = $('chatStatus');
        if (chatName) chatName.textContent = name;
        if (chatStatus) chatStatus.textContent = '在线';
    } else {
        // 手机版：切换到聊天视图
        const mainView = document.getElementById('mainView');
        const chatView = document.getElementById('chatView');
        if (mainView) mainView.classList.remove('active');
        if (chatView) chatView.classList.add('active');
        const name = chat.display_name || chat.username || '用户';
        const chatName = document.getElementById('chatName');
        if (chatName) chatName.textContent = name;
    }

    // 加载消息（从 Supabase）
    if (chat.type === 'system' || chat.id === 'system') {
        loadSystemChat();
    } else {
        loadChatHistory(chat.id);
    }
    scrollToBottom();
}

function selectChatById(id) {
    const chat = chatList.find(c => String(c.id) === String(id));
    if (chat) selectChat(chat);
}

// ============================================================
// 从 Supabase 加载聊天历史
// ============================================================
async function loadChatHistory(chatId) {
    const list = $('messageList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#666688;">📥 加载历史消息...</div>';

    try {
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/messages?order=created_at.asc&limit=500`,
            {
                headers: {
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            // 过滤出与当前聊天的消息
            const filtered = data.filter(msg => {
                if (chatId === 'public') {
                    return msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public';
                }
                if (chatId === '-1') {
                    return msg.receiver_id === '-1' || msg.sender_id === '-1';
                }
                // 私聊：发送者是对方 或 接收者是对方 或 自己发的
                return msg.sender_id === chatId || msg.receiver_id === chatId || msg.sender_id === currentUser.id;
            });

            if (filtered.length > 0) {
                messages = filtered;
                saveLocalMessages(chatId);
                renderMessages();
            } else {
                messages = [];
                renderMessages();
                // 公共频道欢迎消息
                if (chatId === 'public') {
                    messages.push({
                        id: Date.now(),
                        sender_id: 'system',
                        sender_name: '系统',
                        content: '👋 欢迎来到公共频道！在这里可以自由交流。',
                        created_at: new Date().toISOString(),
                        is_system: true
                    });
                    saveLocalMessages(chatId);
                    renderMessages();
                }
            }
        } else {
            loadLocalMessages(chatId);
        }
    } catch (error) {
        console.error('加载历史失败:', error);
        loadLocalMessages(chatId);
    }
}

// ============================================================
// 加载系统聊天
// ============================================================
async function loadSystemChat() {
    const list = $('messageList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#666688;">📥 加载公告中...</div>';
    const items = await loadSystemMessages();
    if (items.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#666688;">
                <div style="font-size:40px;margin-bottom:12px;">📢</div>
                <p>暂无公告</p>
                <p style="font-size:12px;">系统消息将在这里显示</p>
                <button onclick="loadSystemChat()" style="margin-top:12px;padding:6px 20px;background:#4a6cf7;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 刷新</button>
            </div>
        `;
        return;
    }
    messages = items;
    renderMessages();
}

// ============================================================
// 本地消息存储（缓存）
// ============================================================
function loadLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try { const data = localStorage.getItem(key); messages = data ? JSON.parse(data) : []; renderMessages(); } catch (e) { messages = []; }
}
function saveLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try { localStorage.setItem(key, JSON.stringify(messages)); } catch (e) {}
}

// ============================================================
// 渲染消息 - 显示头像+昵称+内容
// ============================================================
function renderMessages() {
    const list = $('messageList');
    if (!list) return;

    if (!messages || messages.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:40px 0;color:#666688;"><p>暂无消息</p><p style="font-size:12px;">发送第一条消息吧</p></div>`;
        return;
    }

    let html = '';
    messages.forEach(msg => {
        // 系统公告文章
        if (msg.is_system && msg.is_article) {
            html += renderArticleMessage(msg);
            return;
        }

        const isSent = msg.sender_id === currentUser?.id;
        const senderName = msg.sender_name || '用户';
        const avatar = isSent 
            ? (currentUser?.avatar_url || 'https://zirui6.github.io/touxiang.jpg')
            : (currentChat?.avatar_url || 'https://zirui6.github.io/touxiang.jpg');
        const time = formatTime(msg.created_at);

        html += `
            <div class="message ${isSent ? 'sent' : 'received'}">
                <div class="msg-avatar-wrapper">
                    <img src="${avatar}" class="msg-avatar" alt="" onerror="this.src='https://zirui6.github.io/touxiang.jpg'" />
                    <div class="msg-sender">${senderName}</div>
                </div>
                <div class="msg-content-wrapper">
                    <div class="msg-bubble">${msg.content || ''}</div>
                    <div class="msg-time">${time}</div>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
    scrollToBottom();
}

// ============================================================
// 渲染文章消息
// ============================================================
function renderArticleMessage(msg) {
    const time = formatTime(msg.publish_date || msg.created_at);
    const imageHtml = msg.image_url ? `<div class="article-image" onclick="window.open('${msg.image_url}','_blank')"><img src="${msg.image_url}" alt="${msg.content}" loading="lazy" onerror="this.style.display='none'" /></div>` : '';
    return `
        <div class="message received article-message">
            <div class="msg-avatar-wrapper">
                <div class="msg-avatar system-avatar">📢</div>
                <div class="msg-sender">系统服务</div>
            </div>
            <div class="msg-content-wrapper">
                <div class="msg-bubble article-bubble">
                    <div class="article-publisher">📢 ${msg.publisher || '系统服务'}</div>
                    <div class="article-title">${msg.content}</div>
                    ${msg.subtitle ? `<div class="article-subtitle">${msg.subtitle}</div>` : ''}
                    ${imageHtml}
                    <div class="article-time">${time}</div>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// 发送消息
// ============================================================
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

    const localMsg = { ...msgData, id: Date.now() };
    messages.push(localMsg);
    saveLocalMessages(currentChat.id);
    renderMessages();
    scrollToBottom();

    input.value = '';
    input.style.height = 'auto';

    const chat = chatList.find(c => c.id === currentChat.id);
    if (chat) {
        chat.last_message = content;
        chat.last_time = new Date().toISOString();
        renderChatList();
    }

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
        if (response.ok) { console.log('✅ 消息已保存'); showToast('✅ 消息已发送', 'success'); }
        else { showToast('⚠️ 本地已保存，云端同步失败', 'error'); }
    } catch (error) { showToast('⚠️ 本地已保存，云端同步失败', 'error'); }
}

// ============================================================
// 轮询（自动刷新 + 未读计数）
// ============================================================
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        if (!isLoggedIn) return;
        if (currentChat && (currentChat.type === 'system' || currentChat.id === 'system')) return;
        try {
            const response = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/messages?order=created_at.desc&limit=50', {
                headers: { 'apikey': CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY }
            });
            if (response.ok) {
                const data = await response.json();
                const filtered = data.filter(msg => {
                    if (msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public') return true;
                    if (msg.receiver_id === currentUser.id) return true;
                    if (msg.sender_id === currentUser.id) return true;
                    if (msg.receiver_id === '-1' || msg.sender_id === '-1') return true;
                    return false;
                });
                if (filtered.length > 0) {
                    const latest = filtered[0];
                    const lastKey = currentChat ? currentChat.id : 'none';
                    const lastId = lastMessageId[lastKey] || 0;
                    if (latest.id !== lastId) {
                        const newMsgs = filtered.filter(m => m.id > lastId);
                        if (currentChat) {
                            const isCurrent = newMsgs.some(m => m.sender_id === currentChat.id || m.receiver_id === currentChat.id);
                            if (isCurrent) { loadChatHistory(currentChat.id); }
                            else {
                                newMsgs.forEach(m => { if (m.sender_id !== currentUser.id) { incrementUnread(m.sender_id); } });
                            }
                        } else {
                            newMsgs.forEach(m => { if (m.sender_id !== currentUser.id) { incrementUnread(m.sender_id); } });
                        }
                        lastMessageId[lastKey] = latest.id;
                    }
                }
            }
        } catch (error) { console.error('轮询错误:', error); }
    }, 5000);
}

// ============================================================
// 滚动
// ============================================================
function scrollToBottom() {
    const list = $('messageList');
    setTimeout(() => { if (list) list.scrollTop = list.scrollHeight; }, 50);
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
// 切换标签页（手机版）
// ============================================================
function switchTab(tab) {
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const target = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (target) target.classList.add('active');
    
    // 处理不同标签
    if (tab === 'chat') {
        // 回到主界面
        const mainView = document.getElementById('mainView');
        const chatView = document.getElementById('chatView');
        if (mainView) mainView.classList.add('active');
        if (chatView) chatView.classList.remove('active');
    } else if (tab === 'friends') {
        showToast('👥 通讯录功能开发中', 'info');
    } else if (tab === 'profile') {
        showToast('👤 个人中心开发中', 'info');
    } else if (tab === 'settings') {
        // 跳转到设置（桌面版设置页面）
        if (window.location.pathname.includes('phone.html')) {
            showToast('⚙️ 设置功能请使用桌面版', 'info');
        }
    }
}

// ============================================================
// 手机版视图切换
// ============================================================
function switchToChatView(chatId) {
    const chat = chatList.find(c => String(c.id) === String(chatId));
    if (chat) {
        selectChat(chat);
    }
}

function closeChat() {
    const mainView = document.getElementById('mainView');
    const chatView = document.getElementById('chatView');
    if (mainView) mainView.classList.add('active');
    if (chatView) chatView.classList.remove('active');
}

// ============================================================
// 添加好友
// ============================================================
function openAddFriend() { $('addFriendModal').classList.add('show'); $('addFriendInput').focus(); }
function closeAddFriend() {
    $('addFriendModal').classList.remove('show');
    $('addFriendInput').value = '';
    $('addFriendMsg').value = '';
    $('searchResults').innerHTML = '';
}

function searchAndAddFriend() {
    const input = $('addFriendInput');
    const keyword = input.value.trim();
    if (!keyword) { showToast('请输入用户ID或用户名', 'warning'); return; }
    showToast('🔍 搜索功能开发中', 'info');
}

// ============================================================
// 清除缓存
// ============================================================
function clearAllData() {
    if (confirm('确定要清除所有本地缓存数据吗？')) {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('chat_messages_') || key.startsWith('chat_unread_')) { localStorage.removeItem(key); }
        });
        showToast('✅ 缓存已清除', 'success');
        if (currentChat) { loadChatHistory(currentChat.id); }
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
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        $('loginOverlay').classList.add('show');
        updateUIForGuest();
        showToast('已退出登录', 'info');
    }
}

// ============================================================
// 二维码
// ============================================================
function openQR() {
    const modal = $('qrModal');
    const userIdEl = $('qrUserId');
    if (modal) modal.classList.add('show');
    if (userIdEl && currentUser) { userIdEl.textContent = currentUser.id || '-'; }
}
function closeQR() { $('qrModal').classList.remove('show'); }

function copyUserId() {
    if (currentUser && currentUser.id) {
        const id = String(currentUser.id);
        if (navigator.clipboard) {
            navigator.clipboard.writeText(id).then(() => { showToast('✅ 用户ID已复制', 'success'); });
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
    const current = html.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    const statusEl = $('themeStatus');
    if (statusEl) { statusEl.textContent = next === 'dark' ? '深色模式' : '浅色模式'; }
    showToast(next === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式', 'info');
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const statusEl = $('themeStatus');
    if (statusEl) { statusEl.textContent = saved === 'dark' ? '深色模式' : '浅色模式'; }
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
            loadChatHistory(currentChat.id);
        }
    }
});

window.addEventListener('beforeunload', function() {
    logLogout(currentUser);
    updateUserStatus('offline');
});

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
        if (this.files.length > 0) { showToast(`📎 已选择: ${this.files[0].name}，上传功能开发中`, 'info'); }
        this.value = '';
    });
    $('imageInput')?.addEventListener('change', function() {
        if (this.files.length > 0) { showToast(`🖼️ 已选择: ${this.files[0].name}，上传功能开发中`, 'info'); }
        this.value = '';
    });
    $('addFriendSubmit')?.addEventListener('click', searchAndAddFriend);
    $('addFriendInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') searchAndAddFriend();
    });
    $('avatarBtn')?.addEventListener('click', openQR);
    $('copyIdBtn')?.addEventListener('click', copyUserId);

    // 手机版：聊天列表点击切换视图
    if (window.location.pathname.includes('phone.html')) {
        const chatList = document.getElementById('chatList');
        if (chatList) {
            chatList.addEventListener('click', function(e) {
                const item = e.target.closest('.chat-item');
                if (item) {
                    const id = item.dataset.id;
                    if (id) {
                        switchToChatView(id);
                    }
                }
            });
        }
    }
});

// 暴露全局函数
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

// ============================================================
// 初始化
// ============================================================
function init() {
    console.log('🚀 梓睿聊天启动');

    const urlUser = getUserFromURL();
    if (urlUser) {
        console.log('✅ 从 URL 获取用户:', urlUser.username);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const loggedIn = checkLoginStatus();
    if (loggedIn) {
        console.log('✅ 已登录:', currentUser?.username);
    } else {
        console.log('👤 未登录');
        const user = getLocalUser();
        if (user && user.id) {
            currentUser = user;
            isLoggedIn = true;
            const overlay = $('loginOverlay');
            if (overlay) overlay.classList.remove('show');
            updateUIForLoggedIn();
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

console.log('📋 Supabase URL:', CONFIG.SUPABASE_URL);
console.log('📋 Airtable Base ID:', AIRTABLE_CONFIG.BASE_ID);
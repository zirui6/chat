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

// ============================================================
// Airtable 配置
// ============================================================
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
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
});

document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        return false;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        return false;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        return false;
    }
    if (e.key === 'F12') {
        e.preventDefault();
        return false;
    }
});

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
    toastTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 3000);
}

// ============================================================
// 工具函数
// ============================================================
function getLocalUser() {
    try {
        const data = localStorage.getItem('chat_user_data');
        if (data) return JSON.parse(data);
    } catch (e) {}
    try {
        const data = sessionStorage.getItem('user_data');
        if (data) return JSON.parse(data);
    } catch (e) {}
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
    try {
        const data = localStorage.getItem(key);
        return data ? parseInt(data) : 0;
    } catch (e) {
        return 0;
    }
}

function setUnreadCount(chatId, count) {
    const key = 'chat_unread_' + chatId;
    try {
        if (count > 0) {
            localStorage.setItem(key, String(count));
        } else {
            localStorage.removeItem(key);
        }
    } catch (e) {}
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
    } catch (error) {
        console.error('更新状态失败:', error);
    }
}

async function getUsersStatus(userIds) {
    if (!userIds || userIds.length === 0) return {};
    try {
        const ids = userIds.join(',');
        const response = await fetch(
            CONFIG.SUPABASE_URL + `/rest/v1/user_status?user_id=in.(${ids})&select=user_id,status,last_seen`,
            {
                headers: {
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
                }
            }
        );
        if (response.ok) {
            const data = await response.json();
            const result = {};
            data.forEach(item => {
                result[item.user_id] = {
                    status: item.status || 'offline',
                    last_seen: item.last_seen
                };
            });
            return result;
        }
        return {};
    } catch (error) {
        return {};
    }
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

// ============================================================
// 检查登录状态
// ============================================================
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
    if (avatar) {
        avatar.src = currentUser.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
    }
    updateUserStatus('online');
    loadChats();
    startPolling();
}

function updateUIForGuest() {
    const list = $('chatList');
    if (list) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#666688;">
                <div style="font-size:40px;margin-bottom:12px;">🔒</div>
                <p>请先登录</p>
            </div>
        `;
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
    {
        id: 'system',
        username: '系统服务',
        display_name: '📢 系统公告',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'system'
    },
    {
        id: 'public',
        username: '公共频道',
        display_name: '🌐 公共频道',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'public'
    },
    {
        id: '-1',
        username: '文件传输助手',
        display_name: '📎 文件传输助手',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'self'
    }
];

// ============================================================
// Airtable API 调用
// ============================================================
async function fetchAirtableData() {
    try {
        const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.BASE_ID}/${encodeURIComponent(AIRTABLE_CONFIG.TABLE_NAME)}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + AIRTABLE_CONFIG.API_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Airtable 错误:', response.status);
            return [];
        }

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
    } catch (error) {
        console.error('Airtable 错误:', error);
        return [];
    }
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
    } catch (error) {
        return [];
    }
}

// ============================================================
// 加载聊天列表
// ============================================================
async function loadChats() {
    if (!isLoggedIn) return;

    try {
        const response = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/messages?order=created_at.desc&limit=200', {
            headers: {
                'apikey': CONFIG.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
            }
        });

        let userChats = [];
        if (response.ok) {
            const data = await response.json();
            const filtered = data.filter(msg => {
                if (msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public') return true;
                if (msg.receiver_id === currentUser.id) return true;
                if (msg.sender_id === currentUser.id) return true;
                if (msg.receiver_id === '-1' || msg.sender_id === '-1') return true;
                return false;
            });

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
            if (systemChat) {
                selectChat(systemChat);
            } else {
                selectChat(chatList[0]);
            }
        }

    } catch (error) {
        console.error('加载聊天失败:', error);
        chatList = DEFAULT_CONTACTS;
        renderChatList();
        if (chatList.length > 0) selectChat(chatList[0]);
    }
}

// ============================================================
// 渲染聊天列表（含未读红点和在线状态）
// ============================================================
function renderChatList() {
    const list = $('chatList');
    if (!list) return;

    if (chatList.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#666688;">
                <div style="font-size:40px;margin-bottom:12px;">👥</div>
                <p>暂无聊天</p>
            </div>
        `;
        return;
    }

    const userIds = chatList
        .filter(c => c.type === 'friend' || c.type === 'public')
        .map(c => c.id)
        .filter(id => id && id !== 'system' && id !== 'public' && id !== '-1');

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
                statusDot = status && status.status === 'online' 
                    ? '<span class="status-dot-online"></span>' 
                    : '<span class="status-dot-offline"></span>';
            }

            return `
                <div class="chat-item ${active ? 'active' : ''}" 
                     data-id="${chat.id}"
                     onclick="selectChatById('${chat.id}')">
                    <div class="avatar-wrapper">
                        <img src="${avatar}" class="avatar" alt="" 
                             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
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
// 选择聊天
// ============================================================
function selectChat(chat) {
    if (!chat) return;
    currentChat = chat;
    
    if (chat.type !== 'system') {
        clearUnread(chat.id);
    }
    
    renderChatList();

    const emptyState = $('emptyState');
    const chatHeader = $('chatHeader');
    const chatInput = $('chatInput');
    if (emptyState) emptyState.style.display = 'none';
    if (chatHeader) chatHeader.style.display = 'flex';
    if (chatInput) chatInput.style.display = 'block';

    const name = chat.display_name || chat.username || '用户';
    const avatar = chat.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
    const chatAvatar = $('chatAvatar');
    const chatName = $('chatName');
    const chatStatus = $('chatStatus');
    if (chatAvatar) chatAvatar.src = avatar;
    if (chatName) chatName.textContent = name;
    if (chatStatus) chatStatus.textContent = '在线';

    if (chat.type === 'system' || chat.id === 'system') {
        loadSystemChat();
    } else {
        loadLocalMessages(chat.id);
    }
    scrollToBottom();

    if (window.innerWidth <= 768) {
        const sidebar = $('sidebar');
        if (sidebar) sidebar.classList.add('hidden');
    }
}

function selectChatById(id) {
    const chat = chatList.find(c => String(c.id) === String(id));
    if (chat) selectChat(chat);
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
// 本地消息存储
// ============================================================
function loadLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try {
        const data = localStorage.getItem(key);
        messages = data ? JSON.parse(data) : [];
        renderMessages();
    } catch (e) {
        messages = [];
    }
}

function saveLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try {
        localStorage.setItem(key, JSON.stringify(messages));
    } catch (e) {}
}

// ============================================================
// 渲染消息
// ============================================================
function renderMessages() {
    const list = $('messageList');
    if (!list) return;

    if (messages.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#666688;">
                <p>暂无消息</p>
                <p style="font-size:12px;">开始聊天吧</p>
            </div>
        `;
        return;
    }

    let html = '';
    messages.forEach(msg => {
        if (msg.is_system && msg.is_article) {
            html += renderArticleMessage(msg);
            return;
        }

        const isSent = msg.sender_id === currentUser?.id;
        const avatar = isSent 
            ? (currentUser?.avatar_url || 'https://zirui6.github.io/touxiang.jpg')
            : (currentChat?.avatar_url || 'https://zirui6.github.io/touxiang.jpg');
        const time = formatTime(msg.created_at);

        html += `
            <div class="message ${isSent ? 'sent' : 'received'}">
                <img src="${avatar}" class="msg-avatar" alt="" />
                <div>
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
    const imageHtml = msg.image_url ? 
        `<div class="article-image" onclick="window.open('${msg.image_url}','_blank')">
            <img src="${msg.image_url}" alt="${msg.content}" loading="lazy" onerror="this.style.display='none'" />
        </div>` : '';

    return `
        <div class="message received article-message">
            <div class="msg-avatar system-avatar">📢</div>
            <div>
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
    if (!currentChat) {
        showToast('请先选择聊天', 'warning');
        return;
    }
    if (!currentUser) {
        showToast('请先登录', 'error');
        return;
    }
    if (currentChat.type === 'system') {
        showToast('⚠️ 系统公告频道不能发送消息', 'warning');
        return;
    }

    let receiverId = null;
    if (currentChat.type === 'public' || currentChat.id === 'public') {
        receiverId = null;
    } else if (currentChat.id === '-1') {
        receiverId = '-1';
    } else {
        receiverId = currentChat.id;
    }

    const msgData = {
        content: content,
        sender_id: currentUser.id,
        sender_name: currentUser.username || currentUser.display_name || '用户',
        receiver_id: receiverId,
        created_at: new Date().toISOString()
    };

    const localMsg = {
        ...msgData,
        id: Date.now()
    };
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

        if (response.ok) {
            console.log('✅ 消息已保存');
            showToast('✅ 消息已发送', 'success');
        } else {
            showToast('⚠️ 本地已保存，云端同步失败', 'error');
        }
    } catch (error) {
        showToast('⚠️ 本地已保存，云端同步失败', 'error');
    }
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
                headers: {
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
                }
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
                    
                    // 检查是否有新消息
                    const lastKey = currentChat ? currentChat.id : 'none';
                    const lastId = lastMessageId[lastKey] || 0;
                    
                    if (latest.id !== lastId) {
                        // 有新消息
                        const newMsgs = filtered.filter(m => m.id > lastId);
                        
                        // 如果是当前聊天，刷新消息
                        if (currentChat) {
                            const isCurrent = newMsgs.some(m => 
                                m.sender_id === currentChat.id || m.receiver_id === currentChat.id
                            );
                            if (isCurrent) {
                                loadLocalMessages(currentChat.id);
                            } else {
                                // 不是当前聊天，增加未读
                                newMsgs.forEach(m => {
                                    if (m.sender_id !== currentUser.id) {
                                        incrementUnread(m.sender_id);
                                    }
                                });
                            }
                        } else {
                            // 没有当前聊天，增加未读
                            newMsgs.forEach(m => {
                                if (m.sender_id !== currentUser.id) {
                                    incrementUnread(m.sender_id);
                                }
                            });
                        }
                        
                        lastMessageId[lastKey] = latest.id;
                    }
                }
            }
        } catch (error) {
            console.error('轮询错误:', error);
        }
    }, 5000);
}

// ============================================================
// 滚动
// ============================================================
function scrollToBottom() {
    const list = $('messageList');
    setTimeout(() => {
        if (list) list.scrollTop = list.scrollHeight;
    }, 50);
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
            if (data && data.id) {
                localStorage.setItem('chat_user_data', JSON.stringify(data));
                return data;
            }
        } catch (e) {}
    }
    return null;
}

// ============================================================
// 切换标签页
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.func-item[data-tab]').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.func-item[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const sidebarChat = $('sidebarChat');
    const sidebarFriends = $('sidebarFriends');
    const sidebarSettings = $('sidebarSettings');

    if (sidebarChat) sidebarChat.style.display = tab === 'chat' ? 'flex' : 'none';
    if (sidebarFriends) sidebarFriends.style.display = tab === 'friends' ? 'flex' : 'none';
    if (sidebarSettings) sidebarSettings.style.display = tab === 'settings' ? 'flex' : 'none';
}

function openSettings() { switchTab('settings'); }
function openTest() { window.open('test.html', '_blank'); }

function openAddFriend() {
    $('addFriendModal').classList.add('show');
    $('addFriendInput').focus();
}

function closeAddFriend() {
    $('addFriendModal').classList.remove('show');
    $('addFriendInput').value = '';
    $('addFriendMsg').value = '';
    $('searchResults').innerHTML = '';
}

function loadFriendList() {
    const list = $('friendList');
    if (!list) return;
    list.innerHTML = `
        <div style="text-align:center;padding:40px 0;color:#666688;">
            <div style="font-size:40px;margin-bottom:12px;">👥</div>
            <p>好友功能开发中</p>
            <p style="font-size:12px;">点击 ➕ 添加好友</p>
        </div>
    `;
}

function searchAndAddFriend() {
    const input = $('addFriendInput');
    const keyword = input.value.trim();
    if (!keyword) {
        showToast('请输入用户ID或用户名', 'warning');
        return;
    }
    showToast('🔍 搜索功能开发中', 'info');
}

function clearAllData() {
    if (confirm('确定要清除所有本地缓存数据吗？')) {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('chat_messages_') || key.startsWith('chat_unread_')) {
                localStorage.removeItem(key);
            }
        });
        showToast('✅ 缓存已清除', 'success');
        if (currentChat) {
            loadLocalMessages(currentChat.id);
        }
        updateTotalBadge();
    }
}

function logout() {
    if (confirm('确定要退出登录吗？')) {
        updateUserStatus('offline');
        localStorage.removeItem('chat_user_data');
        localStorage.removeItem('auth_token');
        sessionStorage.clear();
        isLoggedIn = false;
        currentUser = null;
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        $('loginOverlay').classList.add('show');
        updateUIForGuest();
        showToast('已退出登录', 'info');
    }
}

function openQR() {
    const modal = $('qrModal');
    const userIdEl = $('qrUserId');
    if (modal) modal.classList.add('show');
    if (userIdEl && currentUser) {
        userIdEl.textContent = currentUser.id || '-';
    }
}

function closeQR() {
    $('qrModal').classList.remove('show');
}

function copyUserId() {
    if (currentUser && currentUser.id) {
        const id = String(currentUser.id);
        if (navigator.clipboard) {
            navigator.clipboard.writeText(id).then(() => {
                showToast('✅ 用户ID已复制', 'success');
            });
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
// 设备检测 & UI 模式
// ============================================================
let deviceType = 'desktop';
let uiMode = 'auto';

function detectDevice() {
    const width = window.innerWidth;
    if (width <= 480) {
        deviceType = 'mobile';
    } else if (width <= 1024) {
        deviceType = 'tablet';
    } else {
        deviceType = 'desktop';
    }
    const deviceInfo = $('deviceInfo');
    if (deviceInfo) {
        const icons = {
            'mobile': '📱 手机',
            'tablet': '📱 平板',
            'desktop': '🖥️ 桌面'
        };
        deviceInfo.textContent = icons[deviceType] || '🖥️ 桌面';
    }
    applyUIMode();
    return deviceType;
}

function applyUIMode() {
    const app = document.getElementById('app');
    if (!app) return;
    const mode = uiMode === 'auto' ? getAutoMode() : uiMode;
    app.classList.remove('wechat-style');
    if (mode === 'wechat') {
        app.classList.add('wechat-style');
    }
    const statusEl = $('uiModeStatus');
    if (statusEl) {
        const labels = {
            'auto': '自动 (' + getAutoMode() + ')',
            'default': '默认',
            'wechat': '微信风格'
        };
        statusEl.textContent = labels[mode] || '自动';
    }
}

function getAutoMode() {
    if (deviceType === 'mobile' || deviceType === 'tablet') {
        return 'wechat';
    }
    return 'default';
}

function toggleUIMode() {
    const modes = ['auto', 'default', 'wechat'];
    const currentIndex = modes.indexOf(uiMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    uiMode = modes[nextIndex];
    localStorage.setItem('ui_mode', uiMode);
    applyUIMode();
    showToast('UI模式: ' + uiMode, 'info');
}

function loadUIMode() {
    const saved = localStorage.getItem('ui_mode');
    if (saved && ['auto', 'default', 'wechat'].includes(saved)) {
        uiMode = saved;
    } else {
        uiMode = 'auto';
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    const statusEl = $('themeStatus');
    if (statusEl) {
        statusEl.textContent = next === 'dark' ? '深色模式' : '浅色模式';
    }
    showToast(next === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式', 'info');
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const statusEl = $('themeStatus');
    if (statusEl) {
        statusEl.textContent = saved === 'dark' ? '深色模式' : '浅色模式';
    }
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
            loadLocalMessages(currentChat.id);
        }
    }
});

window.addEventListener('beforeunload', function() {
    updateUserStatus('offline');
});

// ============================================================
// 事件绑定
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    loadTheme();
    loadUIMode();
    detectDevice();

    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(detectDevice, 300);
    });

    const sendBtn = $('sendBtn');
    const messageInput = $('messageInput');

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
    }

    $('fileInput')?.addEventListener('change', function() {
        if (this.files.length > 0) {
            showToast(`📎 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
        }
        this.value = '';
    });

    $('imageInput')?.addEventListener('change', function() {
        if (this.files.length > 0) {
            showToast(`🖼️ 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
        }
        this.value = '';
    });

    $('addFriendSubmit')?.addEventListener('click', searchAndAddFriend);
    $('addFriendInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') searchAndAddFriend();
    });

    $('avatarBtn')?.addEventListener('click', openQR);
    $('copyIdBtn')?.addEventListener('click', copyUserId);
});

// 暴露函数给 HTML
window.goToLogin = goToLogin;
window.goToTest = goToTest;
window.switchTab = switchTab;
window.openSettings = openSettings;
window.openTest = openTest;
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
window.toggleUIMode = toggleUIMode;
window.loadSystemChat = loadSystemChat;
window.selectChatById = selectChatById;

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
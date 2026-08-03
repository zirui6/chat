// ============================================================
// 配置
// ============================================================
const CONFIG = {
    CHAT_API: 'https://chat1.ziruicloud.de5.net',
    AUTH_API: 'https://webcloud.ziruicloud.de5.net',
    WEBSITE: 'https://zirui6.github.io',
};

// ============================================================
// DOM 引用
// ============================================================
const $ = (id) => document.getElementById(id);

// ============================================================
// 工具函数
// ============================================================
function getToken() {
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
}

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
// Toast
// ============================================================
let toastTimer = null;

function showToast(message, type = 'info') {
    const el = $('toast');
    el.textContent = message;
    el.className = 'toast ' + type + ' show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 3000);
}

// ============================================================
// 登录管理
// ============================================================
function goToLogin() {
    // 跳转到 user.html，并带上回跳地址
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = CONFIG.WEBSITE + '/user.html?redirect=' + returnUrl;
}

let currentUser = null;
let isLoggedIn = false;

function checkLoginStatus() {
    const user = getLocalUser();
    const token = getToken();

    if (user && user.id) {
        currentUser = user;
        isLoggedIn = true;
        $('loginOverlay').classList.remove('show');
        updateUIForLoggedIn();
        return true;
    }

    // 没有用户数据，显示登录遮罩
    isLoggedIn = false;
    currentUser = null;
    $('loginOverlay').classList.add('show');
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
    loadChats();
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
    $('chatInput').style.display = 'none';
    $('chatHeader').style.display = 'none';
    $('emptyState').style.display = 'flex';
    $('messageList').innerHTML = '';
}

// ============================================================
// API 调用
// ============================================================
async function apiCall(endpoint, options = {}) {
    if (!isLoggedIn) {
        throw new Error('未登录');
    }

    const url = CONFIG.CHAT_API + endpoint;
    const token = getToken();

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    if (response.status === 401) {
        isLoggedIn = false;
        $('loginOverlay').classList.add('show');
        throw new Error('登录已过期，请重新登录');
    }

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || '请求失败');
    }
    return data;
}

// ============================================================
// 默认联系人
// ============================================================
const DEFAULT_CONTACTS = [
    {
        id: -1,
        username: '文件传输助手',
        display_name: '文件传输助手',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'self'
    },
    {
        id: -2,
        username: '服务团队',
        display_name: '服务团队',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'team'
    }
];

let chats = [];
let messages = [];
let currentChat = null;
let friends = [];

// ============================================================
// 加载聊天列表
// ============================================================
async function loadChats() {
    if (!isLoggedIn) return;

    try {
        const data = await apiCall('/api/friends');
        friends = data.friends || [];

        const defaultChats = DEFAULT_CONTACTS.map(c => ({
            ...c,
            last_message: c.type === 'self' ? '转发文件/链接' : '团队服务',
            last_time: new Date().toISOString(),
            unread_count: 0
        }));

        const friendChats = friends
            .filter(f => f.status === 'accepted')
            .map(f => ({
                id: f.friend_id,
                username: f.username,
                display_name: f.display_name,
                avatar_url: f.avatar_url,
                last_message: f.last_message || '',
                last_time: f.last_time || new Date().toISOString(),
                unread_count: f.unread_count || 0,
                type: 'friend'
            }));

        chats = [...defaultChats, ...friendChats];
        renderChatList();

        if (chats.length > 0) {
            selectChat(chats[0]);
        }

    } catch (error) {
        console.error('加载聊天失败:', error);
        const list = $('chatList');
        list.innerHTML = `
            <div style="text-align:center;padding:30px 0;color:#666688;">
                <p>加载失败: ${error.message}</p>
                <button onclick="loadChats()" style="margin-top:12px;padding:6px 20px;background:#4a6cf7;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 重试</button>
            </div>
        `;
    }
}

// ============================================================
// 渲染聊天列表
// ============================================================
function renderChatList() {
    const list = $('chatList');

    if (chats.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#666688;">
                <div style="font-size:40px;margin-bottom:12px;">👥</div>
                <p>暂无聊天</p>
            </div>
        `;
        return;
    }

    list.innerHTML = chats.map(chat => {
        const active = currentChat && currentChat.id === chat.id;
        const name = chat.display_name || chat.username || '用户';
        const avatar = chat.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
        const lastMsg = chat.last_message || '暂无消息';
        const time = chat.last_time ? formatTime(chat.last_time) : '';

        return `
            <div class="chat-item ${active ? 'active' : ''}" 
                 data-id="${chat.id}"
                 onclick="selectChatById(${chat.id})">
                <img src="${avatar}" class="avatar" alt="" 
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                <div class="avatar default" style="display:none;">${getInitials(name)}</div>
                <div class="info">
                    <div class="name">${name} ${chat.is_default ? '📌' : ''}</div>
                    <div class="last-msg">${lastMsg}</div>
                </div>
                <div class="meta">
                    <div class="time">${time}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// 选择聊天
// ============================================================
function selectChat(chat) {
    if (!chat) return;
    currentChat = chat;
    renderChatList();

    $('emptyState').style.display = 'none';
    $('chatHeader').style.display = 'flex';
    $('chatInput').style.display = 'block';

    const name = chat.display_name || chat.username || '用户';
    const avatar = chat.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
    $('chatAvatar').src = avatar;
    $('chatName').textContent = name;
    $('chatStatus').textContent = '在线';

    loadLocalMessages(chat.id);
    scrollToBottom();
}

function selectChatById(id) {
    const chat = chats.find(c => c.id === id);
    if (chat) selectChat(chat);
}

// ============================================================
// 加载消息
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

    const msg = {
        id: Date.now(),
        sender_id: currentUser.id,
        content: content,
        created_at: new Date().toISOString(),
        is_system: false
    };
    messages.push(msg);
    saveLocalMessages(currentChat.id);
    renderMessages();
    scrollToBottom();

    input.value = '';
    input.style.height = 'auto';

    // 更新最后消息
    const chat = chats.find(c => c.id === currentChat.id);
    if (chat) {
        chat.last_message = content;
        chat.last_time = new Date().toISOString();
        renderChatList();
    }
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
// 事件绑定
// ============================================================
$('sendBtn').addEventListener('click', sendMessage);

$('messageInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

$('messageInput').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

$('fileBtn').addEventListener('click', () => $('fileInput').click());
$('imageBtn').addEventListener('click', () => $('imageInput').click());

$('addFriendBtn').addEventListener('click', () => {
    showToast('👥 好友功能开发中', 'info');
});

// ============================================================
// 初始化
// ============================================================
function init() {
    console.log('🚀 梓睿聊天启动');

    // 检查登录状态
    const loggedIn = checkLoginStatus();

    if (loggedIn) {
        console.log('✅ 已登录:', currentUser?.username);
    } else {
        console.log('👤 未登录');
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
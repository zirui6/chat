// ============================================================
// 配置 - 直接使用 Supabase
// ============================================================
const CONFIG = {
    SUPABASE_URL: 'https://uigzsxmkulephkfkiebj.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_OgyvGDiFuFAKKGYMmnq3GA_nXqIRCmW',
    WEBSITE: 'https://zirui6.github.io',
};

// ============================================================
// DOM 引用
// ============================================================
const $ = (id) => document.getElementById(id);

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
// Supabase 请求封装
// ============================================================
async function supabaseFetch(endpoint, options = {}) {
    const url = CONFIG.SUPABASE_URL + '/rest/v1' + endpoint;
    const headers = {
        'apikey': CONFIG.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'omit'
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || '请求失败');
    }
    return response.json();
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
    toastTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 3000);
}

// ============================================================
// 登录管理
// ============================================================
function goToLogin() {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = CONFIG.WEBSITE + '/user.html?redirect=' + returnUrl;
}

let currentUser = null;
let isLoggedIn = false;

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
    loadMessages();
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

// 默认联系人
const DEFAULT_CONTACTS = [
    {
        id: 'public',
        username: '公共频道',
        display_name: '🌐 公共频道',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'public'
    },
    {
        id: -1,
        username: '文件传输助手',
        display_name: '文件传输助手',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'self'
    }
];

// ============================================================
// 加载消息
// ============================================================
async function loadMessages() {
    if (!isLoggedIn) return;

    try {
        // 从 Supabase 获取消息（公共 + 发给自己的）
        const data = await supabaseFetch(
            `/messages?order=created_at.desc&limit=100`
        );
        
        if (Array.isArray(data) && data.length > 0) {
            // 按发送者分组
            const grouped = {};
            data.forEach(msg => {
                const key = msg.sender_id || 'unknown';
                if (!grouped[key]) {
                    grouped[key] = [];
                }
                grouped[key].push(msg);
            });

            // 构建聊天列表
            const userChats = Object.keys(grouped).map(senderId => {
                const msgs = grouped[senderId];
                const lastMsg = msgs[msgs.length - 1];
                return {
                    id: senderId,
                    username: lastMsg.sender_name || '用户',
                    display_name: lastMsg.sender_name || '用户',
                    avatar_url: lastMsg.sender_avatar || 'https://zirui6.github.io/touxiang.jpg',
                    last_message: lastMsg.content || '',
                    last_time: lastMsg.created_at || new Date().toISOString(),
                    type: 'friend'
                };
            });

            // 合并默认联系人 + 用户列表
            const existingIds = new Set(userChats.map(c => c.id));
            const defaultFiltered = DEFAULT_CONTACTS.filter(c => !existingIds.has(c.id));
            chatList = [...defaultFiltered, ...userChats];
        } else {
            chatList = DEFAULT_CONTACTS;
        }

        renderChatList();

        if (chatList.length > 0) {
            selectChat(chatList[0]);
        }

    } catch (error) {
        console.error('加载消息失败:', error);
        const list = $('chatList');
        if (list) {
            list.innerHTML = `
                <div style="text-align:center;padding:30px 0;color:#666688;">
                    <p>❌ 加载失败</p>
                    <p style="font-size:12px;">${error.message}</p>
                    <button onclick="loadMessages()" style="margin-top:12px;padding:6px 20px;background:#4a6cf7;color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 重试</button>
                </div>
            `;
        }
    }
}

// ============================================================
// 渲染聊天列表
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

    list.innerHTML = chatList.map(chat => {
        const active = currentChat && currentChat.id === chat.id;
        const name = chat.display_name || chat.username || '用户';
        const avatar = chat.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
        const lastMsg = chat.last_message || '暂无消息';
        const time = chat.last_time ? formatTime(chat.last_time) : '';

        return `
            <div class="chat-item ${active ? 'active' : ''}" 
                 data-id="${chat.id}"
                 onclick="selectChatById('${chat.id}')">
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

    loadLocalMessages(chat.id);
    scrollToBottom();
}

function selectChatById(id) {
    const chat = chatList.find(c => String(c.id) === String(id));
    if (chat) selectChat(chat);
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
// 发送消息到 Supabase
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

    // 判断是否公共消息
    const isPublic = currentChat.type === 'public' || currentChat.id === 'public';
    const receiverId = isPublic ? null : currentChat.id;

    // 构建消息对象
    const msgData = {
        content: content,
        sender_id: currentUser.id,
        sender_name: currentUser.username || currentUser.display_name || '用户',
        sender_avatar: currentUser.avatar_url || 'https://zirui6.github.io/touxiang.jpg',
        receiver_id: receiverId,
        created_at: new Date().toISOString()
    };

    // 立即显示在本地
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

    // 更新聊天列表
    const chat = chatList.find(c => c.id === currentChat.id);
    if (chat) {
        chat.last_message = content;
        chat.last_time = new Date().toISOString();
        renderChatList();
    }

    // 发送到 Supabase
    try {
        const result = await supabaseFetch('/messages', {
            method: 'POST',
            body: JSON.stringify(msgData)
        });
        
        if (result && result.length > 0) {
            console.log('✅ 消息已保存到 Supabase');
        } else {
            console.warn('⚠️ 消息保存可能失败:', result);
        }
    } catch (error) {
        console.error('❌ 发送到 Supabase 失败:', error);
        showToast('消息已保存到本地，但云端同步失败', 'warning');
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
// 从 URL 参数获取用户数据（测试用）
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
// 事件绑定
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    const sendBtn = $('sendBtn');
    const messageInput = $('messageInput');
    const fileBtn = $('fileBtn');
    const imageBtn = $('imageBtn');
    const fileInput = $('fileInput');
    const imageInput = $('imageInput');
    const addFriendBtn = $('addFriendBtn');

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

    if (fileBtn && fileInput) {
        fileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', function() {
            showToast('📎 文件上传功能开发中', 'info');
            this.value = '';
        });
    }

    if (imageBtn && imageInput) {
        imageBtn.addEventListener('click', () => imageInput.click());
        imageInput.addEventListener('change', function() {
            showToast('🖼️ 图片上传功能开发中', 'info');
            this.value = '';
        });
    }

    if (addFriendBtn) {
        addFriendBtn.addEventListener('click', () => {
            showToast('👥 好友功能开发中', 'info');
        });
    }
});

// ============================================================
// 初始化
// ============================================================
function init() {
    console.log('🚀 梓睿聊天启动 (Supabase 版)');

    // 检查 URL 参数（测试入口）
    const urlUser = getUserFromURL();
    if (urlUser) {
        console.log('✅ 从 URL 获取用户:', urlUser.username);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 检查登录状态
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

// ============================================================
// 新增功能函数
// ============================================================

// 切换标签页
function switchTab(tab) {
    // 更新按钮状态
    document.querySelectorAll('.func-item[data-tab]').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.func-item[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // 显示对应侧边栏
    const sidebarChat = document.getElementById('sidebarChat');
    const sidebarFriends = document.getElementById('sidebarFriends');
    const sidebarSettings = document.getElementById('sidebarSettings');

    if (sidebarChat) sidebarChat.style.display = tab === 'chat' ? 'flex' : 'none';
    if (sidebarFriends) sidebarFriends.style.display = tab === 'friends' ? 'flex' : 'none';
    if (sidebarSettings) sidebarSettings.style.display = tab === 'settings' ? 'flex' : 'none';

    // 如果切换到好友，加载好友列表
    if (tab === 'friends') {
        loadFriendList();
    }
}

// 打开设置
function openSettings() {
    switchTab('settings');
}

// 打开测试入口
function openTest() {
    window.open('test.html', '_blank');
}

// 打开添加好友
function openAddFriend() {
    document.getElementById('addFriendModal').classList.add('show');
    document.getElementById('addFriendInput').focus();
}

function closeAddFriend() {
    document.getElementById('addFriendModal').classList.remove('show');
    document.getElementById('addFriendInput').value = '';
    document.getElementById('addFriendMsg').value = '';
    document.getElementById('searchResults').innerHTML = '';
}

// 加载好友列表
async function loadFriendList() {
    const list = document.getElementById('friendList');
    if (!list) return;

    // TODO: 从 Supabase 加载好友列表
    list.innerHTML = `
        <div style="text-align:center;padding:40px 0;color:#666688;">
            <div style="font-size:40px;margin-bottom:12px;">👥</div>
            <p>好友功能开发中</p>
            <p style="font-size:12px;">点击 ➕ 添加好友</p>
        </div>
    `;
}

// 搜索并添加好友
async function searchAndAddFriend() {
    const input = document.getElementById('addFriendInput');
    const keyword = input.value.trim();

    if (!keyword) {
        showToast('请输入用户ID或用户名', 'warning');
        return;
    }

    // TODO: 实现搜索逻辑
    showToast('🔍 搜索功能开发中', 'info');
}

// 清除缓存
function clearAllData() {
    if (confirm('确定要清除所有本地缓存数据吗？')) {
        // 清除所有聊天消息缓存
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('chat_messages_')) {
                localStorage.removeItem(key);
            }
        });
        showToast('✅ 缓存已清除', 'success');
        // 重新加载当前聊天
        if (currentChat) {
            loadLocalMessages(currentChat.id);
        }
    }
}

// 退出登录
function logout() {
    if (confirm('确定要退出登录吗？')) {
        localStorage.removeItem('chat_user_data');
        localStorage.removeItem('auth_token');
        sessionStorage.clear();
        isLoggedIn = false;
        currentUser = null;
        document.getElementById('loginOverlay').classList.add('show');
        updateUIForGuest();
        showToast('已退出登录', 'info');
    }
}

// 打开二维码
function openQR() {
    const modal = document.getElementById('qrModal');
    const userIdEl = document.getElementById('qrUserId');
    if (modal) modal.classList.add('show');
    if (userIdEl && currentUser) {
        userIdEl.textContent = currentUser.id || '-';
    }
}

function closeQR() {
    document.getElementById('qrModal').classList.remove('show');
}

// 复制用户ID
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

// 头像点击事件
document.addEventListener('DOMContentLoaded', function() {
    const avatarBtn = document.getElementById('avatarBtn');
    if (avatarBtn) {
        avatarBtn.addEventListener('click', openQR);
    }

    // 添加好友提交
    const addFriendSubmit = document.getElementById('addFriendSubmit');
    if (addFriendSubmit) {
        addFriendSubmit.addEventListener('click', searchAndAddFriend);
    }

    // 添加好友输入回车
    const addFriendInput = document.getElementById('addFriendInput');
    if (addFriendInput) {
        addFriendInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') searchAndAddFriend();
        });
    }

    // 复制ID按钮
    const copyIdBtn = document.getElementById('copyIdBtn');
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', copyUserId);
    }

    // 文件上传
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                showToast(`📎 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
            }
            this.value = '';
        });
    }

    const imageInput = document.getElementById('imageInput');
    if (imageInput) {
        imageInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                showToast(`🖼️ 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
            }
            this.value = '';
        });
    }
});

// 测试入口函数
function goToTest() {
    window.location.href = 'test.html';
}

// 导出函数供 HTML 调用
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
window.goToTest = goToTest;
window.goToLogin = goToLogin;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

console.log('📋 Supabase URL:', CONFIG.SUPABASE_URL);
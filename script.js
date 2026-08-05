// ============================================================
// 梓睿聊天 · 主逻辑（Supabase 版）
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

function init() {
    console.log('🚀 梓睿聊天启动 (Supabase 版)');
    
    // 加载主题
    loadTheme();
    // 加载UI模式
    loadUIMode();
    // 检测设备
    detectDevice();

    // ... 其余初始化代码
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

function goToTest() {
    window.location.href = 'test.html';
}

let currentUser = null;
let isLoggedIn = false;
let pollingInterval = null;

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
        id: '-1',
        username: '文件传输助手',
        display_name: '📎 文件传输助手',
        avatar_url: 'https://zirui6.github.io/icon48.png',
        is_default: true,
        type: 'self'
    }
];

// ============================================================
// 加载消息（从 Supabase 拉取）
// ============================================================
async function loadMessages() {
    if (!isLoggedIn) return;

    try {
        const response = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/messages?order=created_at.desc&limit=200', {
            headers: {
                'apikey': CONFIG.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('📥 加载到 ' + data.length + ' 条消息');

            // 过滤消息：只显示公共消息 + 发给自己的 + 自己发的
            const filtered = data.filter(msg => {
                // 公共消息：receiver_id 为 null 或 'public'
                if (msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public') {
                    return true;
                }
                // 发给自己的
                if (msg.receiver_id === currentUser.id) {
                    return true;
                }
                // 自己发的
                if (msg.sender_id === currentUser.id) {
                    return true;
                }
                // 文件传输助手
                if (msg.receiver_id === '-1' || msg.sender_id === '-1') {
                    return true;
                }
                return false;
            });

            // 按发送者分组（用于聊天列表）
            const grouped = {};
            filtered.forEach(msg => {
                const key = msg.sender_id || 'unknown';
                if (!grouped[key]) {
                    grouped[key] = [];
                }
                grouped[key].push(msg);
            });

            // 构建聊天列表
            const userChats = Object.keys(grouped).map(senderId => {
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

            // 合并默认联系人
            const existingIds = new Set(userChats.map(c => c.id));
            const defaultFiltered = DEFAULT_CONTACTS.filter(c => !existingIds.has(c.id));
            chatList = [...defaultFiltered, ...userChats];

            renderChatList();

            // 如果有当前选中的聊天，刷新消息
            if (currentChat) {
                const chat = chatList.find(c => c.id === currentChat.id);
                if (chat) {
                    currentChat = chat;
                    // 加载该聊天对应的消息
                    loadLocalMessages(chat.id);
                }
            } else if (chatList.length > 0) {
                selectChat(chatList[0]);
            }

        } else {
            console.warn('加载消息失败:', response.status);
        }

    } catch (error) {
        console.error('加载消息失败:', error);
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
// 本地消息存储（缓存）
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

    console.log('📤 发送消息:', msgData);

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
            const result = await response.json();
            console.log('✅ 消息已保存到 Supabase', result);
            showToast('✅ 消息已发送', 'success');
        } else {
            const errorText = await response.text();
            console.error('❌ 保存失败:', response.status, errorText);
            showToast('⚠️ 本地已保存，云端同步失败', 'error');
        }
    } catch (error) {
        console.error('❌ 网络错误:', error);
        showToast('⚠️ 本地已保存，云端同步失败', 'error');
    }
}

// ============================================================
// 轮询（自动刷新消息）
// ============================================================
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
        if (!isLoggedIn) return;
        try {
            // 只刷新当前聊天
            if (currentChat) {
                const response = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/messages?order=created_at.desc&limit=50', {
                    headers: {
                        'apikey': CONFIG.SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    // 过滤消息
                    const filtered = data.filter(msg => {
                        if (msg.receiver_id === null || msg.receiver_id === 'null' || msg.receiver_id === 'public') {
                            return true;
                        }
                        if (msg.receiver_id === currentUser.id) return true;
                        if (msg.sender_id === currentUser.id) return true;
                        if (msg.receiver_id === '-1' || msg.sender_id === '-1') return true;
                        return false;
                    });

                    // 检查是否有新消息
                    if (filtered.length > 0) {
                        const latest = filtered[0];
                        const lastLocal = messages[messages.length - 1];
                        if (!lastLocal || latest.id !== lastLocal.id) {
                            // 有新消息，重新加载
                            console.log('🔄 检测到新消息，刷新...');
                            loadLocalMessages(currentChat.id);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('轮询错误:', error);
        }
    }, 3000);
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
// 从 URL 参数获取用户数据
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

    const sidebarChat = document.getElementById('sidebarChat');
    const sidebarFriends = document.getElementById('sidebarFriends');
    const sidebarSettings = document.getElementById('sidebarSettings');

    if (sidebarChat) sidebarChat.style.display = tab === 'chat' ? 'flex' : 'none';
    if (sidebarFriends) sidebarFriends.style.display = tab === 'friends' ? 'flex' : 'none';
    if (sidebarSettings) sidebarSettings.style.display = tab === 'settings' ? 'flex' : 'none';
}

function openSettings() { switchTab('settings'); }
function openTest() { window.open('test.html', '_blank'); }

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

function loadFriendList() {
    const list = document.getElementById('friendList');
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
    const input = document.getElementById('addFriendInput');
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
            if (key.startsWith('chat_messages_')) {
                localStorage.removeItem(key);
            }
        });
        showToast('✅ 缓存已清除', 'success');
        if (currentChat) {
            loadLocalMessages(currentChat.id);
        }
    }
}

function logout() {
    if (confirm('确定要退出登录吗？')) {
        localStorage.removeItem('chat_user_data');
        localStorage.removeItem('auth_token');
        sessionStorage.clear();
        isLoggedIn = false;
        currentUser = null;
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        document.getElementById('loginOverlay').classList.add('show');
        updateUIForGuest();
        showToast('已退出登录', 'info');
    }
}

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
// 主题切换
// ============================================================
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    showToast(next === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式', 'info');
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
}

// ============================================================
// 移动端检测 & UI 切换
// ============================================================
let isMobile = false;

function detectMobile() {
    isMobile = window.innerWidth <= 768;
    const app = document.getElementById('app');
    if (isMobile) {
        app.classList.add('mobile');
        document.body.classList.add('mobile-mode');
    } else {
        app.classList.remove('mobile');
        document.body.classList.remove('mobile-mode');
    }
}

function toggleMobileStyle() {
    const app = document.getElementById('app');
    app.classList.toggle('wechat-style');
    const isWechat = app.classList.contains('wechat-style');
    localStorage.setItem('ui_style', isWechat ? 'wechat' : 'default');
    showToast(isWechat ? '📱 微信风格' : '💻 默认风格', 'info');
}

function loadUIStyle() {
    const style = localStorage.getItem('ui_style') || 'default';
    const app = document.getElementById('app');
    if (style === 'wechat') {
        app.classList.add('wechat-style');
    }
}

// ============================================================
// 事件绑定
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    // 加载主题
    loadTheme();
    // 加载UI风格
    loadUIStyle();
    // 检测移动端
    detectMobile();

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

    document.getElementById('fileInput')?.addEventListener('change', function() {
        if (this.files.length > 0) {
            showToast(`📎 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
        }
        this.value = '';
    });

    document.getElementById('imageInput')?.addEventListener('change', function() {
        if (this.files.length > 0) {
            showToast(`🖼️ 已选择: ${this.files[0].name}，上传功能开发中`, 'info');
        }
        this.value = '';
    });

    document.getElementById('addFriendSubmit')?.addEventListener('click', searchAndAddFriend);
    document.getElementById('addFriendInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') searchAndAddFriend();
    });

    document.getElementById('avatarBtn')?.addEventListener('click', openQR);
    document.getElementById('copyIdBtn')?.addEventListener('click', copyUserId);

    // 窗口大小变化时重新检测移动端
    window.addEventListener('resize', detectMobile);
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
window.toggleMobileStyle = toggleMobileStyle;

// ============================================================
// 初始化
// ============================================================
function init() {
    console.log('🚀 梓睿聊天启动 (Supabase 版)');

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

// ============================================================
// 设备检测 & UI 模式
// ============================================================

let deviceType = 'desktop'; // 'desktop' | 'tablet' | 'mobile'
let uiMode = 'auto'; // 'auto' | 'default' | 'wechat'

function detectDevice() {
    const width = window.innerWidth;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    if (width <= 480) {
        deviceType = 'mobile';
    } else if (width <= 1024) {
        deviceType = 'tablet';
    } else {
        deviceType = 'desktop';
    }
    
    // 更新设备信息显示
    const deviceInfo = document.getElementById('deviceInfo');
    if (deviceInfo) {
        const icons = {
            'mobile': '📱 手机',
            'tablet': '📱 平板',
            'desktop': '🖥️ 桌面'
        };
        deviceInfo.textContent = icons[deviceType] || '🖥️ 桌面';
    }
    
    // 自动应用UI模式
    applyUIMode();
    
    return deviceType;
}

function applyUIMode() {
    const app = document.getElementById('app');
    const mode = uiMode === 'auto' ? getAutoMode() : uiMode;
    
    // 清除所有模式
    app.classList.remove('wechat-style');
    
    if (mode === 'wechat') {
        app.classList.add('wechat-style');
    }
    
    // 更新设置中的显示
    const statusEl = document.getElementById('uiModeStatus');
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
    // 手机和平板默认使用微信风格
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

// 主题切换
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    
    const statusEl = document.getElementById('themeStatus');
    if (statusEl) {
        statusEl.textContent = next === 'dark' ? '深色模式' : '浅色模式';
    }
    showToast(next === 'dark' ? '🌙 深色模式' : '☀️ 浅色模式', 'info');
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const statusEl = document.getElementById('themeStatus');
    if (statusEl) {
        statusEl.textContent = saved === 'dark' ? '深色模式' : '浅色模式';
    }
}

// ============================================================
// 移动端侧边栏控制
// ============================================================
function closeChat() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('hidden');
    }
}

function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('hidden');
    }
}

// 点击聊天窗口时关闭侧边栏（移动端）
document.addEventListener('DOMContentLoaded', function() {
    const chatWindow = document.getElementById('chatWindow');
    if (chatWindow) {
        chatWindow.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('hidden')) {
                    // 不自动关闭，让用户手动控制
                }
            }
        });
    }
    
    // 窗口大小变化时重新检测
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            detectDevice();
        }, 300);
    });
});

// 在初始化中调用
// 在 init 函数中添加：
// loadTheme();
// loadUIMode();
// detectDevice();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

console.log('📋 Supabase URL:', CONFIG.SUPABASE_URL);
// ============================================================
// 梓睿聊天 · 主逻辑
// ============================================================

// ============================================================
// 配置
// ============================================================
const CONFIG = {
    CHAT_API: 'https://chat1.ziruicloud.de5.net',
    AUTH_API: 'https://webcloud.ziruicloud.de5.net',
    WEBSITE: 'https://zirui6.github.io',
};

// ============================================================
// Cookie 工具
// ============================================================
const CookieHelper = {
    get: function(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    },
    set: function(name, value, days) {
        const expires = days ? '; expires=' + new Date(Date.now() + days * 86400000).toUTCString() : '';
        document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
    },
    delete: function(name) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    }
};

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

// ============================================================
// 工具函数
// ============================================================
function getToken() {
    return sessionStorage.getItem('auth_token') || CookieHelper.get('auth_token');
}

function getLocalUser() {
    try {
        const data = sessionStorage.getItem('user_data');
        if (data) return JSON.parse(data);
    } catch (e) {}
    try {
        const data = localStorage.getItem('chat_user_data');
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

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(fileName) {
    if (!fileName) return '📄';
    const ext = fileName.split('.').pop().toLowerCase();
    const map = {
        'pdf': '📄', 'doc': '📝', 'docx': '📝', 'xls': '📊', 'xlsx': '📊',
        'ppt': '📽️', 'pptx': '📽️', 'zip': '📦', 'rar': '📦', '7z': '📦',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️',
        'mp4': '🎬', 'mp3': '🎵', 'txt': '📃', 'js': '💻', 'html': '🌐',
        'css': '🎨', 'json': '📋', 'py': '🐍', 'java': '☕', 'cpp': '⚙️'
    };
    return map[ext] || '📄';
}

function getInitials(name) {
    if (!name) return 'U';
    return name.charAt(0).toUpperCase();
}

// ============================================================
// DOM 引用
// ============================================================
const $ = (id) => document.getElementById(id);

// ============================================================
// 全局状态
// ============================================================
let currentUser = null;
let isLoggedIn = false;
let currentChat = null;
let chats = [];
let messages = [];
let friends = [];
let unreadCount = 0;
let pollingInterval = null;
let isSending = false;
let hasMoreMessages = true;
let pendingFile = null;
let lastTrigger = localStorage.getItem('chat_auth_trigger') || '';

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
function openLogin() {
    window.open(CONFIG.WEBSITE + '/login.html?source=chat', '_blank');
}

function checkLoginStatus() {
    const token = getToken();
    const localUser = getLocalUser();

    if (token && localUser) {
        currentUser = localUser;
        isLoggedIn = true;
        $('loginOverlay').classList.remove('show');
        updateUIForLoggedIn();
        return true;
    }

    const trigger = localStorage.getItem('chat_auth_trigger');
    if (trigger && trigger !== lastTrigger) {
        lastTrigger = trigger;
        const userData = localStorage.getItem('chat_user_data');
        if (userData) {
            try {
                currentUser = JSON.parse(userData);
                isLoggedIn = true;
                sessionStorage.setItem('user_data', userData);
                sessionStorage.setItem('auth_token', localStorage.getItem('auth_token') || '');
                $('loginOverlay').classList.remove('show');
                updateUIForLoggedIn();
                return true;
            } catch (e) {}
        }
    }

    isLoggedIn = false;
    currentUser = null;
    $('loginOverlay').classList.add('show');
    updateUIForGuest();
    return false;
}

async function verifyToken() {
    const token = getToken();
    if (!token) return false;

    try {
        const response = await fetch(CONFIG.AUTH_API + '/api/verify', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await response.json();

        if (data.valid || data.success || data.user) {
            const user = data.user || data;
            if (user.id) {
                currentUser = user;
                isLoggedIn = true;
                sessionStorage.setItem('user_data', JSON.stringify(user));
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
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
    startPolling();
}

function updateUIForGuest() {
    const list = $('chatList');
    if (list) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:var(--text-muted);">
                <div style="font-size:40px;margin-bottom:12px;">🔒</div>
                <p>请先登录</p>
                <p style="font-size:12px;margin-top:4px;">点击右上角登录</p>
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

    if (!token) {
        throw new Error('Token 不存在');
    }

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
        const verified = await verifyToken();
        if (!verified) {
            isLoggedIn = false;
            $('loginOverlay').classList.add('show');
            throw new Error('登录已过期，请重新登录');
        }
        return apiCall(endpoint, options);
    }

    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        data = await response.json();
    } else {
        const text = await response.text();
        console.error('非 JSON 响应:', text.substring(0, 200));
        throw new Error('服务器错误');
    }

    if (!response.ok) {
        throw new Error(data.error || '请求失败');
    }

    return data;
}

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

        unreadCount = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0);
        updateBadge();

        if (currentChat) {
            const chat = chats.find(c => c.id === currentChat.id);
            if (chat) {
                currentChat = chat;
                if (chat.type === 'friend' && chat.id > 0) {
                    loadMessages(chat.id);
                } else {
                    loadLocalMessages(chat.id);
                }
            } else {
                currentChat = null;
                showEmptyState();
            }
        } else if (chats.length > 0) {
            selectChat(chats[0]);
        }

    } catch (error) {
        console.error('加载聊天失败:', error);
        const list = $('chatList');
        list.innerHTML = `
            <div style="text-align:center;padding:30px 0;color:var(--text-muted);">
                <p>加载失败: ${error.message}</p>
                <button onclick="loadChats()" style="
                    margin-top:12px;
                    padding:6px 20px;
                    background:var(--accent);
                    color:#fff;
                    border:none;
                    border-radius:6px;
                    font-size:13px;
                    cursor:pointer;
                ">🔄 重试</button>
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
            <div style="text-align:center;padding:40px 0;color:var(--text-muted);">
                <div style="font-size:40px;margin-bottom:12px;">👥</div>
                <p>暂无聊天</p>
                <p style="font-size:12px;margin-top:4px;">点击 ➕ 添加好友</p>
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
        const unread = chat.unread_count || 0;
        const isDefault = chat.is_default;

        return `
            <div class="chat-item ${active ? 'active' : ''}" 
                 data-id="${chat.id}"
                 onclick="selectChatById(${chat.id})">
                <img src="${avatar}" class="avatar" alt="" 
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                <div class="avatar default" style="display:none;">${getInitials(name)}</div>
                <div class="info">
                    <div class="name">${name} ${isDefault ? '📌' : ''}</div>
                    <div class="last-msg">${lastMsg}</div>
                </div>
                <div class="meta">
                    <div class="time">${time}</div>
                    ${unread > 0 ? `<div class="unread">${unread}</div>` : ''}
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
    $('chatStatus').textContent = chat.is_default ? '在线' : '在线';

    if (chat.type === 'friend' && chat.id > 0) {
        loadMessages(chat.id);
        markRead(chat.id);
    } else {
        loadLocalMessages(chat.id);
    }

    scrollToBottom();

    if (window.innerWidth <= 768) {
        $('sidebar').classList.add('hidden');
    }
}

function selectChatById(id) {
    const chat = chats.find(c => c.id === id);
    if (chat) selectChat(chat);
}

// ============================================================
// 加载消息
// ============================================================
async function loadMessages(friendId, before = null) {
    try {
        const url = `/api/messages?friend_id=${friendId}&limit=50` + (before ? `&before=${before}` : '');
        const data = await apiCall(url);
        const newMessages = data.messages || [];

        if (before) {
            messages = [...newMessages, ...messages];
        } else {
            messages = newMessages;
        }

        renderMessages();
        hasMoreMessages = newMessages.length >= 50;

    } catch (error) {
        console.error('加载消息失败:', error);
    }
}

function loadLocalMessages(chatId) {
    const key = 'chat_messages_' + chatId;
    try {
        const data = localStorage.getItem(key);
        messages = data ? JSON.parse(data) : [];
        renderMessages();

        if (currentChat && currentChat.id === chatId) {
            if (messages.length === 0 && chatId === -1) {
                messages.push({
                    id: Date.now(),
                    sender_id: -1,
                    content: '📌 文件传输助手，可以在这里保存文件和笔记',
                    created_at: new Date().toISOString(),
                    is_system: true
                });
                saveLocalMessages(chatId);
            }
            if (messages.length === 0 && chatId === -2) {
                messages.push({
                    id: Date.now(),
                    sender_id: -2,
                    content: '👋 欢迎使用梓睿聊天！服务团队为你提供支持。',
                    created_at: new Date().toISOString(),
                    is_system: true
                });
                saveLocalMessages(chatId);
            }
            renderMessages();
        }
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
            <div style="text-align:center;padding:40px 0;color:var(--text-muted);">
                <p>暂无消息</p>
                <p style="font-size:12px;">开始聊天吧</p>
            </div>
        `;
        return;
    }

    let html = '';

    if (hasMoreMessages && currentChat && currentChat.type === 'friend' && currentChat.id > 0) {
        html += `
            <div style="text-align:center;padding:8px 0;">
                <button class="btn-primary" style="padding:4px 16px;font-size:12px;width:auto;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;" onclick="loadMoreMessages()">
                    ↑ 加载更多
                </button>
            </div>
        `;
    }

    messages.forEach(msg => {
        const isSent = msg.sender_id === currentUser?.id;
        const isSystem = msg.is_system;

        if (isSystem) {
            html += `
                <div style="text-align:center;padding:4px 0;">
                    <span style="font-size:12px;color:var(--text-muted);background:var(--bg-card);padding:4px 16px;border-radius:12px;">${msg.content}</span>
                </div>
            `;
            return;
        }

        const avatar = isSent 
            ? (currentUser?.avatar_url || 'https://zirui6.github.io/touxiang.jpg')
            : (currentChat?.avatar_url || 'https://zirui6.github.io/touxiang.jpg');
        const time = formatTime(msg.created_at);

        let contentHtml = '';
        if (msg.file_type && msg.file_url) {
            if (msg.file_type.startsWith('image/')) {
                contentHtml = `<img src="${msg.file_url}" class="msg-image" onclick="window.open('${msg.file_url}','_blank')" />`;
            } else {
                const icon = getFileIcon(msg.file_name);
                contentHtml = `
                    <div class="msg-file" onclick="window.open('${msg.file_url}','_blank')">
                        <span class="file-icon">${icon}</span>
                        <div class="file-info">
                            <div class="file-name">${msg.file_name || '文件'}</div>
                            <div class="file-size">${formatSize(msg.file_size)}</div>
                        </div>
                        <span>⬇️</span>
                    </div>
                `;
            }
        } else {
            contentHtml = msg.content || '';
        }

        html += `
            <div class="message ${isSent ? 'sent' : 'received'}">
                <img src="${avatar}" class="msg-avatar" alt="" onerror="this.src='https://zirui6.github.io/touxiang.jpg'" />
                <div>
                    <div class="msg-bubble">${contentHtml}</div>
                    <div class="msg-time">${time}</div>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
    scrollToBottom();
}

function loadMoreMessages() {
    if (!currentChat || messages.length === 0 || !hasMoreMessages) return;
    const oldest = messages[0];
    if (!oldest || currentChat.type !== 'friend') return;

    const list = $('messageList');
    const loadingEl = document.createElement('div');
    loadingEl.textContent = '⏳ 加载中...';
    loadingEl.style.cssText = 'text-align:center;padding:8px 0;color:var(--text-muted);font-size:13px;';
    list.prepend(loadingEl);

    loadMessages(currentChat.id, oldest.created_at).then(() => {
        loadingEl.remove();
    }).catch(() => {
        loadingEl.remove();
    });
}

// ============================================================
// 发送消息
// ============================================================
async function sendMessage() {
    const input = $('messageInput');
    const content = input.value.trim();

    if (!content && !pendingFile) return;
    if (!currentChat) {
        showToast('请先选择聊天', 'warning');
        return;
    }
    if (isSending) return;

    isSending = true;
    const sendBtn = $('sendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中...';

    try {
        let fileData = null;
        if (pendingFile) {
            const formData = new FormData();
            formData.append('file', pendingFile);

            const uploadResponse = await fetch(CONFIG.CHAT_API + '/api/upload', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + getToken()
                },
                body: formData
            });

            if (!uploadResponse.ok) {
                const error = await uploadResponse.json().catch(() => ({}));
                throw new Error(error.error || '文件上传失败');
            }
            fileData = await uploadResponse.json();
            if (!fileData.success) {
                throw new Error(fileData.error || '文件上传失败');
            }
            pendingFile = null;
            $('fileInput').value = '';
            $('imageInput').value = '';
        }

        const isDefaultChat = currentChat.is_default;

        if (isDefaultChat) {
            const msg = {
                id: Date.now(),
                sender_id: currentUser.id,
                content: content || null,
                file_type: fileData?.file_type || null,
                file_url: fileData?.file_url || null,
                file_name: fileData?.file_name || null,
                file_size: fileData?.file_size || null,
                created_at: new Date().toISOString(),
                is_system: false
            };
            messages.push(msg);
            saveLocalMessages(currentChat.id);

            const chat = chats.find(c => c.id === currentChat.id);
            if (chat) {
                chat.last_message = content || (fileData?.file_name || '文件');
                chat.last_time = new Date().toISOString();
                renderChatList();
            }

            renderMessages();
            scrollToBottom();

        } else if (currentChat.type === 'friend' && currentChat.id > 0) {
            const payload = {
                receiver_id: currentChat.id,
                content: content || null,
                file_type: fileData?.file_type || null,
                file_url: fileData?.file_url || null,
                file_name: fileData?.file_name || null,
                file_size: fileData?.file_size || null
            };

            const data = await apiCall('/api/messages', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (data.success && data.message) {
                const msg = data.message;
                messages.push(msg);
                renderMessages();
                scrollToBottom();

                const chat = chats.find(c => c.id === currentChat.id);
                if (chat) {
                    chat.last_message = content || (fileData?.file_name || '文件');
                    chat.last_time = new Date().toISOString();
                    renderChatList();
                }
            }
        }

        input.value = '';
        input.style.height = 'auto';

    } catch (error) {
        console.error('发送失败:', error);
        showToast('发送失败: ' + error.message, 'error');
    }

    isSending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
}

// ============================================================
// 标记已读
// ============================================================
async function markRead(friendId) {
    try {
        await apiCall('/api/messages/read', {
            method: 'POST',
            body: JSON.stringify({ sender_id: friendId })
        });
        const chat = chats.find(c => c.id === friendId);
        if (chat) {
            chat.unread_count = 0;
            renderChatList();
        }
    } catch (error) {}
}

// ============================================================
// 未读总数
// ============================================================
function updateBadge() {
    const badge = $('totalBadge');
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'block';
        document.title = '(' + unreadCount + ') 梓睿聊天';
    } else {
        badge.style.display = 'none';
        document.title = '梓睿聊天';
    }
}

// ============================================================
// 好友请求
// ============================================================
async function searchAndAddFriend() {
    const input = $('addFriendInput');
    const keyword = input.value.trim();

    if (!keyword) {
        showToast('请输入用户ID或用户名', 'warning');
        return;
    }

    if (/^\d+$/.test(keyword)) {
        await sendFriendRequest(parseInt(keyword));
        return;
    }

    try {
        const data = await apiCall(`/api/search-user?q=${encodeURIComponent(keyword)}`);
        const results = data.users || [];

        const container = $('searchResults');
        if (results.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px;">
                    未找到用户，请输入正确的用户ID
                </div>
            `;
            return;
        }

        container.innerHTML = results.map(user => `
            <div class="search-result" onclick="sendFriendRequest(${user.id})">
                <img src="${user.avatar_url || 'https://zirui6.github.io/touxiang.jpg'}" alt="" />
                <div class="info">
                    <div class="name">${user.display_name || user.username}</div>
                    <div class="id">ID: ${user.id}</div>
                </div>
                <button class="add-btn">添加</button>
            </div>
        `).join('');

    } catch (error) {
        showToast('搜索失败: ' + error.message, 'error');
    }
}

async function sendFriendRequest(targetId) {
    const msg = $('addFriendMsg').value.trim() || '你好，加个好友吧！';

    try {
        await apiCall('/api/friend-request', {
            method: 'POST',
            body: JSON.stringify({
                target_id: targetId,
                message: msg
            })
        });
        showToast('✅ 好友请求已发送', 'success');
        $('addFriendModal').classList.remove('show');
        $('addFriendInput').value = '';
        $('addFriendMsg').value = '';
        $('searchResults').innerHTML = '';
        await loadChats();
    } catch (error) {
        showToast('发送失败: ' + error.message, 'error');
    }
}

// ============================================================
// 文件上传
// ============================================================
function handleFileSelect(file) {
    if (file.size > 10 * 1024 * 1024) {
        showToast('文件不能超过 10MB', 'error');
        return;
    }
    pendingFile = file;
    showToast(`📎 已选择: ${file.name} (${formatSize(file.size)})，点击发送`, 'info');
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

function showEmptyState() {
    $('emptyState').style.display = 'flex';
    $('chatHeader').style.display = 'none';
    $('chatInput').style.display = 'none';
    $('messageList').innerHTML = '';
}

// ============================================================
// 轮询
// ============================================================
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
        if (!isLoggedIn) return;
        try {
            const data = await apiCall('/api/friends');
            friends = data.friends || [];

            chats.forEach(chat => {
                if (chat.type === 'friend' && chat.id > 0) {
                    const friend = friends.find(f => f.friend_id === chat.id);
                    if (friend) {
                        chat.unread_count = friend.unread_count || 0;
                        chat.last_message = friend.last_message || chat.last_message;
                        chat.last_time = friend.last_time || chat.last_time;
                    }
                }
            });

            unreadCount = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            updateBadge();
            renderChatList();

            if (currentChat && currentChat.type === 'friend' && currentChat.id > 0) {
                const data2 = await apiCall(`/api/messages?friend_id=${currentChat.id}&limit=1`);
                const newMessages = data2.messages || [];
                if (newMessages.length > 0) {
                    const lastMsg = newMessages[newMessages.length - 1];
                    const existingLast = messages[messages.length - 1];
                    if (!existingLast || lastMsg.id !== existingLast.id) {
                        await loadMessages(currentChat.id);
                        await markRead(currentChat.id);
                        scrollToBottom();
                    }
                }
            }
        } catch (error) {
            console.error('轮询错误:', error);
        }
    }, 3000);
}

// ============================================================
// 二维码
// ============================================================
function showQRCode() {
    const modal = $('qrModal');
    const container = document.getElementById('qrcode');
    const userIdEl = $('qrUserId');

    if (!modal || !container) return;

    container.innerHTML = '';
    userIdEl.textContent = currentUser?.id || '';

    if (typeof QRCode !== 'undefined' && currentUser) {
        new QRCode(container, {
            text: JSON.stringify({ type: 'user_id', id: currentUser.id, username: currentUser.username }),
            width: 180,
            height: 180,
            colorDark: '#4a6cf7',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    modal.classList.add('show');
}

// ============================================================
// 登录监听（跨标签页）
// ============================================================
window.addEventListener('storage', function(e) {
    if (e.key === 'chat_auth_trigger') {
        console.log('🔄 检测到登录，刷新聊天...');
        setTimeout(() => location.reload(), 300);
    }
});

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        const token = getToken();
        const localUser = getLocalUser();
        if (token && localUser && !isLoggedIn) {
            console.log('🔄 页面可见，重新检查登录');
            location.reload();
        }
        if (isLoggedIn && chats.length === 0) {
            loadChats();
        }
    }
});

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
$('fileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
    e.target.value = '';
});

$('imageBtn').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
    e.target.value = '';
});

$('addFriendBtn').addEventListener('click', () => {
    $('addFriendModal').classList.add('show');
    $('addFriendInput').focus();
});

$('addFriendModalClose').addEventListener('click', () => {
    $('addFriendModal').classList.remove('show');
    $('addFriendInput').value = '';
    $('addFriendMsg').value = '';
    $('searchResults').innerHTML = '';
});

$('addFriendModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        $('addFriendModal').classList.remove('show');
        $('addFriendInput').value = '';
        $('addFriendMsg').value = '';
        $('searchResults').innerHTML = '';
    }
});

$('addFriendSubmit').addEventListener('click', searchAndAddFriend);
$('addFriendInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchAndAddFriend();
});

$('searchInput').addEventListener('input', function() {
    const keyword = this.value.trim().toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const name = item.querySelector('.name')?.textContent?.toLowerCase() || '';
        item.style.display = name.includes(keyword) ? 'flex' : 'none';
    });
});

$('myAvatar').addEventListener('click', showQRCode);
$('qrModalClose').addEventListener('click', () => $('qrModal').classList.remove('show'));
$('qrModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('qrModal').classList.remove('show');
});

$('copyIdBtn').addEventListener('click', () => {
    if (currentUser) {
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
});

document.querySelectorAll('.func-item[data-tab]').forEach(item => {
    item.addEventListener('click', function() {
        document.querySelectorAll('.func-item[data-tab]').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const tab = this.dataset.tab;
        if (tab === 'chat') {
            // 显示聊天
        } else if (tab === 'friends') {
            showToast('👥 好友列表功能开发中', 'info');
        } else if (tab === 'files') {
            showToast('📁 文件管理功能开发中', 'info');
        } else if (tab === 'settings') {
            showToast('⚙️ 设置功能开发中', 'info');
        }
    });
});

$('chatWindow').addEventListener('click', () => {
    if (window.innerWidth <= 768) {
        $('sidebar').classList.add('hidden');
    }
});

// ============================================================
// 初始化
// ============================================================
async function init() {
    console.log('🚀 梓睿聊天 v2.0 启动');

    const loggedIn = checkLoginStatus();

    if (loggedIn) {
        console.log('✅ 已登录:', currentUser?.username);
        await verifyToken();
    } else {
        console.log('👤 未登录，显示登录遮罩');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
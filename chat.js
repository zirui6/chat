// ============================================================
// 梓睿聊天 · 主逻辑（后台检测版）
// ============================================================

// ============================================================
// 配置
// ============================================================
const CHAT_API = 'https://chat.ziruicloud.de5.net';
const AUTH_API = 'https://webcloud.ziruicloud.de5.net';
const WEBSITE = 'https://zirui6.github.io';

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
// 全局状态
// ============================================================
let currentUser = null;
let isLoggedIn = false;
let currentFriend = null;
let friends = [];
let messages = [];
let unreadCount = 0;
let pollingInterval = null;
let isSending = false;
let hasMoreMessages = true;

// DOM 引用
const $ = (id) => document.getElementById(id);

// ============================================================
// 获取 Token
// ============================================================
function getToken() {
    return sessionStorage.getItem('auth_token') || CookieHelper.get('auth_token');
}

// ============================================================
// 获取用户信息（从本地存储）
// ============================================================
function getLocalUser() {
    try {
        const data = sessionStorage.getItem('user_data');
        if (data) return JSON.parse(data);
    } catch (e) {}
    return null;
}

// ============================================================
// 后台检测登录状态（不跳转）
// ============================================================
async function checkAuthSilent() {
    const token = getToken();
    const localUser = getLocalUser();

    // 如果有本地用户数据，先显示
    if (localUser) {
        currentUser = localUser;
        isLoggedIn = true;
        updateUIForLoggedIn();
    }

    // 如果没有 token，显示未登录
    if (!token) {
        isLoggedIn = false;
        currentUser = null;
        updateUIForGuest();
        return false;
    }

    try {
        const response = await fetch(AUTH_API + '/api/verify', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await response.json();

        // 尝试多种返回格式
        if (data.valid === true || data.success === true || data.user || data.id) {
            currentUser = data.user || data;
            isLoggedIn = true;
            // 保存到本地
            sessionStorage.setItem('user_data', JSON.stringify(currentUser));
            updateUIForLoggedIn();
            return true;
        }

        // 验证失败
        isLoggedIn = false;
        currentUser = null;
        updateUIForGuest();
        return false;

    } catch (error) {
        console.warn('验证请求失败，使用缓存数据:', error);
        // 如果有本地用户，继续使用
        if (localUser) {
            currentUser = localUser;
            isLoggedIn = true;
            updateUIForLoggedIn();
            return true;
        }
        isLoggedIn = false;
        currentUser = null;
        updateUIForGuest();
        return false;
    }
}

// ============================================================
// 更新 UI - 已登录状态（修复版）
// ============================================================
function updateUIForLoggedIn() {
    // 显示个人信息
    if (currentUser) {
        $('myAvatar').src = currentUser.avatar_url || 'https://zirui6.github.io/touxiang.jpg';
        $('myName').textContent = currentUser.display_name || currentUser.username || '用户';
        $('myStatus').textContent = '在线';
        $('myStatus').style.color = 'var(--success)';
    }

    // 显示聊天功能
    $('chatInput').style.display = 'block';
    $('addFriendBtn').style.display = 'flex';
    $('searchInput').placeholder = '🔍 搜索好友或添加用户...';
    $('searchInput').disabled = false;

    // 移除未登录遮罩
    const guestOverlay = document.querySelector('.guest-overlay');
    if (guestOverlay) guestOverlay.remove();

    // ✅ 重要：在这里加载好友
    loadFriends();
    startPolling();
}

// ============================================================
// 更新 UI - 未登录状态（修复版）
// ============================================================
function updateUIForGuest() {
    // 移除已登录的遮罩
    const loggedOverlay = document.querySelector('.logged-overlay');
    if (loggedOverlay) loggedOverlay.remove();

    const sidebar = document.querySelector('.sidebar');
    let guestOverlay = document.querySelector('.guest-overlay');

    if (!guestOverlay) {
        guestOverlay = document.createElement('div');
        guestOverlay.className = 'guest-overlay';
        guestOverlay.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
            color: var(--text-muted);
            height: 100%;
            flex: 1;
        `;
        guestOverlay.innerHTML = `
            <div style="font-size: 56px; margin-bottom: 16px;">🔒</div>
            <h3 style="color: var(--text-primary); margin-bottom: 8px;">未登录</h3>
            <p style="font-size: 14px; margin-bottom: 16px;">请先登录梓睿网盘</p>
            <button onclick="window.location.href='${WEBSITE}/login.html'" style="
                padding: 10px 32px;
                background: var(--accent);
                color: #fff;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
            ">🔑 去登录</button>
            <p style="font-size: 12px; margin-top: 12px; color: var(--text-muted);">
                登录后自动同步聊天数据
            </p>
        `;
        sidebar.appendChild(guestOverlay);
    }

    // 隐藏聊天功能
    $('chatInput').style.display = 'none';
    $('addFriendBtn').style.display = 'none';
    $('searchInput').placeholder = '🔍 请先登录';
    $('searchInput').disabled = true;

    // 清空好友列表
    $('friendList').innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:var(--text-muted);">
            <p>请先登录查看好友</p>
        </div>
    `;

    // 清空消息
    $('messageList').innerHTML = '';
    $('emptyState').style.display = 'flex';
    $('chatHeader').style.display = 'none';
}

// ============================================================
// 后台检测登录状态（修复版）
// ============================================================
async function checkAuthSilent() {
    const token = getToken();
    const localUser = getLocalUser();

    console.log('🔍 检测登录状态, token:', token ? '存在' : '不存在');

    // 如果有本地用户数据，先显示
    if (localUser) {
        currentUser = localUser;
        isLoggedIn = true;
        console.log('✅ 使用本地用户数据:', currentUser.username);
        updateUIForLoggedIn();
        return true;
    }

    // 如果没有 token，显示未登录
    if (!token) {
        console.log('❌ 没有 token，未登录');
        isLoggedIn = false;
        currentUser = null;
        updateUIForGuest();
        return false;
    }

    try {
        console.log('🔄 验证 token...');
        const response = await fetch(AUTH_API + '/api/verify', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await response.json();
        console.log('📡 验证响应:', data);

        // 尝试多种返回格式
        if (data.valid === true || data.success === true || data.user || data.id) {
            currentUser = data.user || data;
            isLoggedIn = true;
            // 保存到本地
            sessionStorage.setItem('user_data', JSON.stringify(currentUser));
            console.log('✅ 验证成功:', currentUser.username);
            updateUIForLoggedIn();
            return true;
        }

        // 验证失败
        console.log('❌ 验证失败');
        isLoggedIn = false;
        currentUser = null;
        updateUIForGuest();
        return false;

    } catch (error) {
        console.warn('⚠️ 验证请求失败:', error);
        // 如果有本地用户，继续使用
        if (localUser) {
            currentUser = localUser;
            isLoggedIn = true;
            updateUIForLoggedIn();
            return true;
        }
        isLoggedIn = false;
        currentUser = null;
        updateUIForGuest();
        return false;
    }
}

// ============================================================
// 更新 UI - 未登录状态
// ============================================================
function updateUIForGuest() {
    // 显示未登录提示
    const sidebar = document.querySelector('.sidebar');
    let guestOverlay = document.querySelector('.guest-overlay');

    if (!guestOverlay) {
        guestOverlay = document.createElement('div');
        guestOverlay.className = 'guest-overlay';
        guestOverlay.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
            color: var(--text-muted);
            height: 100%;
        `;
        guestOverlay.innerHTML = `
            <div style="font-size: 56px; margin-bottom: 16px;">🔒</div>
            <h3 style="color: var(--text-primary); margin-bottom: 8px;">未登录</h3>
            <p style="font-size: 14px; margin-bottom: 16px;">请先登录梓睿网盘</p>
            <button onclick="window.location.href='${WEBSITE}/login.html'" style="
                padding: 10px 32px;
                background: var(--accent);
                color: #fff;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
            ">🔑 去登录</button>
            <p style="font-size: 12px; margin-top: 12px; color: var(--text-muted);">
                登录后自动同步聊天数据
            </p>
        `;
        sidebar.appendChild(guestOverlay);
    }

    // 隐藏聊天功能
    $('chatInput').style.display = 'none';
    $('addFriendBtn').style.display = 'none';
    $('searchInput').placeholder = '🔍 请先登录';
    $('searchInput').disabled = true;

    // 清空好友列表
    $('friendList').innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:var(--text-muted);">
            <p>请先登录查看好友</p>
        </div>
    `;

    // 清空消息
    $('messageList').innerHTML = '';
    $('emptyState').style.display = 'flex';
    $('chatHeader').style.display = 'none';
}

// ============================================================
// API 调用（带登录检测）
// ============================================================
async function apiCall(endpoint, options = {}) {
    if (!isLoggedIn) {
        throw new Error('未登录');
    }

    const url = CHAT_API + endpoint;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    if (response.status === 401) {
        // 401 时自动重新验证
        isLoggedIn = false;
        await checkAuthSilent();
        if (!isLoggedIn) {
            throw new Error('登录已过期，请重新登录');
        }
        // 重试请求
        return apiCall(endpoint, options);
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '请求失败');
    }

    return response.json();
}

// ============================================================
// 以下函数保持不变，但都需要先检查 isLoggedIn
// ============================================================

// 加载好友列表
async function loadFriends() {
    if (!isLoggedIn) return;
    try {
        const data = await apiCall('/api/friends');
        friends = data.friends || [];
        renderFriendList();

        const unreadData = await apiCall('/api/messages/unread');
        unreadCount = unreadData.total || 0;
        updateUnreadBadge();

        if (currentFriend) {
            const friend = friends.find(f => f.friend_id === currentFriend.friend_id);
            if (friend) {
                currentFriend = friend;
                loadMessages(currentFriend.friend_id);
            } else {
                currentFriend = null;
                showEmptyState();
            }
        }
    } catch (error) {
        console.error('加载好友失败:', error);
    }
}

// 渲染好友列表
function renderFriendList() {
    const list = $('friendList');
    const requests = $('friendRequests');
    const requestsList = $('requestsList');

    if (!isLoggedIn) {
        list.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--text-muted);"><p>请先登录</p></div>`;
        return;
    }

    // 好友请求
    const pendingRequests = friends.filter(f => f.status === 'pending');
    if (pendingRequests.length > 0) {
        requests.style.display = 'block';
        requestsList.innerHTML = pendingRequests.map(f => `
            <div class="request-item" data-id="${f.friend_id}">
                <img src="${f.avatar_url || 'https://zirui6.github.io/touxiang.jpg'}" alt="" />
                <div class="req-info">
                    <div class="req-name">${f.display_name || f.username}</div>
                    <div class="req-msg">请求添加你为好友</div>
                </div>
                <div class="req-actions">
                    <button class="accept-btn" onclick="acceptFriend(${f.friend_id})">接受</button>
                    <button class="reject-btn" onclick="rejectFriend(${f.friend_id})">拒绝</button>
                </div>
            </div>
        `).join('');
    } else {
        requests.style.display = 'none';
    }

    const acceptedFriends = friends.filter(f => f.status === 'accepted');
    if (acceptedFriends.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:40px 16px;color:var(--text-muted);">
                <div style="font-size:40px;margin-bottom:12px;">👥</div>
                <p>还没有好友</p>
                <p style="font-size:12px;margin-top:4px;">点击 ➕ 添加好友</p>
            </div>
        `;
        return;
    }

    list.innerHTML = acceptedFriends.map(f => {
        const isActive = currentFriend && currentFriend.friend_id === f.friend_id;
        const lastMsg = f.last_message || '';
        const lastTime = f.last_time ? formatTime(f.last_time) : '';
        const unread = f.unread_count || 0;

        return `
            <div class="friend-item ${isActive ? 'active' : ''}" 
                 data-id="${f.friend_id}"
                 onclick="selectFriend(${f.friend_id})">
                <img src="${f.avatar_url || 'https://zirui6.github.io/touxiang.jpg'}" alt="" />
                <div class="friend-info">
                    <div class="friend-name">${f.display_name || f.username}</div>
                    <div class="friend-last">${lastMsg || '暂无消息'}</div>
                </div>
                ${unread > 0 ? `<div class="friend-badge">${unread}</div>` : ''}
                <div class="friend-time">${lastTime}</div>
            </div>
        `;
    }).join('');
}

// ============================================================
// 轮询（仅登录时）
// ============================================================
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
        if (!isLoggedIn) return;
        try {
            await loadFriends();
            if (currentFriend) {
                const data = await apiCall(`/api/messages?friend_id=${currentFriend.friend_id}&limit=1`);
                const newMessages = data.messages || [];
                if (newMessages.length > 0) {
                    const lastMsg = newMessages[newMessages.length - 1];
                    const existingLast = messages[messages.length - 1];
                    if (!existingLast || lastMsg.id !== existingLast.id) {
                        await loadMessages(currentFriend.friend_id);
                        await markRead(currentFriend.friend_id);
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
// 初始化（静默检测，不跳转）
// ============================================================
async function init() {
    // 先设置默认状态
    updateUIForGuest();

    // 静默检测登录
    const loggedIn = await checkAuthSilent();

    if (loggedIn) {
        console.log('✅ 已登录:', currentUser?.username);
        // 如果有好友，默认选择第一个
        const acceptedFriends = friends.filter(f => f.status === 'accepted');
        if (acceptedFriends.length > 0) {
            await selectFriend(acceptedFriends[0].friend_id);
        } else {
            showEmptyState();
        }
    } else {
        console.log('👤 未登录，显示游客模式');
    }

    console.log('✅ 梓睿聊天已启动');
}

// ============================================================
// 以下函数保持不变（selectFriend, loadMessages, sendMessage 等）
// ============================================================
// ... 保留之前的所有函数 ...
// ============================================================
// 聊天 API 处理函数
// ============================================================

// 添加路由（在 fetch 函数中）
if (path === '/api/chat/friends' && method === 'GET') {
    return await handleGetFriends(request, env);
} else if (path === '/api/chat/friend-request' && method === 'POST') {
    return await handleFriendRequest(request, env);
} else if (path === '/api/chat/friend-requests' && method === 'GET') {
    return await handleGetFriendRequests(request, env);
} else if (path === '/api/chat/friend-requests/accept' && method === 'POST') {
    return await handleAcceptFriend(request, env);
} else if (path === '/api/chat/friend-requests/reject' && method === 'POST') {
    return await handleRejectFriend(request, env);
} else if (path === '/api/chat/messages' && method === 'GET') {
    return await handleGetMessages(request, env);
} else if (path === '/api/chat/messages' && method === 'POST') {
    return await handleSendMessage(request, env);
} else if (path === '/api/chat/upload' && method === 'POST') {
    return await handleUploadFile(request, env);
} else if (path === '/api/chat/search-user' && method === 'GET') {
    return await handleSearchUser(request, env);
} else if (path === '/api/chat/unread-count' && method === 'GET') {
    return await handleUnreadCount(request, env);
} else if (path === '/api/chat/mark-read' && method === 'POST') {
    return await handleMarkRead(request, env);
}

// ============================================================
// 聊天 API 实现
// ============================================================

// 1. 获取好友列表
async function handleGetFriends(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        // 获取好友列表（双向）
        const friends = await env.DB.prepare(`
            SELECT DISTINCT 
                CASE 
                    WHEN f.user_id = ? THEN f.friend_id 
                    ELSE f.user_id 
                END as friend_id,
                u.username,
                u.display_name,
                u.avatar_url,
                f.status,
                (
                    SELECT COUNT(*) FROM messages 
                    WHERE sender_id = friend_id AND receiver_id = ? AND is_read = 0
                ) as unread_count,
                (
                    SELECT content FROM messages 
                    WHERE (sender_id = friend_id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = friend_id)
                    ORDER BY created_at DESC LIMIT 1
                ) as last_message,
                (
                    SELECT created_at FROM messages 
                    WHERE (sender_id = friend_id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = friend_id)
                    ORDER BY created_at DESC LIMIT 1
                ) as last_time
            FROM friends f
            JOIN users u ON (u.id = f.user_id OR u.id = f.friend_id)
            WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted' AND u.id != ?
            GROUP BY friend_id
            ORDER BY last_time DESC
        `).bind(userId, userId, userId, userId, userId, userId, userId, userId, userId).all();

        return jsonResponse({
            success: true,
            friends: friends.results || []
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 2. 发送好友请求
async function handleFriendRequest(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const { target_id, message } = await request.json();

        if (!target_id) {
            return jsonResponse({ success: false, error: '请输入对方ID' }, 400);
        }

        // 检查是否是自己
        if (parseInt(target_id) === userId) {
            return jsonResponse({ success: false, error: '不能添加自己为好友' }, 400);
        }

        // 检查用户是否存在
        const targetUser = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target_id).first();
        if (!targetUser) {
            return jsonResponse({ success: false, error: '用户不存在' }, 404);
        }

        // 检查是否已是好友或已有请求
        const existing = await env.DB.prepare(`
            SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
        `).bind(userId, target_id, target_id, userId).first();

        if (existing) {
            if (existing.status === 'accepted') {
                return jsonResponse({ success: false, error: '已经是好友了' }, 400);
            }
            if (existing.status === 'pending') {
                return jsonResponse({ success: false, error: '已发送好友请求，等待对方确认' }, 400);
            }
        }

        // 检查是否已有好友请求
        const requestExists = await env.DB.prepare(
            'SELECT * FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = "pending"'
        ).bind(userId, target_id).first();

        if (requestExists) {
            return jsonResponse({ success: false, error: '已发送好友请求，等待确认' }, 400);
        }

        // 发送好友请求
        await env.DB.prepare(
            'INSERT INTO friend_requests (sender_id, receiver_id, message) VALUES (?, ?, ?)'
        ).bind(userId, target_id, message || '').run();

        // 同时在 friends 表中创建记录
        await env.DB.prepare(
            'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, "pending")'
        ).bind(userId, target_id).run();

        return jsonResponse({ success: true, message: '好友请求已发送' });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 3. 获取好友请求列表
async function handleGetFriendRequests(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const requests = await env.DB.prepare(`
            SELECT fr.*, u.username, u.display_name, u.avatar_url
            FROM friend_requests fr
            JOIN users u ON u.id = fr.sender_id
            WHERE fr.receiver_id = ? AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
        `).bind(userId).all();

        return jsonResponse({
            success: true,
            requests: requests.results || []
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 4. 接受好友请求
async function handleAcceptFriend(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const { request_id } = await request.json();

        // 更新好友请求状态
        await env.DB.prepare(
            'UPDATE friend_requests SET status = "accepted" WHERE id = ? AND receiver_id = ?'
        ).bind(request_id, userId).run();

        // 获取请求信息
        const req = await env.DB.prepare(
            'SELECT sender_id FROM friend_requests WHERE id = ?'
        ).bind(request_id).first();

        if (req) {
            // 更新 friends 表状态
            await env.DB.prepare(
                'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?'
            ).bind(req.sender_id, userId).run();

            // 添加反向好友关系
            await env.DB.prepare(
                'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")'
            ).bind(userId, req.sender_id).run();
        }

        return jsonResponse({ success: true, message: '已接受好友请求' });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 5. 拒绝好友请求
async function handleRejectFriend(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const { request_id } = await request.json();

        // 获取请求信息
        const req = await env.DB.prepare(
            'SELECT sender_id FROM friend_requests WHERE id = ? AND receiver_id = ?'
        ).bind(request_id, userId).first();

        if (req) {
            await env.DB.prepare('DELETE FROM friend_requests WHERE id = ?').bind(request_id).run();
            await env.DB.prepare(
                'DELETE FROM friends WHERE user_id = ? AND friend_id = ?'
            ).bind(req.sender_id, userId).run();
        }

        return jsonResponse({ success: true, message: '已拒绝好友请求' });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 6. 获取聊天消息
async function handleGetMessages(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const url = new URL(request.url);
        const friendId = url.searchParams.get('friend_id');
        const limit = parseInt(url.searchParams.get('limit')) || 50;
        const before = url.searchParams.get('before');

        if (!friendId) {
            return jsonResponse({ success: false, error: '缺少好友ID' }, 400);
        }

        // 验证是否为好友
        const isFriend = await env.DB.prepare(
            'SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) AND status = "accepted"'
        ).bind(userId, friendId, friendId, userId).first();

        if (!isFriend) {
            return jsonResponse({ success: false, error: '不是好友' }, 403);
        }

        // 获取消息
        let query = `
            SELECT m.*, u.username, u.display_name, u.avatar_url
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY m.created_at DESC
            LIMIT ?
        `;
        let params = [userId, friendId, friendId, userId, limit];

        if (before) {
            query = `
                SELECT m.*, u.username, u.display_name, u.avatar_url
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
                AND m.created_at < datetime(?)
                ORDER BY m.created_at DESC
                LIMIT ?
            `;
            params = [userId, friendId, friendId, userId, before, limit];
        }

        const messages = await env.DB.prepare(query).bind(...params).all();

        return jsonResponse({
            success: true,
            messages: (messages.results || []).reverse()
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 7. 发送消息
async function handleSendMessage(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const { receiver_id, content, file_type, file_url, file_name, file_size } = await request.json();

        if (!receiver_id) {
            return jsonResponse({ success: false, error: '缺少接收者' }, 400);
        }

        if (!content && !file_url) {
            return jsonResponse({ success: false, error: '内容不能为空' }, 400);
        }

        // 验证是否为好友
        const isFriend = await env.DB.prepare(
            'SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) AND status = "accepted"'
        ).bind(userId, receiver_id, receiver_id, userId).first();

        if (!isFriend) {
            return jsonResponse({ success: false, error: '不是好友' }, 403);
        }

        // 插入消息
        const result = await env.DB.prepare(`
            INSERT INTO messages (sender_id, receiver_id, content, file_type, file_url, file_name, file_size)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(userId, receiver_id, content || null, file_type || null, file_url || null, file_name || null, file_size || null).run();

        const messageId = result.meta.last_row_id;

        // 获取发送者信息
        const user = await env.DB.prepare('SELECT username, display_name, avatar_url FROM users WHERE id = ?').bind(userId).first();

        return jsonResponse({
            success: true,
            message: {
                id: messageId,
                sender_id: userId,
                receiver_id: receiver_id,
                content: content,
                file_type: file_type,
                file_url: file_url,
                file_name: file_name,
                file_size: file_size,
                created_at: new Date().toISOString(),
                username: user.username,
                display_name: user.display_name,
                avatar_url: user.avatar_url
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 8. 上传文件（R2）
async function handleUploadFile(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return jsonResponse({ success: false, error: '请选择文件' }, 400);
        }

        // 限制 10MB
        if (file.size > 10 * 1024 * 1024) {
            return jsonResponse({ success: false, error: '文件不能超过 10MB' }, 400);
        }

        // 生成唯一文件名
        const key = `chat/${userId}/${Date.now()}_${file.name}`;
        
        // 上传到 R2
        await env.R2.put(key, file.stream(), {
            httpMetadata: {
                contentType: file.type || 'application/octet-stream',
                contentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`
            }
        });

        // 获取公开 URL（需要 R2 公开桶）
        const publicUrl = `https://your-r2-domain.com/${key}`;

        return jsonResponse({
            success: true,
            file_url: publicUrl,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 9. 搜索用户
async function handleSearchUser(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const url = new URL(request.url);
        const keyword = url.searchParams.get('q');

        if (!keyword || keyword.length < 2) {
            return jsonResponse({ success: false, error: '请输入至少2个字符' }, 400);
        }

        const users = await env.DB.prepare(`
            SELECT id, username, display_name, avatar_url
            FROM users
            WHERE id != ? AND (username LIKE ? OR display_name LIKE ?)
            LIMIT 10
        `).bind(userId, `%${keyword}%`, `%${keyword}%`).all();

        return jsonResponse({
            success: true,
            users: users.results || []
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 10. 获取未读消息数
async function handleUnreadCount(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const result = await env.DB.prepare(`
            SELECT sender_id, COUNT(*) as count
            FROM messages
            WHERE receiver_id = ? AND is_read = 0
            GROUP BY sender_id
        `).bind(userId).all();

        const unread = {};
        (result.results || []).forEach(row => {
            unread[row.sender_id] = row.count;
        });

        // 总未读
        const total = await env.DB.prepare(
            'SELECT COUNT(*) as total FROM messages WHERE receiver_id = ? AND is_read = 0'
        ).bind(userId).first();

        return jsonResponse({
            success: true,
            unread: unread,
            total: total?.total || 0
        });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}

// 11. 标记消息已读
async function handleMarkRead(request, env) {
    try {
        const userId = await authenticate(request, env);
        if (!userId) {
            return jsonResponse({ success: false, error: '请先登录' }, 401);
        }

        const { sender_id } = await request.json();

        await env.DB.prepare(
            'UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0'
        ).bind(sender_id, userId).run();

        return jsonResponse({ success: true, message: '已标记已读' });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message }, 500);
    }
}
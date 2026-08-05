/* ============================================================
   头像状态圆点
   ============================================================ */
.avatar-wrapper {
    position: relative;
    flex-shrink: 0;
}

.status-dot-online,
.status-dot-offline {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--bg-sidebar);
}

.status-dot-online {
    background: #22c55e;
}

.status-dot-offline {
    background: #666688;
}

/* ============================================================
   未读红点徽章
   ============================================================ */
.unread-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    background: #ef4444;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    border-radius: 10px;
    text-align: center;
    line-height: 1;
}

#totalBadge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    background: #ef4444;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    border-radius: 10px;
    display: none;
    align-items: center;
    justify-content: center;
    line-height: 1;
}
# -*- coding: utf-8 -*-
"""
认证会话相关定时任务
"""
import logging
from datetime import datetime

from webapp.tools.mongo import DATABASE
from webapp.tools.security import IDLE_TIMEOUT_MINUTES, close_session

logger = logging.getLogger(__name__)


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone().replace(tzinfo=None)
        return value
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is not None:
                return dt.astimezone().replace(tzinfo=None)
            return dt
        except Exception:
            return None
    return None


async def event_driven_auth_session_cleanup_job() -> None:
    """
    定期清理仍为 active 但已超时/过期的会话。
    兜底场景：用户直接关闭浏览器，不再触发后续受保护请求。
    """
    now = datetime.now()
    scanned = 0
    expired_count = 0

    cursor = DATABASE.auth_sessions.find(
        {"status": "active"},
        {"sid": 1, "last_seen_at": 1, "expires_at": 1}
    )

    for doc in cursor:
        scanned += 1
        sid = doc.get("sid")
        if not sid:
            continue

        expires_at = _parse_dt(doc.get("expires_at"))
        if expires_at and now > expires_at:
            close_session(sid, status="expired", reason="token_expired_job")
            expired_count += 1
            continue

        last_seen_at = _parse_dt(doc.get("last_seen_at"))
        if last_seen_at and IDLE_TIMEOUT_MINUTES > 0:
            idle_seconds = (now - last_seen_at).total_seconds()
            if idle_seconds > IDLE_TIMEOUT_MINUTES * 60:
                close_session(sid, status="expired", reason="idle_timeout_job")
                expired_count += 1

    if expired_count > 0:
        logger.info(
            "会话清理任务完成：扫描 %s 条 active 会话，关闭 %s 条超时/过期会话",
            scanned,
            expired_count,
        )

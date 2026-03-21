# -*- coding: utf-8 -*-
"""
邮件通知工具

用途：
1. 统一 SMTP 邮件发送能力
2. 为“忘记密码 / 新设备验证 / 系统告警”提供复用底座
"""
from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional

from webapp.tools.mongo import get_config

logger = logging.getLogger(__name__)


def _to_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _split_emails(raw: str) -> List[str]:
    if not raw:
        return []
    items = [item.strip() for item in raw.replace(";", ",").split(",")]
    return [item for item in items if item]


@dataclass
class EmailSettings:
    enabled: bool
    smtp_server: str
    smtp_port: int
    sender_email: str
    sender_password: str
    default_recipients: List[str]
    use_ssl: bool
    use_tls: bool
    timeout_seconds: int


def load_email_settings() -> EmailSettings:
    """
    从 config.ini 读取邮件配置。

    约定使用 [ALERT] 段（兼容你当前配置项）：
    - email_enabled
    - smtp_server
    - smtp_port
    - sender_email
    - sender_password
    - recipient_emails
    - smtp_use_ssl（可选，默认 true）
    - smtp_use_tls（可选，默认 false）
    - smtp_timeout_seconds（可选，默认 10）
    """
    enabled = _to_bool(get_config("ALERT", "email_enabled", "false"), default=False)
    smtp_server = str(get_config("ALERT", "smtp_server", "") or "").strip()
    smtp_port = int(str(get_config("ALERT", "smtp_port", "465") or "465").strip())
    sender_email = str(get_config("ALERT", "sender_email", "") or "").strip()
    sender_password = str(get_config("ALERT", "sender_password", "") or "").strip()
    recipients = _split_emails(str(get_config("ALERT", "recipient_emails", "") or ""))
    use_ssl = _to_bool(get_config("ALERT", "smtp_use_ssl", "true"), default=True)
    use_tls = _to_bool(get_config("ALERT", "smtp_use_tls", "false"), default=False)
    timeout_seconds = int(str(get_config("ALERT", "smtp_timeout_seconds", "10") or "10").strip())

    return EmailSettings(
        enabled=enabled,
        smtp_server=smtp_server,
        smtp_port=smtp_port,
        sender_email=sender_email,
        sender_password=sender_password,
        default_recipients=recipients,
        use_ssl=use_ssl,
        use_tls=use_tls,
        timeout_seconds=timeout_seconds,
    )


def _validate_settings(settings: EmailSettings) -> Optional[str]:
    if not settings.enabled:
        return "邮件发送未启用（email_enabled=false）"
    if not settings.smtp_server:
        return "缺少 smtp_server 配置"
    if not settings.sender_email:
        return "缺少 sender_email 配置"
    if not settings.sender_password:
        return "缺少 sender_password 配置"
    if settings.smtp_port <= 0:
        return "smtp_port 配置无效"
    return None


def send_email(
    subject: str,
    body: str,
    recipients: Optional[List[str]] = None,
    html_body: Optional[str] = None,
) -> bool:
    """
    发送邮件。

    返回：
    - True：发送成功
    - False：发送失败（已记录日志）
    """
    settings = load_email_settings()
    invalid_reason = _validate_settings(settings)
    if invalid_reason:
        logger.warning("邮件发送取消：%s", invalid_reason)
        return False

    to_list = recipients or settings.default_recipients
    if not to_list:
        logger.warning("邮件发送取消：无有效收件人")
        return False

    msg = MIMEMultipart("alternative")
    msg["From"] = settings.sender_email
    msg["To"] = ", ".join(to_list)
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))
    if html_body:
        msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if settings.use_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_server,
                settings.smtp_port,
                timeout=settings.timeout_seconds,
            ) as server:
                server.login(settings.sender_email, settings.sender_password)
                server.sendmail(settings.sender_email, to_list, msg.as_string())
        else:
            with smtplib.SMTP(
                settings.smtp_server,
                settings.smtp_port,
                timeout=settings.timeout_seconds,
            ) as server:
                if settings.use_tls:
                    server.starttls()
                server.login(settings.sender_email, settings.sender_password)
                server.sendmail(settings.sender_email, to_list, msg.as_string())

        logger.info("邮件发送成功：subject=%s recipients=%s", subject, to_list)
        return True
    except Exception as exc:
        logger.error("邮件发送失败：subject=%s recipients=%s error=%s", subject, to_list, exc)
        return False


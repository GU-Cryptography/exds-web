import re
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

# This is a relative import, assuming the mongo tool is in the same 'tools' directory
from .mongo import DATABASE as db, get_config

logger = logging.getLogger(__name__)

# --- Password Hashing ---
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against a hashed one."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hashes a password."""
    return pwd_context.hash(password)

def validate_password_strength(password: str) -> (bool, str): # type: ignore
    """
    Validates the password strength.
    Returns a tuple (is_valid, message).
    """
    if len(password) < 8:
        return False, "密码长度至少 8 位。"
    
    checks = {
        "uppercase": re.search(r"[A-Z]", password),
        "lowercase": re.search(r"[a-z]", password),
        "digit": re.search(r"\d", password),
        "special": re.search(r"[!@#$%^&*.]", password),
    }
    
    met_criteria_count = sum(1 for check in checks.values() if check)
    
    if met_criteria_count < 3:
        return False, "密码需至少满足以下四类中的三类：大写字母、小写字母、数字、特殊字符（!@#$%^&*.）。"
        
    return True, "密码格式有效。"

# --- Security & Config Constants ---
# SECRET_KEY 从 .exds/config.ini [JWT] 段读取。若未配置则使用不安全的默认值并打印警告。
_secret_key_from_config = get_config('JWT', 'secret_key', default_value=None)
if _secret_key_from_config:
    SECRET_KEY = _secret_key_from_config
else:
    SECRET_KEY = "a_very_secret_key_that_should_be_changed"
    logger.warning(
        "⚠️  JWT SECRET_KEY 使用了不安全的默认值！"
        "请在 ~/.exds/config.ini 的 [JWT] 段配置 secret_key，例如：\n"
        "[JWT]\nsecret_key = <your-random-secret>"
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(get_config('JWT', 'access_token_expire_minutes', default_value='60'))

# 无操作空闲超时（分钟），从配置读取，默认 30 分钟
IDLE_TIMEOUT_MINUTES = int(get_config('AUTH', 'idle_timeout_minutes', default_value='30'))

# 授权开关：从 .exds/config.ini [AUTH] enabled 读取，默认开启
_auth_enabled_str = get_config('AUTH', 'enabled', default_value='true')
AUTH_ENABLED = str(_auth_enabled_str).strip().lower() not in ('false', '0', 'no')
if not AUTH_ENABLED:
    logger.warning("⚠️  权限校验已通过配置禁用（AUTH_ENABLED=false），仅限开发调试使用！")

# --- Pydantic Models ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    sid: Optional[str] = None  # 会话ID，阶段 1.5 预留

class User(BaseModel):
    username: str
    is_active: Optional[bool] = None
    display_name: Optional[str] = None
    roles: Optional[List[str]] = []
    email: Optional[str] = None

class UserInDB(User):
    hashed_password: str

# --- OAuth2 Scheme ---
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Database & Auth Functions ---
def get_user(db_session, username: str):
    user = db_session.users.find_one({"username": username})
    if user:
        return UserInDB(
            username=user.get("username"),
            is_active=user.get("is_active", True),
            hashed_password=user.get("hashed_password", ""),
            display_name=user.get("display_name") or user.get("full_name"),
            roles=user.get("roles", []),
            email=user.get("email"),
        )

def authenticate_user(db_session, username: str, password: str):
    user = get_user(db_session, username)
    if not user or not user.is_active:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    # 登录成功后立刻刷新活跃时间，避免“首个受保护请求”被空闲超时误判
    try:
        db_session.users.update_one(
            {"username": username},
            {"$set": {"last_active_at": datetime.now(timezone.utc).isoformat()}}
        )
    except Exception as e:
        logger.warning(f"登录后更新 last_active_at 失败（非致命）: {e}")
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def _throttled_update_last_active(username: str):
    """
    节流写入 last_active_at：仅当距上次更新超过 1 分钟时才写库，避免高频写入。
    """
    now = datetime.now(timezone.utc)
    user_doc = db.users.find_one({"username": username}, {"last_active_at": 1})
    if user_doc:
        last_active = user_doc.get("last_active_at")
        if last_active:
            if isinstance(last_active, str):
                try:
                    last_active = datetime.fromisoformat(last_active)
                    if last_active.tzinfo is None:
                        last_active = last_active.replace(tzinfo=timezone.utc)
                except ValueError:
                    last_active = None
            if last_active and (now - last_active).total_seconds() < 60:
                return  # 距上次更新不足 1 分钟，跳过写入
        db.users.update_one(
            {"username": username},
            {"$set": {"last_active_at": now.isoformat()}}
        )

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username, sid=payload.get("sid"))
    except JWTError:
        raise credentials_exception
    
    user = get_user(db, username=token_data.username)
    
    if user is None:
        raise credentials_exception

    # 空闲超时校验（AUTH_ENABLED 开关控制）
    if AUTH_ENABLED and IDLE_TIMEOUT_MINUTES > 0:
        user_doc = db.users.find_one({"username": username}, {"last_active_at": 1})
        if user_doc:
            last_active = user_doc.get("last_active_at")
            if last_active:
                if isinstance(last_active, str):
                    try:
                        last_active = datetime.fromisoformat(last_active)
                        if last_active.tzinfo is None:
                            last_active = last_active.replace(tzinfo=timezone.utc)
                    except ValueError:
                        last_active = None
                if last_active:
                    idle_seconds = (datetime.now(timezone.utc) - last_active).total_seconds()
                    if idle_seconds > IDLE_TIMEOUT_MINUTES * 60:
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Session expired due to inactivity",
                            headers={"WWW-Authenticate": "Bearer"},
                        )

    # 节流更新活跃时间
    try:
        _throttled_update_last_active(username)
    except Exception as e:
        logger.warning(f"更新 last_active_at 失败（非致命）: {e}")

    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

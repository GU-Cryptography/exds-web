from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from webapp.tools.mongo import DATABASE as db
from webapp.tools.ip_region import resolve_ip_city
from webapp.tools.logging_config import configure_logging
from webapp.api import v1
from webapp.scheduler import setup_scheduler

# Import security functions and models from the new security tool
from webapp.tools.security import (
    Token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    authenticate_user,
    cleanup_stale_active_sessions,
    create_access_token,
    create_auth_session,
    ensure_auth_session_indexes,
    enforce_single_active_session,
    find_active_session,
    get_current_active_user,
    kick_active_sessions,
)

# --- Initialization ---

# 全局日志初始化（方案A）
configure_logging()


def _now_local_iso() -> str:
    return datetime.now().isoformat()

def get_real_ip(request: Request) -> str:
    if "x-forwarded-for" in request.headers:
        return request.headers["x-forwarded-for"].split(',')[0].strip()
    return get_remote_address(request)

limiter = Limiter(key_func=get_real_ip, default_limits=["1000 per minute"])

app = FastAPI(
    title="电力交易辅助分析系统API",
    description="为前端提供数据接口服务",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Scheduler ---
setup_scheduler(app)

# --- API Routes ---


def _write_auth_audit_log(
    event: str,
    operator: str,
    target: Optional[str] = None,
    detail: Optional[dict] = None,
):
    try:
        db.auth_audit_logs.insert_one({
            "event": event,
            "operator": operator,
            "target": target,
            "detail": detail or {},
            "created_at": _now_local_iso(),
        })
    except Exception:
        # 审计日志失败不影响主流程
        pass


def _build_login_geo_detail(request: Request) -> dict:
    login_ip = get_real_ip(request)
    return {
        "login_ip": login_ip,
        "login_city": resolve_ip_city(login_ip),
    }

@app.post("/api/v1/token", response_model=Token, tags=["Authentication"])
@limiter.limit("5/minute")
async def login_for_access_token(
    request: Request,
    force: bool = False,
    form_data: OAuth2PasswordRequestForm = Depends()
):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        geo_detail = _build_login_geo_detail(request)
        _write_auth_audit_log(
            event="AUTH_LOGIN_FAILED",
            operator=form_data.username,
            target=form_data.username,
            detail=geo_detail,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    ensure_auth_session_indexes()
    cleanup_stale_active_sessions(user.username)

    active_session = find_active_session(user.username)
    if active_session and not force:
        geo_detail = _build_login_geo_detail(request)
        _write_auth_audit_log(
            event="AUTH_LOGIN_CONFLICT",
            operator=user.username,
            target=user.username,
            detail={
                "active_sid": active_session.get("sid"),
                **geo_detail,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "LOGIN_CONFLICT",
                "message": "账号已在其他会话登录，确认后将踢下线旧会话",
            }
        )

    if force:
        kicked_sid = active_session.get("sid") if active_session else None
        geo_detail = _build_login_geo_detail(request)
        kick_active_sessions(user.username, reason="force_login")
        _write_auth_audit_log(
            event="AUTH_SESSION_KICKED",
            operator=user.username,
            target=user.username,
            detail={
                "kicked_sid": kicked_sid,
                "reason": "force_login",
                **geo_detail,
            },
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    geo_detail = _build_login_geo_detail(request)
    sid = None
    for _ in range(2):
        try:
            sid = create_auth_session(
                user.username,
                ACCESS_TOKEN_EXPIRE_MINUTES,
                login_ip=geo_detail.get("login_ip"),
                login_city=geo_detail.get("login_city"),
            )
            break
        except DuplicateKeyError:
            cleanup_stale_active_sessions(user.username)
            if force:
                kick_active_sessions(user.username, reason="force_login_retry")
                continue
            latest_active = find_active_session(user.username)
            if latest_active:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "LOGIN_CONFLICT",
                        "message": "账号已在其他会话登录，确认后将踢下线旧会话",
                    }
                )
    if not sid:
        raise HTTPException(status_code=503, detail="登录会话创建失败，请稍后重试")

    db.users.update_one(
        {"username": user.username},
        {"$set": {"current_session_sid": sid}}
    )
    enforce_single_active_session(user.username, sid)
    access_token = create_access_token(
        data={"sub": user.username, "sid": sid}, expires_delta=access_token_expires
    )
    _write_auth_audit_log(
        event="AUTH_LOGIN_SUCCESS",
        operator=user.username,
        target=user.username,
        detail={
            "sid": sid,
            "force_login": bool(force),
            **geo_detail,
        },
    )
    return {"access_token": access_token, "token_type": "bearer"}

# Include v1 routers
app.include_router(v1.public_router)
app.include_router(v1.router, dependencies=[Depends(get_current_active_user)])



@app.get("/", tags=["Root"], summary="应用根路径")
def read_root():
    return {"message": "欢迎使用电力交易辅助分析系统API"}

# Trigger reload 2

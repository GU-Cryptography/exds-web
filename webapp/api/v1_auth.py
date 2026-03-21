# -*- coding: utf-8 -*-
"""
认证与授权管理 API
路径前缀：/api/v1/auth
"""
import logging
from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from webapp.tools.mongo import DATABASE as db, get_config
from webapp.tools.security import (
    get_current_active_user, get_password_hash, validate_password_strength, verify_password,
    IDLE_TIMEOUT_MINUTES, User, close_session, get_current_token_data, ensure_auth_session_indexes
)
from webapp.models.auth import (
    CurrentUserContext, UserInfo, Permission, Role,
    CreateUserRequest, UpdateUserRolesRequest, UpdateUserStatusRequest,
    ResetPasswordRequest, CreateRoleRequest, UpdateRoleRequest,
    UpdateRolePermissionsRequest, UpdateMyProfileRequest, ChangeMyPasswordRequest,
)
from webapp.api.dependencies.authz import (
    get_current_user_context, require_permission, require_any_permission
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["认证与授权"])


def _get_default_user_password() -> str:
    return get_config("AUTH", "default_password", "0000aaaa....")


# ==================== 工具函数 ====================

def _write_audit_log(event: str, operator: str, target: Optional[str] = None,
                     detail: Optional[dict] = None):
    """写入审计日志"""
    try:
        db.auth_audit_logs.insert_one({
            "event": event,
            "operator": operator,
            "target": target,
            "detail": detail or {},
            "created_at": datetime.now().isoformat(),
        })
    except Exception as e:
        logger.error(f"审计日志写入失败: {e}")




# ==================== 当前用户信息 ====================

@router.get("/me", response_model=UserInfo, summary="获取当前用户信息与权限")
async def get_me(
    ctx: CurrentUserContext = Depends(get_current_user_context),
):
    """
    登录后前端拉取此接口，获取：
    - 当前用户基本信息
    - 角色列表
    - 权限码列表
    - 空闲超时配置（供前端空闲计时器使用）
    """
    return UserInfo(
        username=ctx.username,
        display_name=ctx.display_name,
        email=ctx.email,
        roles=ctx.role_codes,
        permissions=ctx.permission_codes,
        is_super_admin=ctx.is_super_admin,
        idle_timeout_minutes=IDLE_TIMEOUT_MINUTES,
    )


@router.put("/me/profile", summary="更新当前用户资料")
async def update_my_profile(
    body: UpdateMyProfileRequest,
    current_user: User = Depends(get_current_active_user),
    _: CurrentUserContext = Depends(require_any_permission(["module:dashboard_overview:view", "system:auth:manage"])),
):
    update_fields = {
        "display_name": (body.display_name or "").strip() or None,
        "email": (body.email or "").strip() or None,
    }
    db.users.update_one(
        {"username": current_user.username},
        {"$set": update_fields}
    )
    _write_audit_log("SELF_PROFILE_UPDATED", current_user.username, current_user.username, update_fields)
    return {"message": "个人资料更新成功"}


@router.put("/me/password", summary="修改当前用户密码")
async def change_my_password(
    body: ChangeMyPasswordRequest,
    current_user: User = Depends(get_current_active_user),
    _: CurrentUserContext = Depends(require_any_permission(["module:dashboard_overview:view", "system:auth:manage"])),
):
    user_doc = db.users.find_one({"username": current_user.username})
    if not user_doc:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(body.old_password, user_doc.get("hashed_password", "")):
        raise HTTPException(status_code=400, detail="旧密码错误")
    is_valid, msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    db.users.update_one(
        {"username": current_user.username},
        {"$set": {
            "hashed_password": get_password_hash(body.new_password),
            "must_change_password": False,
            "password_changed_at": datetime.now().isoformat(),
        }}
    )
    _write_audit_log("SELF_PASSWORD_CHANGED", current_user.username, current_user.username)
    return {"message": "密码修改成功"}


@router.post("/logout", summary="当前用户主动登出")
async def logout_me(
    current_user: User = Depends(get_current_active_user),
    token_data = Depends(get_current_token_data),
):
    sid = token_data.sid
    if sid:
        close_session(sid, status="logout", reason="user_logout")
    _write_audit_log("AUTH_LOGOUT", current_user.username, current_user.username, {"sid": sid})
    return {"message": "登出成功"}


# ==================== 权限点管理 ====================

@router.get("/permissions", summary="获取权限点列表")
async def list_permissions(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    """获取所有权限点定义（供管理页使用）"""
    docs = list(db.auth_permissions.find({}, {"_id": 0}))
    return {"total": len(docs), "permissions": docs}


@router.get("/modules", summary="获取模块定义列表")
async def list_modules(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    """获取模块定义（按菜单顺序）"""
    docs = list(db.auth_modules.find({}, {"_id": 0}).sort([("sort_order", 1), ("module_code", 1)]))
    return {"total": len(docs), "modules": docs}


# ==================== 角色管理 ====================

@router.get("/roles", summary="获取角色列表")
async def list_roles(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    """获取所有角色定义"""
    docs = list(db.auth_roles.find({}, {"_id": 0}))
    return {"total": len(docs), "roles": docs}


@router.post("/roles", summary="创建角色", status_code=status.HTTP_201_CREATED)
async def create_role(
    body: CreateRoleRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    if db.auth_roles.find_one({"code": body.code}):
        raise HTTPException(status_code=400, detail=f"角色编码 {body.code} 已存在")
    doc = {
        "code": body.code,
        "name": body.name,
        "description": body.description,
        "permissions": body.permissions,
        "is_system": False,
        "is_active": True,
        "created_at": datetime.now().isoformat(),
    }
    db.auth_roles.insert_one(doc)
    _write_audit_log("ROLE_CREATED", ctx.username, body.code, {"name": body.name})
    return {"message": "角色创建成功", "code": body.code}


@router.put("/roles/{role_code}", summary="更新角色基本信息")
async def update_role(
    role_code: str,
    body: UpdateRoleRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    role = db.auth_roles.find_one({"code": role_code})
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.get("is_system"):
        raise HTTPException(status_code=400, detail="系统内置角色不允许修改")
    update_fields = {}
    if body.name is not None:
        update_fields["name"] = body.name
    if body.description is not None:
        update_fields["description"] = body.description
    if update_fields:
        db.auth_roles.update_one({"code": role_code}, {"$set": update_fields})
    _write_audit_log("ROLE_UPDATED", ctx.username, role_code, update_fields)
    return {"message": "更新成功"}


@router.put("/roles/{role_code}/permissions", summary="全量覆盖角色权限")
async def update_role_permissions(
    role_code: str,
    body: UpdateRolePermissionsRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    role = db.auth_roles.find_one({"code": role_code})
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    old_perms = role.get("permissions", [])
    db.auth_roles.update_one({"code": role_code}, {"$set": {"permissions": body.permissions}})
    _write_audit_log("ROLE_PERMISSIONS_UPDATED", ctx.username, role_code, {
        "before": old_perms, "after": body.permissions
    })
    return {"message": "权限更新成功"}


@router.delete("/roles/{role_code}", summary="删除角色")
async def delete_role(
    role_code: str,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    role = db.auth_roles.find_one({"code": role_code})
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.get("is_system"):
        raise HTTPException(status_code=400, detail="系统内置角色不允许删除")

    in_use = db.users.count_documents({"roles": role_code})
    if in_use > 0:
        raise HTTPException(status_code=400, detail=f"角色仍被 {in_use} 个用户使用，无法删除")

    db.auth_roles.delete_one({"code": role_code})
    _write_audit_log("ROLE_DELETED", ctx.username, role_code, {"name": role.get("name")})
    return {"message": "角色删除成功"}


# ==================== 用户管理 ====================

@router.get("/users", summary="获取系统用户列表")
async def list_users(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    skip = (page - 1) * page_size
    total = db.users.count_documents({})
    docs = list(db.users.find(
        {},
        {"hashed_password": 0, "last_active_at": 0}
    ).skip(skip).limit(page_size))
    for doc in docs:
        doc["_id"] = str(doc["_id"])
    return {"total": total, "users": docs}


@router.post("/users", summary="创建系统用户", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    if db.users.find_one({"username": body.username}):
        raise HTTPException(status_code=400, detail=f"用户名 {body.username} 已存在")
    password = (body.password or "").strip() or _get_default_user_password()
    is_valid, msg = validate_password_strength(password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    doc = {
        "username": body.username,
        "hashed_password": get_password_hash(password),
        "display_name": body.display_name,
        "email": body.email,
        "roles": body.roles,
        "is_active": True,
        "must_change_password": True,
        "created_at": datetime.now().isoformat(),
    }
    db.users.insert_one(doc)
    _write_audit_log("USER_CREATED", ctx.username, body.username, {
        "roles": body.roles,
        "used_default_password": not bool((body.password or "").strip()),
    })
    return {"message": "用户创建成功", "username": body.username}


@router.put("/users/{username}/roles", summary="全量覆盖用户角色")
async def update_user_roles(
    username: str,
    body: UpdateUserRolesRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    old_roles = user.get("roles", [])
    db.users.update_one({"username": username}, {"$set": {"roles": body.roles}})
    _write_audit_log("USER_ROLES_UPDATED", ctx.username, username, {
        "before": old_roles, "after": body.roles
    })
    return {"message": "角色更新成功"}


@router.put("/users/{username}/status", summary="启用/禁用用户")
async def update_user_status(
    username: str,
    body: UpdateUserStatusRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if username == ctx.username:
        raise HTTPException(status_code=400, detail="不能禁用自己的账号")
    db.users.update_one({"username": username}, {"$set": {"is_active": body.is_active}})
    action = "USER_ENABLED" if body.is_active else "USER_DISABLED"
    _write_audit_log(action, ctx.username, username)
    return {"message": "状态更新成功"}


@router.put("/users/{username}/password/reset", summary="重置用户密码")
async def reset_user_password(
    username: str,
    body: ResetPasswordRequest,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    new_password = (body.new_password or "").strip() or _get_default_user_password()
    is_valid, msg = validate_password_strength(new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=msg)
    db.users.update_one({"username": username}, {"$set": {
        "hashed_password": get_password_hash(new_password),
        "must_change_password": True,
        "password_changed_at": datetime.now().isoformat(),
    }})
    _write_audit_log("USER_PASSWORD_RESET", ctx.username, username, {
        "used_default_password": not bool((body.new_password or "").strip()),
    })
    return {"message": "密码重置成功，用户下次登录需修改密码"}


@router.delete("/users/{username}", summary="删除用户")
async def delete_user(
    username: str,
    ctx: CurrentUserContext = Depends(require_permission("system:auth:manage")),
):
    user = db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if username == ctx.username:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    if username in {"admin"}:
        raise HTTPException(status_code=400, detail="系统保留账号不允许删除")
    if user.get("is_active", True):
        raise HTTPException(status_code=400, detail="仅允许删除已禁用用户，请先禁用该用户")

    db.users.delete_one({"username": username})
    _write_audit_log("USER_DELETED", ctx.username, username)
    return {"message": "用户删除成功"}


# ==================== 审计日志 ====================

@router.get("/audit-logs", summary="查询审计日志")
async def get_audit_logs(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
    operator: Optional[str] = None,
    event: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = {}
    if operator:
        query["operator"] = operator
    if event:
        query["event"] = event
    if date_from or date_to:
        query["created_at"] = {}
        if date_from:
            query["created_at"]["$gte"] = date_from
        if date_to:
            query["created_at"]["$lte"] = date_to + "T23:59:59"

    skip = (page - 1) * page_size
    total = db.auth_audit_logs.count_documents(query)
    docs = list(db.auth_audit_logs.find(query, {"_id": 0})
                .sort("created_at", -1)
                .skip(skip)
                .limit(page_size))
    return {"total": total, "logs": docs}


@router.get("/sessions", summary="查询登录会话记录")
async def get_auth_sessions(
    _: CurrentUserContext = Depends(require_permission("system:auth:manage")),
    username: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    ensure_auth_session_indexes()

    query = {}
    if username:
        query["username"] = username
    if status_filter:
        query["status"] = status_filter
    if date_from or date_to:
        query["login_at"] = {}
        if date_from:
            query["login_at"]["$gte"] = date_from
        if date_to:
            query["login_at"]["$lte"] = date_to + "T23:59:59"

    skip = (page - 1) * page_size
    total = db.auth_sessions.count_documents(query)
    docs = list(
        db.auth_sessions.find(query, {"_id": 0})
        .sort("login_at", -1)
        .skip(skip)
        .limit(page_size)
    )
    return {"total": total, "sessions": docs}

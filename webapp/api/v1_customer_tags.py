from datetime import datetime
from fastapi import APIRouter, Body, Depends, HTTPException
from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user, User
from webapp.api.dependencies.authz import require_permission

router = APIRouter(tags=["v1-customer-tags"])

@router.get("/customer-tags", summary="获取所有可用的客户标签")
async def get_customer_tags(current_user: User = Depends(get_current_active_user)):
    """获取所有可用的客户标签"""
    tags_collection = DATABASE.customer_tags
    
    # 获取所有标签
    tags = list(tags_collection.find({}).sort("name", 1))
    
    # 转换 _id 为字符串
    result = []
    for tag in tags:
        result.append({
            "_id": str(tag["_id"]),
            "name": tag.get("name", ""),
            "category": tag.get("category"),
            "description": tag.get("description")
        })
    
    return result


@router.post("/customer-tags", summary="创建新的客户标签")
async def create_customer_tag(
    tag_data: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:customer_profiles:edit")),
):
    """创建新的客户标签"""
    
    tags_collection = DATABASE.customer_tags
    
    # 检查标签名称是否已存在
    existing = tags_collection.find_one({"name": tag_data.get("name")})
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"标签 '{tag_data.get('name')}' 已存在"
        )
    
    # 创建新标签
    new_tag = {
        "name": tag_data.get("name"),
        "category": tag_data.get("category"),
        "description": tag_data.get("description"),
        "created_by": current_user.username,
        "created_at": datetime.now()
    }
    
    result = tags_collection.insert_one(new_tag)
    
    return {
        "_id": str(result.inserted_id),
        "name": new_tag["name"],
        "category": new_tag.get("category"),
        "description": new_tag.get("description")
    }

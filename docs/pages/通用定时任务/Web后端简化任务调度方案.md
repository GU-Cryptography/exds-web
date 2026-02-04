# Web后端简化任务调度方案

> **版本**: v1.0 (简化版)  
> **创建日期**: 2026-02-03  
> **设计原则**: 简单实用,复用现有数据集

---

## 一、设计原则

### 1.1 简化目标

✅ **复用现有数据集**: 使用已有的 `task_execution_logs`, `system_alerts`, `task_commands`  
✅ **最小化新增**: 只添加必要的字段和功能  
✅ **统一触发**: 支持定时、事件、手工三种触发方式  
✅ **简单可靠**: 避免过度设计,专注核心功能  

### 1.2 核心组件

```
APScheduler (定时调度)
    ↓
Task Jobs (任务实现)
    ↓
TaskLogger (日志记录) → task_execution_logs
    ↓
Business Service (业务逻辑)
```

---

## 二、数据库设计 (复用现有)

### 2.1 任务执行日志 (`task_execution_logs`)

**已有集合,扩展字段支持新需求**

```javascript
{
  "_id": ObjectId("..."),
  
  // === 已有字段 (保持不变) ===
  "task_id": "web_load_aggregation_20260203_020000_a1b2",
  "service_type": "web",           // web/forecast/rpa
  "task_type": "load_aggregation", // 任务类型标识
  "task_name": "负荷数据聚合",
  "status": "SUCCESS",             // RUNNING/SUCCESS/FAILED/PARTIAL
  "start_time": ISODate("..."),
  "end_time": ISODate("..."),
  "duration": 325.5,
  "summary": "成功聚合 50 个客户的数据",
  "details": {
    "customers_processed": 50,
    "records_aggregated": 100
  },
  "error": null,
  "trigger_type": "schedule",      // schedule/manual/event
  
  // === 新增字段 (支持新功能) ===
  "trigger_source": null,          // 【新增】事件触发时记录来源 (如 RPA 任务ID)
  "triggered_by": "system",        // 【新增】手工触发时记录用户名
  "execution_lock": "load_aggregation:2026-02-03",  // 【新增】执行锁键 (防重复)
  "lock_acquired_at": ISODate("..."),  // 【新增】锁获取时间
  "lock_released_at": ISODate("..."),  // 【新增】锁释放时间
  
  // === 已有字段 ===
  "created_at": ISODate("..."),
  "updated_at": ISODate("...")
}
```

**新增索引**:
```javascript
// 支持执行锁查询
db.task_execution_logs.createIndex({ 
  "execution_lock": 1, 
  "status": 1 
})

// 支持按日期查询
db.task_execution_logs.createIndex({ 
  "task_type": 1, 
  "start_time": -1 
})
```

### 2.2 系统告警 (`system_alerts`)

**已有集合,无需修改**

### 2.3 任务命令 (`task_commands`)

**已有集合,无需修改**

---

## 三、任务类型定义

### 3.1 Web 任务类型枚举

**扩展现有的 `TaskType` 枚举**:

```python
class TaskType(str, Enum):
    """任务类型"""
    # === Web 任务 ===
    LOAD_AGGREGATION = "load_aggregation"           # 负荷数据聚合
    CHARACTERISTIC_ANALYSIS = "characteristic_analysis"  # 负荷特征分析
    DATA_CLEANUP = "data_cleanup"                   # 数据清理
    REPORT_GENERATION = "report_generation"         # 报表生成
    
    # === 预测任务 ===
    D1_PRICE_PRED = "d1_price_pred"
    D2_PRICE_PRED = "d2_price_pred"
    LOAD_PRED = "load_pred"
    
    # === 训练任务 ===
    D1_PRICE_TRAIN = "d1_price_train"
    D2_PRICE_TRAIN = "d2_price_train"
    LOAD_TRAIN = "load_train"
    
    # === RPA 任务 ===
    RPA_LOGIN = "rpa_login"
    RPA_DATA_DOWNLOAD = "rpa_data_download"
```

---

## 四、核心实现

### 4.1 目录结构

```
webapp/
├── scheduler/
│   ├── __init__.py
│   ├── core.py                    # 调度器核心 (已有)
│   ├── logger.py                  # 日志记录器 (已有,扩展)
│   └── jobs/
│       ├── __init__.py
│       ├── aggregation_jobs.py    # 聚合任务
│       └── analysis_jobs.py       # 分析任务
```

### 4.2 扩展 TaskLogger (支持执行锁)

**文件**: `webapp/scheduler/logger.py`

```python
from webapp.tools.mongo import DATABASE
from datetime import datetime, timedelta
import uuid
from typing import Optional

class TaskLogger:
    """任务日志记录器 (扩展版)"""
    
    @staticmethod
    async def log_task_start(
        service_type: str,
        task_type: str,
        task_name: str,
        trigger_type: str = "schedule",
        trigger_source: str = None,
        triggered_by: str = "system",
        execution_lock: str = None  # 【新增】执行锁键
    ) -> Optional[str]:
        """
        记录任务开始 (支持执行锁)
        
        Returns:
            task_id: 任务ID,如果锁已存在则返回 None
        """
        # 1. 检查执行锁
        if execution_lock:
            existing_lock = await DATABASE["task_execution_logs"].find_one({
                "execution_lock": execution_lock,
                "status": {"$in": ["RUNNING", "SUCCESS"]},  # 正在执行或已成功
                "start_time": {"$gte": datetime.utcnow() - timedelta(hours=24)}  # 24小时内
            })
            
            if existing_lock:
                print(f"⚠️ 执行锁已存在: {execution_lock}, 跳过执行")
                return None
        
        # 2. 生成任务ID
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        random_suffix = uuid.uuid4().hex[:4]
        task_id = f"{service_type}_{task_type}_{timestamp}_{random_suffix}"
        
        # 3. 写入日志
        await DATABASE["task_execution_logs"].insert_one({
            "task_id": task_id,
            "service_type": service_type,
            "task_type": task_type,
            "task_name": task_name,
            "status": "RUNNING",
            "start_time": datetime.utcnow(),
            "end_time": None,
            "duration": None,
            "summary": None,
            "details": None,
            "error": None,
            "trigger_type": trigger_type,
            "trigger_source": trigger_source,
            "triggered_by": triggered_by,
            "execution_lock": execution_lock,
            "lock_acquired_at": datetime.utcnow() if execution_lock else None,
            "lock_released_at": None,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        })
        
        print(f"📝 任务开始: {task_id} - {task_name}")
        if execution_lock:
            print(f"🔒 执行锁: {execution_lock}")
        
        return task_id
    
    @staticmethod
    async def log_task_end(
        task_id: str,
        status: str,
        summary: str = None,
        details: dict = None,
        error: dict = None
    ):
        """记录任务结束 (释放执行锁)"""
        end_time = datetime.utcnow()
        
        # 获取开始时间计算耗时
        log = await DATABASE["task_execution_logs"].find_one({"task_id": task_id})
        if log:
            duration = (end_time - log["start_time"]).total_seconds()
        else:
            duration = None
        
        # 更新日志
        await DATABASE["task_execution_logs"].update_one(
            {"task_id": task_id},
            {"$set": {
                "status": status,
                "end_time": end_time,
                "duration": duration,
                "summary": summary,
                "details": details,
                "error": error,
                "lock_released_at": end_time if log and log.get("execution_lock") else None,
                "updated_at": end_time
            }}
        )
        
        status_emoji = "✅" if status == "SUCCESS" else "❌"
        print(f"{status_emoji} 任务结束: {task_id} - {status} ({duration:.2f}s)")
```

### 4.3 任务实现模板

**文件**: `webapp/scheduler/jobs/aggregation_jobs.py`

```python
from webapp.scheduler.logger import TaskLogger
from webapp.services.load_aggregation_service import LoadAggregationService
from webapp.tools.mongo import DATABASE
from datetime import datetime, timedelta

# ========== 定时触发任务 ==========

async def scheduled_load_aggregation_job():
    """
    定时负荷数据聚合任务
    
    触发方式: 定时 (每天凌晨2点)
    执行锁: daily (每天只执行一次)
    """
    task_id = None
    try:
        # 1. 生成执行锁键 (每天一个锁)
        today = datetime.now().strftime("%Y-%m-%d")
        execution_lock = f"load_aggregation:scheduled:{today}"
        
        # 2. 记录任务开始 (自动检查锁)
        task_id = await TaskLogger.log_task_start(
            service_type="web",
            task_type="load_aggregation",
            task_name="负荷数据聚合 (定时)",
            trigger_type="schedule",
            execution_lock=execution_lock
        )
        
        if not task_id:
            # 锁已存在,今天已执行过
            return
        
        # 3. 执行业务逻辑
        result = await _aggregate_all_customers(today)
        
        # 4. 记录任务成功
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS",
            summary=f"成功聚合 {result['customers_processed']} 个客户的数据",
            details=result
        )
        
    except Exception as e:
        if task_id:
            await TaskLogger.log_task_end(
                task_id=task_id,
                status="FAILED",
                summary=f"聚合失败: {str(e)}",
                error={"message": str(e)}
            )
        raise


# ========== 事件触发任务 ==========

async def event_driven_load_aggregation_job():
    """
    事件驱动的负荷数据聚合任务
    
    触发方式: 事件 (监听 RPA 下载成功)
    执行频率: 每5分钟检查一次
    执行锁: daily (每天只执行一次)
    """
    task_id = None
    try:
        # 1. 生成执行锁键
        today = datetime.now().strftime("%Y-%m-%d")
        execution_lock = f"load_aggregation:event:{today}"
        
        # 2. 记录任务开始 (自动检查锁)
        task_id = await TaskLogger.log_task_start(
            service_type="web",
            task_type="load_aggregation",
            task_name="负荷数据聚合 (事件驱动)",
            trigger_type="event",
            execution_lock=execution_lock
        )
        
        if not task_id:
            # 今天已执行过
            return
        
        # 3. 查询 RPA 下载成功记录
        rpa_record = DATABASE["task_execution_records"].find_one({
            "pipeline_name": "用户负荷数据下载",
            "status": "SUCCESS",
            "execution_date": today
        })
        
        if not rpa_record:
            # 今天还没有下载成功记录
            await TaskLogger.log_task_end(
                task_id=task_id,
                status="SKIPPED",
                summary="今天暂无 RPA 下载成功记录"
            )
            return
        
        # 4. 执行聚合
        result = await _aggregate_all_customers(today)
        
        # 5. 记录成功
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS",
            summary=f"成功聚合 {result['customers_processed']} 个客户的数据",
            details={
                **result,
                "rpa_task_id": str(rpa_record["_id"])
            }
        )
        
    except Exception as e:
        if task_id:
            await TaskLogger.log_task_end(
                task_id=task_id,
                status="FAILED",
                summary=f"聚合失败: {str(e)}",
                error={"message": str(e)}
            )
        raise


# ========== 共享业务逻辑 ==========

async def _aggregate_all_customers(date: str) -> dict:
    """聚合所有客户的数据"""
    customers = list(DATABASE["customer_archives"].find({}, {"_id": 1}))
    
    customers_processed = 0
    records_aggregated = 0
    
    for customer in customers:
        customer_id = str(customer["_id"])
        
        try:
            result = LoadAggregationService.aggregate_mp_load(customer_id, date)
            
            if result:
                # 写入 unified_load_curve
                DATABASE["unified_load_curve"].update_one(
                    {"customer_id": customer_id, "date": date, "source": "mp"},
                    {"$set": {
                        "values": result["values"],
                        "total": result["total"],
                        "tou_usage": result.get("tou_usage", {}),
                        "updated_at": datetime.utcnow()
                    }},
                    upsert=True
                )
                
                customers_processed += 1
                records_aggregated += 1
                
        except Exception as e:
            print(f"⚠️ 聚合客户 {customer_id} 失败: {str(e)}")
            continue
    
    return {
        "customers_processed": customers_processed,
        "records_aggregated": records_aggregated
    }
```

### 4.4 注册任务到调度器

**文件**: `webapp/scheduler/core.py`

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from webapp.scheduler.jobs.aggregation_jobs import (
    scheduled_load_aggregation_job,
    event_driven_load_aggregation_job
)

scheduler = AsyncIOScheduler()

def setup_scheduler(app):
    """设置调度器并注册任务"""
    
    # ========== 定时任务 ==========
    
    # 方案1: 纯定时触发 (每天凌晨2点)
    # scheduler.add_job(
    #     scheduled_load_aggregation_job,
    #     'cron',
    #     hour=2,
    #     minute=0,
    #     id='web_scheduled_load_aggregation',
    #     replace_existing=True
    # )
    
    # ========== 事件驱动任务 ==========
    
    # 方案2: 事件驱动 (每5分钟检查 RPA 下载状态)
    scheduler.add_job(
        event_driven_load_aggregation_job,
        'interval',
        minutes=5,
        id='web_event_load_aggregation',
        replace_existing=True
    )
    
    # ========== 生命周期管理 ==========
    
    @app.on_event("startup")
    async def start_scheduler():
        scheduler.start()
        print("✅ APScheduler 已启动")
        print(f"📋 已注册 {len(scheduler.get_jobs())} 个定时任务")
    
    @app.on_event("shutdown")
    async def stop_scheduler():
        scheduler.shutdown()
        print("🛑 APScheduler 已停止")
```

---

## 五、手工触发 API

**文件**: `webapp/api/v1_task_management.py` (新增)

```python
from fastapi import APIRouter, Depends, HTTPException
from webapp.api.v1 import get_current_active_user
from webapp.scheduler.jobs.aggregation_jobs import _aggregate_all_customers
from webapp.scheduler.logger import TaskLogger
from datetime import datetime

router = APIRouter(prefix="/tasks", tags=["任务管理"])

@router.post("/load-aggregation/trigger")
async def trigger_load_aggregation(
    date: str = None,  # 可选,默认今天
    current_user = Depends(get_current_active_user)
):
    """
    手工触发负荷数据聚合任务
    
    Args:
        date: 日期 (YYYY-MM-DD),默认今天
    """
    task_id = None
    try:
        # 1. 确定日期
        if not date:
            date = datetime.now().strftime("%Y-%m-%d")
        
        # 2. 生成执行锁键
        execution_lock = f"load_aggregation:manual:{date}"
        
        # 3. 记录任务开始
        task_id = await TaskLogger.log_task_start(
            service_type="web",
            task_type="load_aggregation",
            task_name="负荷数据聚合 (手工触发)",
            trigger_type="manual",
            triggered_by=current_user.username,
            execution_lock=execution_lock
        )
        
        if not task_id:
            return {
                "success": False,
                "message": f"任务已在执行或今天已执行过 (日期: {date})"
            }
        
        # 4. 执行聚合
        result = await _aggregate_all_customers(date)
        
        # 5. 记录成功
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS",
            summary=f"成功聚合 {result['customers_processed']} 个客户的数据",
            details=result
        )
        
        return {
            "success": True,
            "task_id": task_id,
            "message": f"聚合完成,处理 {result['customers_processed']} 个客户",
            "details": result
        }
        
    except Exception as e:
        if task_id:
            await TaskLogger.log_task_end(
                task_id=task_id,
                status="FAILED",
                summary=f"聚合失败: {str(e)}",
                error={"message": str(e)}
            )
        
        raise HTTPException(status_code=500, detail=str(e))
```

**注册路由** (`webapp/main.py`):

```python
from webapp.api import v1_task_management

app.include_router(v1_task_management.router, prefix="/api/v1")
```

---

## 六、执行锁机制说明

### 6.1 锁键格式

```
{task_type}:{trigger_type}:{date}
```

**示例**:
- `load_aggregation:scheduled:2026-02-03` - 定时任务的锁
- `load_aggregation:event:2026-02-03` - 事件任务的锁
- `load_aggregation:manual:2026-02-03` - 手工任务的锁

### 6.2 锁的生命周期

1. **获取锁**: 任务开始时,写入 `execution_lock` 字段
2. **检查锁**: 查询是否存在 `RUNNING` 或 `SUCCESS` 状态的记录
3. **释放锁**: 任务结束时,更新 `lock_released_at` 字段

### 6.3 锁的作用

- ✅ **防止并发**: 同一任务不会同时执行多次
- ✅ **防止重复**: 同一天不会重复执行
- ✅ **支持重试**: 失败的任务可以重新执行 (状态为 FAILED)

---

## 七、总结

### 7.1 简化要点

1. ✅ **复用数据集**: 只扩展现有的 `task_execution_logs`,无需新建表
2. ✅ **最小改动**: 只新增 4 个字段支持执行锁和触发信息
3. ✅ **统一触发**: 通过 `trigger_type` 区分定时/事件/手工
4. ✅ **简单可靠**: 执行锁机制简单直接,无需复杂的锁表

### 7.2 实施步骤

1. **扩展 TaskLogger** (新增执行锁支持) - 1小时
2. **实现聚合任务** (定时 + 事件驱动) - 2小时
3. **添加手工触发 API** - 1小时
4. **测试验证** - 1小时
5. **总计**: 5小时

### 7.3 后续扩展

当需要添加新任务时,只需:
1. 在 `jobs/` 目录下创建新的任务文件
2. 使用 `TaskLogger` 记录日志
3. 在 `core.py` 中注册到调度器
4. (可选) 添加手工触发 API

**简单、实用、易于维护!** 🎉

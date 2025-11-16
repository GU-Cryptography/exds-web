# Gemini 项目背景: exds-web

## 项目概述

"电力交易辅助决策系统"是一个用于电力负荷数据可视化与分析的Web应用，旨在为用户提供直观、高效的电力负荷数据分析工具，并为未来扩展负荷预测、交易策略和电费结算等功能奠定基础。

项目采用前后端分离架构：
- **后端**: FastAPI (Python) + MongoDB
- **前端**: React (TypeScript) + Material-UI + Recharts

## 常用开发命令

### 后端 (FastAPI)

```bash
# 安装依赖
pip install -r webapp/requirements.txt

# 启动开发服务器
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8005

# API 交互式文档：http://127.0.0.1:8005/docs
```

### 前端 (React)

```bash
# 安装依赖
npm install --prefix frontend

# 启动开发服务器
npm start --prefix frontend

# 生产构建
npm run build --prefix frontend

# 运行测试
npm test --prefix frontend
```

前端开发服务器运行在 `http://localhost:3000`，已配置代理，所有 `/api` 请求会转发到后端 `http://127.0.0.1:8005`。

## 前端开发工作流
**重要**：不要主动启动前端服务器，如果检测到前端端口对应的服务没有启动，提示我手工启动。

**重要**：在进行前端开发任务时，应默认使用chrome-devtools进行调试，登录前端网站地址`http://localhost:3000`，以用户名`admin`和密码`!234qwer`登录，通过自动操作功能页面，获取浏览器网络请求和控制台消息，以便自主诊断编译错误：

## 代码架构
### 后端架构

- **入口文件**: `webapp/main.py`
  - 初始化 FastAPI 应用
  - 配置 JWT 认证（OAuth2 密码模式，30分钟过期）
  - 配置 CORS 中间件
  - 配置速率限制（登录 5次/分钟，其他 1000次/分钟）

- **API 路由**: `webapp/api/v1.py`
  - 包含所有业务接口（公开路由和受保护路由）
  - 公开路由：`public_router`（如 PDF 下载）
  - 受保护路由：`router`（需要 JWT 认证，依赖 `get_current_active_user`）

- **数据库访问**: `webapp/tools/mongo.py`
  - 提供全局 `DATABASE` 实例
  - 配置从 `~/.exds/config.ini` 或环境变量读取
  - **所有数据库操作必须通过 `webapp.tools.mongo.DATABASE` 进行**

- **数据库集合**:
  - `user_load_data` - 用户负荷数据
  - `day_ahead_spot_price` / `real_time_spot_price` - 日前/实时市场价格
  - `tou_rules` - 分时电价规则
  - `price_sgcc` - 国网代购电价数据（含 PDF 附件二进制数据）

### 前端架构

- **API 客户端**: `frontend/src/api/client.ts`
  - 预配置的 axios 实例，包含 JWT 令牌拦截器
  - **所有对后端的请求都必须通过此实例发出**
  - 请求拦截器：自动添加 `Authorization: Bearer {token}` 头
  - 响应拦截器：401 错误时自动清除 token 并跳转登录页

- **页面组件**:
  - `LoadAnalysisPage` - 负荷曲线与电量分析
  - `MarketPriceAnalysisPage` - 市场价格对比与时段分析
  - `GridAgencyPricePage` - 国网代购电价（含嵌入式 PDF 预览）
  - `LoginPage` - 用户登录

- **可复用 Hooks** (位于 `frontend/src/hooks/`):
  - `useChartFullscreen.tsx` - 图表横屏全屏功能
  - `useSelectableSeries.tsx` - 图表曲线交互式选择
  - `useTouPeriodBackground.tsx` - 图表时段背景色渲染

- **路由保护**:
  - `ProtectedRoute` 组件检查 localStorage 中的 JWT token
  - 未登录用户自动重定向到登录页

### 核心架构模式

1. **认证流程**:
   - 登录 → POST `/token` → 获取 JWT token
   - Token 存储在 localStorage
   - 所有受保护的 API 请求携带 `Authorization: Bearer {token}` 头
   - 401 响应触发自动登出和重定向

2. **数据库访问模式**:
   - 单例模式：全局共享 `DATABASE` 实例
   - 延迟连接：首次访问时才建立连接
   - 配置优先级：环境变量 > config.ini > 默认值

3. **API 设计模式**:
   - RESTful 风格
   - Pydantic 模型用于数据校验和序列化
   - 使用 MongoDB 聚合管道优化复杂查询
   - 公开/受保护路由分离

## 关键开发规范

### 1. 时序数据处理规范（前后端强制）

**核心原则**：为保证数据一致性，时序数据（负荷、价格等）的处理必须遵循严格的职责划分。

#### 后端职责 (强制)
1.  **存储格式**：所有时序数据**必须**采用"长/窄"格式存储，即每个时间点一条记录。
    ```python
    # 正确：每个时间点一条记录
    {
        "timestamp": datetime(2025, 11, 10, 0, 15, 0), # 本地时间
        "customer_id": "...",
        "value": 23.1
    }
    ```
2.  **24:00时刻处理**：业务日的第96个点（`24:00`）在数据库中**必须**存储为**次日的 `00:00:00`**。
3.  **查询区间**：查询一天的数据时，时间区间**必须**使用**左开右闭 `(start_of_day, end_of_day]`**，以正确包含第96个点并排除前一天的最后一个点。
    ```python
    query = {
        "timestamp": {
            "$gt": start_of_day,   # 大于
            "$lte": end_of_day     # 小于等于
        }
    }
    ```
4.  **API响应格式化**：API在返回给前端时，**必须**将时间戳格式化为业务时间标签，特别是将次日 `00:00:00` 转换为 `"24:00"`。
    ```json
    {
      "date": "2025-11-10",
      "data": [
        {"time": "00:15", "value": 23.1, "timestamp": "2025-11-10T00:15:00"},
        ...
        {"time": "24:00", "value": 22.8, "timestamp": "2025-11-11T00:00:00"}
      ]
    }
    ```

#### 前端职责 (强制)
1.  **直接消费**：前端**必须**直接使用后端返回的 `time` 字段作为图表的X轴标签。
2.  **禁止转换**：前端**严禁**对 `timestamp` 或 `time` 字段进行任何形式的计算或转换。所有时间相关的业务逻辑由后端统一处理。
    ```tsx
    // ✅ 正确：直接使用 time 字段
    <XAxis dataKey="time" />

    // ❌ 错误：在前端进行任何时间格式化或计算
    ```

### 2. Material-UI Grid 组件 v7 语法（前端强制）

**极其重要**：本项目使用 Material-UI v7，其 `Grid` 组件 API 与 v5 **不兼容**。

❌ **错误语法**（会导致编译错误）:
```jsx
<Grid item xs={12}>...</Grid>
<Grid xs={12}>...</Grid>
```

✅ **正确语法**（必须使用 `size` 属性）:
```jsx
<Grid container spacing={2}>
  <Grid size={{ xs: 12, md: 6 }}>
    {/* 内容 */}
  </Grid>
  <Grid size={{ xs: 12, md: 6 }}>
    {/* 内容 */}
  </Grid>
</Grid>
```

### 3. 图表横屏全屏功能（前端强制）

**强制要求**：所有 Recharts 图表在移动端**必须**支持"横屏最大化"功能。

**实现方式**：**必须**使用项目内置的可复用 Hook `useChartFullscreen`。

**位置**：`frontend/src/hooks/useChartFullscreen.tsx`

**使用示例**：
```jsx
const {
  isFullscreen,
  FullscreenEnterButton,
  FullscreenExitButton,
  FullscreenTitle,
  NavigationButtons
} = useChartFullscreen({
  chartRef,
  title: '图表标题',
  onPrevious: handlePrevious,  // 可选：上一个
  onNext: handleNext,          // 可选：下一个
});

return (
  <Box ref={chartRef} sx={{...}}>
    {/* 进入全屏按钮 */}
    <FullscreenEnterButton />
    {/* 退出全屏按钮 */}
    <FullscreenExitButton />
    {/* 全屏标题 */}
    <FullscreenTitle />
    {/* 导航按钮（上一个/下一个） */}
    <NavigationButtons />

    {/* 图表内容 */}
    <ResponsiveContainer>
      {/* Recharts 图表组件 */}
    </ResponsiveContainer>
  </Box>
);
```

---

## 后端开发规范

### 1. 数据模型设计规范 (Pydantic)

#### 1.1 模型分层模式（强制）
所有实体必须定义 `Create`, `Update`, `Full`, `ListItem`, `ListResponse` 五种模型，以实现清晰的数据流转和校验。

-   **Create Model**: 仅包含创建时必需的字段。
-   **Update Model**: 所有字段均为 `Optional`，用于部分更新。
-   **Full Model**: 对应数据库的完整结构，包含 `id` 和时间戳。
-   **ListItem Model**: 用于列表展示的轻量化模型，不含复杂嵌套数据。
-   **ListResponse Model**: 标准的分页响应结构，包含 `total`, `page`, `items` 等。

#### 1.2 字段命名约定（强制）
-   **主键**: `id: PyObjectId = Field(..., alias="_id")`
-   **时间戳**: `created_at`, `updated_at` (使用 `datetime.now()` 获取本地时间)
-   **操作人**: `created_by`, `updated_by`
-   **状态**: `status: Literal[...]`
-   **布尔值**: `is_{condition}` 或 `has_{item}`
-   **外键**: `{entity}_id`
-   **列表**: 复数形式 (e.g., `utility_accounts`)

### 2. Service 层开发规范

-   **统一结构**: Service 类必须包含 `__init__(self, db: Database)` 和 `_ensure_indexes()` 方法。
-   **标准方法命名**: CRUD 操作必须使用 `create`, `get_by_id`, `list`, `update`, `delete`。
-   **记录操作人**: 所有修改操作（`create`, `update`）必须接受 `operator: str` 参数。
-   **错误处理**: 业务逻辑错误应 `raise ValueError`，由 API 层捕获并转换为 `HTTPException`。

### 3. API 路由开发规范

-   **RESTful 设计**: 遵循标准的 RESTful 路由设计（`GET /items`, `POST /items`, `GET /items/{id}` 等）。
-   **HTTP 状态码**:
    -   `200 OK`: GET, PUT, PATCH 成功
    -   `201 Created`: POST 成功
    -   `204 No Content`: DELETE 成功 (必须 `return None`)
    -   `400 Bad Request`: 业务逻辑错误
    -   `404 Not Found`: 资源不存在
    -   `409 Conflict`: 资源冲突（如名称重复）
-   **API 文档**: 所有端点必须提供 `summary` 和参数的 `description`。

### 4. 错误处理与日志

-   **使用 `logging`**: 禁止使用 `print` 进行日志输出。
-   **记录异常**: 记录 ERROR 级别日志时，使用 `logger.exception()` 或 `exc_info=True` 来包含完整的堆栈跟踪。
-   **精确捕获**: 避免使用宽泛的 `except Exception:`，应捕获具体的异常类型。

---

## 前端开发规范

### 1. 页面与组件设计

-   **页面结构**: 标准页面应包含 `Typography` 标题和 `Paper` 主内容区。
-   **布局模式**: 优先使用 **Tab式导航** (`LoadAnalysisPage`)，对于概览页可使用 **仪表板式布局** (`MarketDashboardTab`)。
-   **Loading状态管理**:
    -   **区分首次加载和刷新**：首次加载（`loading && !data`）可显示占位符，数据刷新时（`loading && data`）**必须**使用覆盖层，**严禁**卸载组件，以保证图表全屏等状态不丢失。
    -   **禁用交互**：在 `loading` 状态下，必须禁用日期切换、分页等数据触发控件。

### 2. 响应式设计规范

-   **移动端优先**: 所有页面和组件必须采用移动端优先的响应式设计。
-   **标准断点**:
    -   **间距/内边距**: `spacing={{ xs: 1, sm: 2 }}`, `p={{ xs: 1, sm: 2 }}`
    -   **Grid布局**: `size={{ xs: 12, md: 6 }}` (移动端全宽，桌面端半宽)
    -   **图表高度**: `height={{ xs: 350, sm: 400 }}`
-   **表格响应式**:
    -   容器添加 `overflowX: 'auto'` 以支持横向滚动。
    -   减小移动端字体和内边距: `fontSize: { xs: '0.75rem', sm: '0.875rem' }`, `px: { xs: 0.5, sm: 2 }`
-   **移动端交互模式**:
    -   **数据列表**: 使用 `MobileDataCard` 组件展示。
    -   **数据编辑**: 桌面端使用 **对话框(Dialog)**，移动端使用 **独立页面**。
    -   **筛选**: 移动端的筛选条件必须包裹在 `Collapse` 组件中，可折叠。

### 3. 日期选择器规范

-   **统一实现**: 必须使用 `LocalizationProvider` 包裹，并集成 `ArrowLeft`/`ArrowRight` 按钮用于快速切换日期。
-   **自动加载**: **必须**通过 `useEffect` 监听日期变化来自动加载数据，**禁止**添加额外的“查询”按钮。
-   **响应式宽度**: `DatePicker` 的宽度应设为 `{ xs: '150px', sm: '200px' }`，确保移动端单行显示。

### 4. 状态芯片 (Chip) 规范

-   **统一颜色**: 必须遵循统一的状态颜色映射。
    -   `success`: 成功 / 生效 / 执行中
    -   `warning`: 草稿 / 待处理 / 暂停
    -   `default`: 终止 / 归档 / 过期
    -   `error`: 错误 / 失败
    -   `info`: 意向 / 信息
-   **统一尺寸**: 使用 `size="small"`。

### 5. API 调用与代理

-   **统一客户端**: 所有请求必须通过 `src/api/client.ts` 发出。
-   **代理配置**: **必须**使用 `package.json` 中的 `"proxy": "http://127.0.0.1:8005"` 配置。**禁止**使用 `setupProxy.js` 或设置 `REACT_APP_API_BASE_URL` 环境变量。

## 未来技术优化建议

以下是为提升项目可维护性和开发效率的建议，可在未来的迭代中考虑引入：

-   **前端状态管理**：考虑使用 **Zustand** 来管理全局状态（如用户信息），以简化逻辑、提升性能
-   **前端数据请求**：考虑使用 **TanStack Query** (原 React Query) 来替代手动的 `useEffect` + `axios` 模式，以自动化管理数据缓存、加载和错误状态

## 项目要求

**一律用中文简体回复**：在此项目中，所有交互、代码注释、文档等都应使用中文简体。

## 自动化后端服务器管理 (Automated Backend Server Management)

为了提高调试效率，我将采用以下自动化流程来管理后端 `uvicorn` 服务器：

1.  **启动服务器**:
    - 我将使用 PowerShell 的 `Start-Process` 命令在后台启动 `uvicorn` 服务器。
    - 命令示例: `Start-Process uvicorn -ArgumentList "webapp.main:app", "--reload", "--host", "0.0.0.0", "--port", "8005" -NoNewWindow -RedirectStandardOutput "C:\Users\xuhaijiang\.gemini\tmp\7f1bc3401077307e41e002859275ccf929dae9a2d96f3dc5a5c3f0d678714db4/uvicorn.out.log" -RedirectStandardError "C:\Users\xuhaijiang\.gemini\tmp\7f1bc3401077307e41e002859275ccf929dae9a2d96f3dc5a5c3f0d678714db4/uvicorn.err.log"`
    - 所有后端日志（标准输出和错误）将被重定向到 `C:\Users\xuhaijiang\.gemini\tmp\7f1bc3401077307e41e002859275ccf929dae9a2d96f3dc5a5c3f0d678714db4/` 目录下的 `uvicorn.out.log` 和 `uvicorn.err.log` 文件。

2.  **监控日志**:
    - 当需要检查后端状态时，我将读取 `uvicorn.err.log` 文件来自动诊断启动或运行时的错误。

3.  **重启服务器**:
    - 当需要重启时，我将执行以下步骤：
        a. 使用 `netstat -aon | findstr ":8005"` 命令查找正在监听 `8005` 端口的进程PID。
        b. 使用 `taskkill /F /PID <PID>` 命令终止该进程。
        c. 重新执行第1步中的启动命令。

此流程将减少手动操作，并能更快地定位后端问题。
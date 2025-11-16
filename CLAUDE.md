# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

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

**重要**：

修改前端代码后，通过运行构建指令`npm run build --prefix frontend`，检查是否有编译错误，并自动修复。

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

### 1. Material-UI Grid 组件语法（v7 版本）

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

### 2. 图表横屏全屏功能

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

### 3. 图表曲线选择功能

**强制要求**：对于需要用户交互式选择显示/隐藏图表曲线的场景，**必须**使用项目内置的可复用 Hook `useSelectableSeries`。

**位置**：`frontend/src/hooks/useSelectableSeries.tsx`

**使用方法**：参考 `docs/技术方案与编码规范.md` 中 `3.8.2. useSelectableSeries` 的详细说明（如果存在）。

### 3.5. Loading 状态管理规范（重要）

**问题背景**：
在使用 `useChartFullscreen` Hook 实现图表全屏功能时，如果在 loading 状态变化时卸载图表组件，会导致全屏状态丢失。这是因为全屏 API 绑定在 DOM 元素上，组件卸载后全屏状态会自动退出。

**核心原则**：**避免在数据加载时卸载包含全屏功能的组件**

**错误示例** ❌：
```tsx
// 错误：loading 时卸载整个组件
if (loading) {
    return <CircularProgress />;
}

return (
    <Box ref={chartRef}>
        <FullscreenEnterButton />
        <ResponsiveContainer>
            <LineChart data={data} />
        </ResponsiveContainer>
    </Box>
);
```

**正确示例** ✅：
```tsx
// 正确：区分首次加载和数据刷新
return (
    <Box>
        {/* 首次加载（无数据时）：显示完整 loading */}
        {loading && !data ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        ) : error ? (
            <Alert severity="error">{error}</Alert>
        ) : data ? (
            <Box sx={{ position: 'relative' }}>
                {/* 数据刷新时的覆盖层（不卸载组件） */}
                {loading && (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            zIndex: 1000
                        }}
                    >
                        <CircularProgress />
                    </Box>
                )}

                {/* 图表组件 - 在 loading 时不会被卸载 */}
                <Box ref={chartRef}>
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <ResponsiveContainer>
                        <LineChart data={data} />
                    </ResponsiveContainer>
                </Box>
            </Box>
        ) : null}
    </Box>
);
```

**配套措施**：
```tsx
// 禁用导航控件，防止 loading 时重复触发
<IconButton onClick={handlePrevious} disabled={loading}>
    <ArrowLeftIcon />
</IconButton>

<DatePicker
    value={selectedDate}
    onChange={setSelectedDate}
    disabled={loading}
/>

<IconButton onClick={handleNext} disabled={loading}>
    <ArrowRightIcon />
</IconButton>
```

**开发检查清单**：
- [ ] 区分首次加载（`loading && !data`）和数据刷新（`loading && data`）
- [ ] 数据刷新时使用覆盖层而不是卸载组件
- [ ] Loading 时禁用导航按钮和日期选择器
- [ ] 覆盖层的 `zIndex` 低于全屏按钮（1000 < 1400）
- [ ] 测试全屏状态下切换日期不会退出全屏

### 4. 移动端响应式设计规范

**强制要求**：
- 所有页面和组件**必须**采用移动端优先的响应式设计
- 优先使用 Material-UI 的栅格系统（`Grid`）和断点（`sx` 属性）实现响应式布局
- 在开发新的图表功能或交互时，**必须**首先检查 `frontend/src/hooks/` 目录下是否存在已有的可复用 Hook
- 避免重复造轮子，优先使用现有 Hook

#### 4.1 标准响应式断点

Material-UI 提供的标准断点：

| 断点 | 屏幕宽度 | 设备类型 |
|------|---------|---------|
| `xs` | 0px+ | 手机（竖屏） |
| `sm` | 600px+ | 手机（横屏）、小平板 |
| `md` | 900px+ | 平板 |
| `lg` | 1200px+ | 桌面 |
| `xl` | 1536px+ | 大屏桌面 |

#### 4.2 日期选择器规范

**统一标准**（参考：MarketDashboardTab、DayAheadAnalysisTab、RealTimeAnalysisTab、SpreadAnalysisTab）

```tsx
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { addDays } from 'date-fns';

// 1. 状态管理
const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), -1));

// 2. 自动加载数据（监听日期变化）
useEffect(() => {
    fetchData(selectedDate);
}, [selectedDate]);

// 3. 日期导航
const handleShiftDate = (days: number) => {
    if (!selectedDate) return;
    const newDate = addDays(selectedDate, days);
    setSelectedDate(newDate);  // useEffect 会自动触发 fetchData
};

// 4. UI 渲染（必须用 LocalizationProvider 包裹整个组件）
return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
        <Box>
            <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <IconButton onClick={() => handleShiftDate(-1)}>
                    <ArrowLeftIcon />
                </IconButton>

                <DatePicker
                    label="选择日期"
                    value={selectedDate}
                    onChange={(date) => setSelectedDate(date)}
                    slotProps={{
                        textField: {
                            sx: { width: { xs: '150px', sm: '200px' } }  // 响应式宽度
                        }
                    }}
                />

                <IconButton onClick={() => handleShiftDate(1)}>
                    <ArrowRightIcon />
                </IconButton>
            </Paper>

            {/* 其他内容 */}
        </Box>
    </LocalizationProvider>
);
```

**关键要点**：
- ✅ 日期框宽度：`xs: 150px`, `sm: 200px`（确保手机端单行显示）
- ✅ 使用 `ArrowLeft`/`ArrowRight` 图标（不使用 `ArrowBackIosNew`/`ArrowForwardIos`）
- ✅ 自动加载：监听 `selectedDate` 变化，**无需查询按钮**
- ✅ Paper 容器：`p: 2, gap: 1, flexWrap: 'wrap'`
- ✅ LocalizationProvider 包裹整个组件返回内容

#### 4.3 图表容器规范

**统一的图表高度设置**（参考：所有已优化的 Tab 组件）

```tsx
<Box
    ref={chartRef}
    sx={{
        height: { xs: 350, sm: 400 },  // 移动端 350px，桌面端 400px
        position: 'relative',
        backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
        p: isFullscreen ? 2 : 0,
        ...(isFullscreen && {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 1400
        })
    }}
>
    <ResponsiveContainer width="100%" height="100%">
        {/* Recharts 图表 */}
    </ResponsiveContainer>
</Box>
```

**关键要点**：
- ✅ 响应式高度：移动端 350px，桌面端 400px
- ✅ 使用 `ResponsiveContainer` 确保图表自适应
- ✅ 全屏状态样式：固定定位 + 全屏尺寸 + 高 z-index

#### 4.4 Grid 布局规范

**响应式间距**（参考：MarketDashboardTab、SpreadAnalysisTab）

```tsx
<Grid container spacing={{ xs: 1, sm: 2 }}>
    <Grid size={{ xs: 12, md: 6 }}>
        {/* 移动端全宽，桌面端半宽 */}
    </Grid>
    <Grid size={{ xs: 12, md: 6 }}>
        {/* 移动端全宽，桌面端半宽 */}
    </Grid>
    <Grid size={{ xs: 12 }}>
        {/* 始终全宽 */}
    </Grid>
</Grid>
```

**关键要点**：
- ✅ 间距响应式：`spacing={{ xs: 1, sm: 2 }}`（移动端减小间距）
- ✅ 使用 `size` 属性而非 `xs`/`md` 属性（Grid v7 语法）
- ✅ 常见布局：`xs: 12`（移动端全宽）+ `md: 6`（桌面端两列）

#### 4.5 表格响应式规范

**移动端表格优化**（参考：MarketDashboardTab、SpreadAnalysisTab）

```tsx
<TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
    <Table
        sx={{
            '& .MuiTableCell-root': {
                fontSize: { xs: '0.75rem', sm: '0.875rem' },  // 响应式字体
                px: { xs: 0.5, sm: 2 },  // 响应式内边距
            }
        }}
    >
        {/* 表格内容 */}
    </Table>
</TableContainer>
```

**关键要点**：
- ✅ 添加 `overflowX: 'auto'` 确保横向滚动
- ✅ 字体大小：`xs: 0.75rem`, `sm: 0.875rem`
- ✅ 内边距：`xs: 0.5`, `sm: 2`
- ✅ 移动端减小字体和内边距以节省空间

#### 4.6 Paper 容器响应式规范

```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    {/* 内容 */}
</Paper>
```

**关键要点**：
- ✅ 内边距响应式：`p: { xs: 1, sm: 2 }`
- ✅ 移动端减小内边距以节省空间

#### 4.7 响应式开发检查清单

开发完成后，使用以下检查清单进行自检：

**日期选择器**
- [ ] 日期框宽度为 `{ xs: '150px', sm: '200px' }`
- [ ] 使用 `ArrowLeft`/`ArrowRight` 图标
- [ ] 实现自动加载（监听 `selectedDate` 变化）
- [ ] Paper 容器使用 `p: 2, gap: 1, flexWrap: 'wrap'`
- [ ] LocalizationProvider 包裹整个组件
- [ ] Loading 时禁用导航按钮和日期选择器（`disabled={loading}`）

**图表容器**
- [ ] 图表高度为 `{ xs: 350, sm: 400 }`
- [ ] 使用 `useChartFullscreen` Hook
- [ ] 使用 `ResponsiveContainer`

**Loading 状态管理（关键）**
- [ ] 区分首次加载（`loading && !data`）和数据刷新（`loading && data`）
- [ ] 数据刷新时使用覆盖层而不是卸载组件
- [ ] Loading 时禁用导航按钮和日期选择器
- [ ] 覆盖层的 `zIndex` 为 1000（低于全屏按钮的 1400）
- [ ] **测试全屏状态下切换日期不会退出全屏**

**Grid 布局**
- [ ] 间距使用 `spacing={{ xs: 1, sm: 2 }}`
- [ ] 使用 `size` 属性（Grid v7 语法）
- [ ] 移动端优先（`xs: 12` 全宽）

**表格**
- [ ] TableContainer 设置 `overflowX: 'auto'`
- [ ] 字体大小：`{ xs: '0.75rem', sm: '0.875rem' }`
- [ ] 内边距：`{ xs: 0.5, sm: 2 }`

**测试设备**
- [ ] iPhone SE (375px 宽)
- [ ] iPhone 12/13 (390px 宽)
- [ ] Galaxy S8 (360px 宽)
- [ ] 桌面端 (1200px+ 宽)

---

### 5. Tab 组件开发模板

当开发新的 Tab 组件时，请参考以下模板以确保符合所有规范：

**位置**：`docs/TabComponentTemplate.tsx`（如果存在）

**核心结构**：
```tsx
import React, { useState, useEffect, useRef } from 'react';
import { Box, CircularProgress, Typography, Paper, IconButton, Grid, Alert } from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { format, addDays } from 'date-fns';
import { ResponsiveContainer } from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
// 根据需要导入其他 Hooks

export const MyNewTab: React.FC = () => {
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), -1));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any[]>([]);

    const chartRef = useRef<HTMLDivElement>(null);
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // 全屏 Hook
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons } =
        useChartFullscreen({
            chartRef,
            title: `标题 (${dateStr})`,
            onPrevious: () => handleShiftDate(-1),
            onNext: () => handleShiftDate(1)
        });

    // 数据加载
    const fetchData = (date: Date | null) => {
        if (!date) return;
        setLoading(true);
        setError(null);
        const formattedDate = format(date, 'yyyy-MM-dd');
        apiClient.get(`/api/v1/your-endpoint?date=${formattedDate}`)
            .then(response => setData(response.data))
            .catch(error => {
                console.error('Error:', error);
                setError(error.response?.data?.detail || error.message || '加载数据失败');
                setData([]);
            })
            .finally(() => setLoading(false));
    };

    // 自动加载
    useEffect(() => {
        fetchData(selectedDate);
    }, [selectedDate]);

    // 日期导航
    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                {/* 日期选择器 */}
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}><ArrowLeftIcon /></IconButton>
                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        slotProps={{ textField: { sx: { width: { xs: '150px', sm: '200px' } } } }}
                    />
                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}><ArrowRightIcon /></IconButton>
                </Paper>

                {/* 首次加载显示完整的 loading */}
                {loading && !data ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
                ) : data ? (
                    <Box sx={{ position: 'relative' }}>
                        {/* 数据加载时的覆盖层（不卸载组件） */}
                        {loading && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                    zIndex: 1000
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}

                        {/* 图表容器 */}
                        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                            <Typography variant="h6" gutterBottom>图表标题</Typography>
                            <Box
                                ref={chartRef}
                                sx={{
                                    height: { xs: 350, sm: 400 },
                                    position: 'relative',
                                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                                    p: isFullscreen ? 2 : 0,
                                    ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                                }}
                            >
                                <FullscreenEnterButton />
                                <FullscreenExitButton />
                                <FullscreenTitle />
                                <NavigationButtons />

                                {!data || data.length === 0 ? (
                                    <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                                        <Typography>无数据</Typography>
                                    </Box>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        {/* Recharts 图表 */}
                                    </ResponsiveContainer>
                                )}
                            </Box>
                        </Paper>
                    </Box>
                ) : null}
            </Box>
        </LocalizationProvider>
    );
};
```

**模板关键改进**：
- ✅ 区分首次加载（`loading && !data`）和数据刷新（`loading && data`）
- ✅ 数据刷新时使用覆盖层，不卸载图表组件，保持全屏状态
- ✅ Loading 时禁用导航按钮和日期选择器
- ✅ 覆盖层 zIndex=1000 低于全屏按钮 zIndex=1400
- ✅ 添加 error 状态处理



## 后端开发规范

### 📋 后端开发规范（强制）

**极其重要**：所有后端开发**必须**严格遵循《后端开发规范》。

**规范文档位置**：`docs/spec/后端开发规范.md`

**强制要求**：
- 在开发任何新功能或修改现有功能前，**必须**先完整阅读该规范文档
- 所有后端代码必须遵循规范中定义的：
  - 数据模型设计（模型分层、字段命名、枚举类型）
  - Service 层开发（CRUD 方法、索引管理）
  - 时序数据存储与处理（Long Format、24:00 处理、数据格式化）
  - API 路由设计（RESTful 标准、HTTP 状态码、API 文档）
  - 错误处理与日志记录
  - 数据库操作最佳实践
- 使用规范文档的"开发检查清单"进行自检

**核心规范要点**：
- **类型提示**：所有新代码**必须**添加明确的 Python 类型提示
- **代码风格**：遵循 PEP 8 规范，推荐使用 `Black` 或 `Ruff` 进行格式化
- **命名约定**：变量和函数使用 `snake_case`，类名使用 `PascalCase`
- **时区统一**：所有时间字段使用**本地时间**（`datetime.now()`），项目统一使用本地时间
- **时序数据存储**：必须使用**长/窄表格式**（Long Format），每个时间点作为独立记录
- **24:00 处理**：业务日的第96个点（24:00）存储为次日 00:00，查询使用左开右闭区间
- **数据格式化**：后端负责将时间戳格式化为业务时间标签（如"00:15", "24:00"）
- **API 设计**：遵循 RESTful 原则，使用 Pydantic 模型进行数据校验和序列化
- **错误处理**：Service 层抛出 `ValueError`，API 层转换为 `HTTPException`
- **日志记录**：使用 `logging` 而非 `print`，记录 ERROR 时使用 `exc_info=True`
- **数据库访问**：所有数据库操作应通过 `webapp.tools.mongo.DATABASE` 全局实例进行
- **索引管理**：所有 Service 类必须实现 `_ensure_indexes()` 方法

## 前端开发规范

### 📋 前端开发规范（强制）

**极其重要**：所有前端开发**必须**严格遵循《前端开发规范》。

**规范文档位置**：`docs/spec/前端开发规范.md`

**强制要求**：
- 在开发任何新页面或修改现有页面前，**必须**先完整阅读该规范文档
- 所有前端代码必须遵循规范中定义的：
  - 页面结构（外层容器、页面标题、Paper 组件样式）
  - 组件开发（Material-UI Grid v7 语法、状态管理、Loading 状态）
  - 图表组件（全屏功能、曲线选择）
  - 响应式设计（断点使用、日期选择器、图表容器、Grid 布局）
  - 时序数据处理（直接消费后端格式化的时间标签，禁止前端时间转换）
  - 移动端专用组件（MobileDataCard、筛选折叠）
  - 表单开发（原生 State 管理、嵌套数据）
  - API 调用（统一使用 apiClient、错误处理、分页数据）
- 使用规范文档的"开发检查清单"进行自检

**参考示例页面**：
- `LoadAnalysisPage` - Tab 式导航布局标准
- `MarketPriceAnalysisPage` - Tab 式导航布局标准
- `GridAgencyPricePage` - 仪表板式布局标准
- `MarketDashboardTab` - 图表全屏 + Loading 状态管理标准
- `CustomerManagementPage` - 响应式路由 + 分页标准

---

### 通用开发规范

- **代码风格**：推荐使用 `Prettier` 进行自动代码格式化
- **命名约定**：组件（及文件名）使用 `PascalCase`，变量和函数使用 `camelCase`
- **组件开发**：优先使用函数式组件和 Hooks，并保持组件的单一职责原则
- **时序数据消费**：**必须**直接使用后端返回的 `time` 字段，**禁止**进行时间转换
- **API 通信**：所有对后端的请求都应通过 `src/api/client.ts` 中预配置的 axios 实例发出
- **可复用 Hook 原则**：
  - 开发新功能前，**必须**先检查 `frontend/src/hooks/` 目录
  - 优先使用现有 Hook，避免重复实现
  - 如果现有 Hook 无法满足需求且功能具有通用性，应封装为新的可复用 Hook

## 未来技术优化建议

以下是为提升项目可维护性和开发效率的建议，可在未来的迭代中考虑引入：

- **前端状态管理**：考虑使用 **Zustand** 来管理全局状态（如用户信息），以简化逻辑、提升性能
- **前端数据请求**：考虑使用 **TanStack Query** (原 React Query) 来替代手动的 `useEffect` + `axios` 模式，以自动化管理数据缓存、加载和错误状态

## 项目要求

**一律用中文简体回复**：在此项目中，所有交互、代码注释、文档等都应使用中文简体。

## AI 编程工作规范

### 核心原则

1. **不明白就问，别瞎猜、别装懂、别硬上**
   - 对需求、上下文、调用链有任何不确定时，必须先提问澄清
   - 信息不足时，明确告知："信息不够，我只能给出尝试性修改，成功率不高"

2. **最小改动原则（Minimal Diff）**
   - 不要大面积重写，不要随便重构
   - 只改和问题强相关的代码行
   - 除非明确要求"可以重构"，否则不要改动整体结构

3. **诚实原则**
   - 不要为了显得聪明而给出拍脑袋的答案
   - 有不确定就说不确定，不要用"这一定没问题"等话术
   - 用"根据现有信息，这是我认为最可能有效的修改"代替绝对化表述

### 工作流程

#### 1. 接到任务时（不要急着改代码）

- 用 1～3 句话复述：理解的【目标】和当前【问题】
- 如果缺少报错信息、调用栈、相关文件，主动要求提供
- 信息明显不足时，明确告知风险

#### 2. 分析问题时

- 先阅读报错信息和相关代码，不要直接改
- 列出 1～3 个可能的根本原因，每个原因对应的代码位置
- 先给"分析 + 可能原因"，不要一下子给大段修改后的代码

#### 3. 准备修改前：方案 + 风险评估

**必须给出以下内容**：
- 打算改哪里（文件/函数/代码片段）
- 改动思路是什么
- **优点**：为什么这样改
- **风险**：可能引入什么副作用
- **成功率评估**（用文字）：
  - "大概率能一次修好"
  - "有一定风险，需要你一起看一下"
  - "成功率不高，只能当尝试"

**如果成功率不高，必须停下来提醒用户，让用户介入一起分析。**

#### 4. 修改代码时

- **最小变更原则**：
  - 只改和 bug 强相关的行
  - 不要随便改函数签名、数据结构和全局逻辑
  - 不要重构整体结构，不要大面积重写文件

- **清晰说明**：
  - 用清晰的 diff 风格或标注，告诉用户"改了哪些地方、每一处为什么要改"
  - 不要默默改一堆地方不说明原因

#### 5. 需要用户介入的时机

**出现以下情况之一，必须停下来请用户一起分析**：
- 报错信息指向多个模块，无法判断主因
- 需要大面积改动、重构、改协议、改数据结构
- 对修改后的行为也拿不准

**明确提示**："这里已经超出我能稳妥一次改对的范围，需要你介入一起判断。"
然后给出目前的分析结论和备选方向，让用户来拍板。

#### 6. 修改完成后

- 简要总结：改了哪里？为什么这么改？
- 建议跑哪些测试/场景来验证
- 如果还有潜在隐患，也要一并说出来，不要假装"完美解决"

### 目标定位

**你的目标不是"看起来很聪明"，而是"让用户少掉头发、少内耗"。**

宁可慢一点、啰嗦一点，也不要乱改；
宁可说"我不确定，需要你一起分析"，也不要假装有把握。

---

## 开发环境启动指南 (Development Server Startup Guide)

### 推荐方式：同时输出到终端和日志文件

#### 后端服务器启动 (FastAPI + Uvicorn)

```bash
# 推荐方式：同时输出到终端和日志文件
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8005 2>&1 | tee tmp/uvicorn.log

# Windows PowerShell 方式
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8005 | Tee-Object -FilePath "tmp/uvicorn.log"

# 传统方式（仅后台运行，无终端输出）
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8005 > tmp/uvicorn.out.log 2> tmp/uvicorn.err.log &
```

**说明：**
- `2>&1 | tee tmp/uvicorn.log` 将标准输出和错误同时重定向到终端和日志文件
- `tee` 命令确保你既能实时看到日志，又能保存到文件便于排查问题
- API 交互式文档：http://127.0.0.1:8005/docs
- 测试用户: `test` / `!234qwer` 使用测试账号获取TOKEN

#### 前端开发服务器启动 (React + TypeScript)

```bash
# 推荐方式：同时输出到终端和日志文件
npm start --prefix frontend 2>&1 | tee tmp/frontend.log

# 或者先进入frontend目录
cd frontend
npm start 2>&1 | tee ../tmp/frontend.log

# Windows PowerShell 方式
npm start --prefix frontend | Tee-Object -FilePath "tmp/frontend.log"
```

**说明：**
- 前端开发服务器运行在 `http://localhost:3000`
- 已配置代理，所有 `/api` 请求会转发到后端 `http://127.0.0.1:8005`
- React热重载功能会自动更新页面

### 服务器管理命令

#### 查看端口占用情况
```bash
# Windows
netstat -aon | findstr ":8005"  # 查看后端端口
netstat -aon | findstr ":3000"  # 查看前端端口

# Linux/Mac
lsof -i :8005  # 查看后端端口
lsof -i :3000  # 查看前端端口
```

#### 终止进程
```bash
# Windows
taskkill /F /PID <进程ID>

# Linux/Mac
kill -9 <进程ID>
```

### 日志文件位置
- 后端日志：`tmp/uvicorn.log`
- 前端日志：`tmp/frontend.log`
- 错误日志：`tmp/uvicorn.err.log`（传统方式）

### 临时日志目录
确保项目根目录下存在 `tmp` 目录：
```bash
mkdir tmp
```

**推荐使用同时输出到终端和日志文件的方式**，这样既能实时监控服务器状态，又能保存完整的日志信息用于问题排查。
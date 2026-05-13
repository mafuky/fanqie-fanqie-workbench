# 前端全面优化设计文档

## 概述

对 fanqie-workbench 前端进行重写式优化：先建自建轻量组件库，再用新组件重写所有页面，同时补全书籍管理页功能。保持零外部 UI 依赖。

## 约束

- 不引入外部 UI 库，自建轻量组件
- 保持现有暗色/浅色主题切换，所有组件跟随 CSS 变量
- 仅涉及前端（`src/web/`），不改后端
- 书籍管理页后端 API 目前只返回空数组，前端先按接口契约实现，后端补全由其他人负责

## 1. 设计 Token 系统

在 `src/web/styles/tokens.ts` 中定义设计常量，供所有组件引用：

```
spacing: 4, 8, 12, 16, 20, 24, 32, 40
radius: sm(6), md(8), lg(12)
fontSize: xs(11), sm(12), md(13), lg(15), xl(18), xxl(22)
fontWeight: normal(400), medium(500), semibold(600), bold(700)
transition: fast('0.1s ease'), normal('0.15s ease'), slow('0.25s ease')
```

暗色/浅色主题变量保留在 `app.tsx` 的 `darkVars` / `lightVars` 中，token 系统引用这些变量名（如 `var(--bg-primary)`），不硬编码颜色值。

## 2. 基础组件库

在 `src/web/components/ui/` 下建立 10 个基础组件：

### Button
- 变体：`primary` | `secondary` | `ghost` | `danger`
- Props：`loading`, `disabled`, `icon`, `size`（`sm` | `md`）
- 主题跟随：background/color 全部用 CSS 变量

### Card
- 统一容器：`background: var(--bg-secondary)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-lg)`
- Props：`padding`（默认 20px）

### Input / Textarea
- 统一输入框，focus 时 border 变 accent 色
- Props：`label`, `placeholder`, `error`, `rows`（Textarea）
- 支持 `onFocus`/`onBlur` 自动切换边框色

### Badge
- 预设色：`success`(绿) | `warning`(橙) | `error`(红) | `info`(蓝) | `neutral`(灰)
- 替代 `ChapterStageBadge` 的硬编码颜色映射
- 阶段到 Badge 变体的映射表放在书籍页，不放在组件里

### Table
- Props：`columns: { key, label, width? }[]`, `data: Record<string, any>[]`, `renderCell?: (row, col) => ReactNode`
- 内置表头样式（大写、letter-spacing）、行 hover、边框
- 空数据时显示 EmptyState

### EmptyState
- Props：`icon`（字符串）, `title`, `description`, `action?: { label, onClick }`
- 居中布局

### Toast
- 全局 Context + Provider 模式
- 类型：`success` | `error` | `info`
- 自动 3 秒消失，右上角固定定位
- `useToast()` hook 返回 `toast.success(msg)` / `toast.error(msg)`

### Modal
- Props：`open`, `onClose`, `title`, `children`, `footer?`
- 背景蒙层 + 居中弹窗
- `Confirm` 为 Modal 的快捷封装：`title` + `description` + 确认/取消按钮
- 确认按钮支持 `danger` 变体

### Spinner
- CSS-only 旋转动画
- `size` prop：`sm`(16px) | `md`(24px) | `lg`(32px)
- 颜色跟随 `var(--accent)`

### PageHeader
- Props：`title`, `description`, `actions?: ReactNode`
- 统一页面标题 + 描述 + 右侧操作区布局

## 3. 页面重写

### 3.1 App Shell（app.tsx）

保持不变的：
- 侧边栏导航结构
- TomatoLogo SVG
- 暗色/浅色主题切换
- 页面路由（useState 切换）

改动：
- ThemeToggle 用 Button(ghost) 替代手写 button
- 导航项用统一样式函数
- 添加 ToastProvider 包裹

### 3.2 执行任务页（prompt-page.tsx）

- 用 PageHeader 替代手写标题
- 用 Card 包裹提示词区域
- 用 Textarea 组件替代手写 textarea
- 用 Button(primary) 替代手写按钮
- 执行成功/失败改为 Toast 通知（移除内联 Badge）
- 日志面板增加运行时间显示（`运行中 · 12s`）
- LiveLogPanel 内部保持 SSE 逻辑不变，样式用 CSS 变量

### 3.3 书籍管理页（books-page.tsx）— 新功能

**数据获取：**
- `GET /api/books` → 书籍列表
- `GET /api/books/:bookId` → 章节列表
- `POST /api/books/scan` → 触发扫描（调用 syncWorkspaceBooks）

**布局：**
- PageHeader + 右侧「扫描 novels/ 目录」Button(primary) + 「刷新」Button(secondary)
- 统计栏：总书籍 / 总章节 / 已发布 / 待处理（4 个小卡片横排）
- 书籍卡片列表（可展开/折叠）：
  - 折叠态：书名 + 路径 + 章节数 + 已发布/待处理 Badge
  - 展开态：
    - 阶段筛选标签栏（全部 / 待写作 / 已初稿 / ... / 已发布），点击筛选
    - 章节行：序号 + 标题 + 阶段 Badge

**状态管理：**
- `books: BookWithStats[]` — 书籍列表 + 章节统计
- `expandedBookId: string | null` — 当前展开的书籍
- `chapters: Map<string, Chapter[]>` — 按 bookId 缓存的章节列表
- `stageFilter: ChapterStage | 'all'` — 章节阶段筛选
- `scanning: boolean` — 扫描中状态

**类型定义：**
```ts
type BookWithStats = {
  id: string
  title: string
  rootPath: string
  chapterCount: number
  publishedCount: number
  pendingCount: number
}

type Chapter = {
  id: string
  chapterNumber: number
  title: string
  stage: ChapterStage
}
```

### 3.4 账号管理页（accounts-page.tsx）

- 用 PageHeader 替代手写标题
- 添加账号区域用 Card + Input + Button 组件
- 账号列表用 Table 组件
- Badge 组件显示状态（已登录/已过期/需登录）
- 删除操作弹出 Confirm 对话框
- 添加/删除/激活成功后用 Toast 通知
- 加载中显示 Spinner

## 4. 清理

- 删除 `components/task-log-panel.tsx`（硬编码样式，不再使用）
- 删除 `components/chapter-stage-badge.tsx`（被 Badge 组件 + 映射表替代）
- LiveLogPanel 样式改用 CSS 变量，移除硬编码字体栈

## 5. 文件结构（最终态）

```
src/web/
├── main.tsx
├── app.tsx                          # App shell + theme + toast provider
├── index.html
├── styles/
│   └── tokens.ts                    # 设计常量
├── components/
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── badge.tsx
│   │   ├── table.tsx
│   │   ├── empty-state.tsx
│   │   ├── toast.tsx
│   │   ├── modal.tsx
│   │   ├── spinner.tsx
│   │   └── page-header.tsx
│   └── live-log-panel.tsx           # 保留，样式改用变量
└── pages/
    ├── prompt-page.tsx              # 重写
    ├── books-page.tsx               # 重写（补全功能）
    └── accounts-page.tsx            # 重写
```

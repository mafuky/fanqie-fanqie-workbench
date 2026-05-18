# 多平台发布底座设计

## 概述

将 `fanqie-workbench` 从“番茄单平台发布”重构为“本地书籍 + 多平台发布目标”的发布底座。第一阶段按 **番茄 + 起点** 设计，同时建立可扩展到晋江等后续平台的统一抽象。

目标不是一次性做完所有平台接入，而是先把核心模型改对：
- 本地 `books` / `chapters` 继续表示工作区中的小说源数据
- 平台侧发布状态、远程 ID、账号绑定从本地书籍表中拆出
- 平台差异收敛到 adapter 层，而不是散落在 route / UI / schema 各处

## 架构决策

**方案：本地源数据表 + 发布映射表 + 平台适配器**

- 本地书与章节保持平台无关
- 每个平台账号独立管理
- 每本本地书可以挂多个发布目标（Fanqie / Qidian）
- 每个发布目标拥有自己的远程书籍 ID、平台章节映射、状态与账号绑定
- 发布动作挂在“发布目标”上，而不是直接挂在本地书上

这是第一阶段最稳的方案，因为它从数据模型开始就去掉了 `books.remote_book_id` / `chapters.remote_id` 这种单平台假设。

## 1. 核心模型

### 1.1 本地源数据

继续保留现有表：
- `books`
- `chapters`

它们只代表本地工作区里的小说数据，不再承载平台发布关系。

### 1.2 平台账号表

新增 `platform_accounts`：

```sql
CREATE TABLE platform_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  profile_path TEXT NOT NULL,
  cookies_json TEXT,
  status TEXT NOT NULL DEFAULT 'needs-login',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(platform, profile_path)
);
```

说明：
- 一个账号永远属于一个平台
- 番茄账号和起点账号彼此独立
- 后续晋江接入时直接新增 `platform = 'jinjiang'`

### 1.3 书籍发布目标表

新增 `book_publications`：

```sql
CREATE TABLE book_publications (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_account_id TEXT NOT NULL,
  platform_book_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id),
  UNIQUE(book_id, platform)
);
```

说明：
- 一条 `book_publication` 表示“某本本地书在某个平台上的发布目标”
- 第一阶段约束为：**同一本书在同一平台只允许一个目标**
- 如果后续需要同平台多账号投递，再把唯一约束放宽到 `(book_id, platform, platform_account_id)`

### 1.4 章节发布映射表

新增 `chapter_publications`：

```sql
CREATE TABLE chapter_publications (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  book_publication_id TEXT NOT NULL,
  platform_chapter_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_published_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  FOREIGN KEY (book_publication_id) REFERENCES book_publications(id),
  UNIQUE(chapter_id, book_publication_id)
);
```

说明：
- 章节是否已发、发到哪个平台 ID，不再写进 `chapters.remote_id`
- 本地 `chapters.stage` 继续表示本地写作流转状态（待写作、可发布、已发布等）
- 平台发布状态单独放在 `chapter_publications.status`

## 2. 与现有单平台字段的关系

当前代码/设计里已经存在单平台字段方向：
- `accounts.cookies_json`
- `books.remote_book_id`
- `chapters.remote_id`

### 迁移策略

第一阶段采用 **短期兼容、逻辑迁移**：
- 保留旧字段，避免正在进行中的工作直接断掉
- 新的发布逻辑只读写：
  - `platform_accounts`
  - `book_publications`
  - `chapter_publications`
- 旧字段只作为过渡存在，不再继续扩展职责

一旦多平台发布底座稳定，第二阶段再把旧字段迁出主路径，避免代码长期双写。

## 3. 平台适配器抽象

新增统一接口：

```ts
type SupportedPlatform = 'fanqie' | 'qidian'

interface PublisherAdapter {
  platform: SupportedPlatform

  validateAccount(account: PlatformAccount): Promise<AccountHealth>
  startLogin(account: PlatformAccount): Promise<LoginStartResult>
  importCookies(account: PlatformAccount, raw: string): Promise<ImportResult>

  ensureRemoteBook(input: EnsureRemoteBookInput): Promise<{ platformBookId: string }>
  fetchBookStatus(input: FetchBookStatusInput): Promise<RemoteBookStatus>

  upsertChapterDraft(input: UpsertChapterDraftInput): Promise<{ platformChapterId: string }>
  publishChapter(input: PublishChapterInput): Promise<void>
  fetchChapterStatuses(input: FetchChapterStatusesInput): Promise<RemoteChapterStatus[]>
}
```

### 平台实现
- `fanqie-adapter.ts`
- `qidian-adapter.ts`

### 设计原则
- adapter 处理“平台能力”
- route 处理 HTTP 编排
- publish runner 处理本地章节筛选、顺序、状态回写
- UI 不知道平台内部 API 差异

## 4. API 发现与登录

### 4.1 登录
`platform_accounts` 按平台独立登录：
- Fanqie → Fanqie adapter 负责打开浏览器 / 导入 cookie / 健康检查
- Qidian → Qidian adapter 负责对应流程

### 4.2 抓包录制
录制器也平台化：
- `POST /api/platform-accounts/:id/start-recording`
- `POST /api/platform-accounts/:id/stop-recording`

保存目录按平台隔离：
- `data/api-captures/fanqie/...`
- `data/api-captures/qidian/...`

这样不同平台的 API 发现互不混淆。

## 5. Route 设计

### 5.1 平台账号

```http
GET    /api/platform-accounts?platform=fanqie
POST   /api/platform-accounts
POST   /api/platform-accounts/:id/login-session
POST   /api/platform-accounts/:id/import-cookies
POST   /api/platform-accounts/:id/check-health
POST   /api/platform-accounts/:id/start-recording
POST   /api/platform-accounts/:id/stop-recording
```

### 5.2 书的发布目标

```http
GET    /api/books/:bookId/publications
POST   /api/books/:bookId/publications
PATCH  /api/book-publications/:id
```

`POST /api/books/:bookId/publications` 请求体：
```json
{
  "platform": "fanqie",
  "platformAccountId": "acct_xxx"
}
```

### 5.3 单个发布目标的操作

```http
POST   /api/book-publications/:id/sync-book
POST   /api/book-publications/:id/publish-chapters
GET    /api/book-publications/:id/chapters
```

### 为什么拆成三个动作
不要只保留一个笼统 `/publish`：
- `sync-book` 负责“确保远程书存在 / 拉取远程书信息”
- `publish-chapters` 负责“把章节推上去”
- `GET chapters` 负责查看该平台下各章节的远程映射和状态

这样可以适应番茄和起点在“建书”“发章节”“审核状态”上的差异。

## 6. UI 设计

## 6.1 平台账号管理页

账号页改成“平台账号管理”：
- 顶部平台 tab：番茄 / 起点
- 每个平台独立账号列表
- 每个平台独立登录、Cookie 导入、健康检查

用户心智：
- 我管理的是“番茄账号”和“起点账号”，不是一个混合账号池

## 6.2 书籍管理页

书籍页继续以 **本地书** 为主对象。

每本书展开后新增“发布目标区”：

### 发布目标卡片示例
- 番茄 · 主号A · 已绑定 · 已发 10/20 章
- 起点 · 起点号B · 未同步 · 已发 0/20 章

### 新增发布目标
流程：
1. 点击“新增发布目标”
2. 选择平台（番茄 / 起点）
3. 选择该平台账号
4. 创建 `book_publication`

### 每个发布目标的操作
- 同步书信息
- 发布章节
- 查看该平台章节状态
- 更换账号 / 停用目标

### 用户心智模型
- **Book** = 本地小说
- **Publication Target** = 这本小说在某个平台上的投递关系

用户不会先看一堆技术性的 `book_publication` 顶层列表，而是先看书，再看书下面挂了哪些平台目标。

## 7. 状态模型

### 本地状态
`chapters.stage` 继续代表本地内容流水线：
- 待写作
- 已初稿
- 已去AI
- 已审稿
- 可发布
- 发布中
- 已发布

### 平台状态
平台投递状态放在：
- `book_publications.status`
- `chapter_publications.status`

例如：
- `draft`
- `bound`
- `syncing`
- `ready`
- `published`
- `failed`

目的：
同一章在番茄发布成功，不应自动意味着它在起点也成功。

## 8. 命名约定

多平台里不再推荐继续使用笼统的 `remote_*`：
- `account_id` → `platform_account_id`
- `remote_book_id` → `platform_book_id`
- `remote_chapter_id` → `platform_chapter_id`

这样字段语义更明确，避免“remote 是相对于什么？”的歧义。

## 9. 第一阶段范围控制

第一阶段只做：
- 多平台底座模型
- Fanqie + Qidian 两个平台枚举与 adapter 框架
- 平台账号管理页
- 本地书下的多平台发布目标 UI
- route 重组为 publication-centric

第一阶段**不做**：
- 三平台以上接入
- 同一本书在同一平台多个账号并发投递
- 平台复杂运营功能（预约发布、批量改价、标签优化等）

## 10. 风险与迁移点

1. **单平台字段遗留**
   - 如果长期保留 `books.remote_book_id` / `chapters.remote_id` 为主路径，会持续泄漏单平台假设
   - 解决：新逻辑只写新表，旧字段尽快退出主流程

2. **平台差异比预想大**
   - 解决：adapter 接口按“能力”划分，而不是按某个平台当前 UI 流程硬编码

3. **唯一约束过早放死**
   - 第一阶段先限制 `(book_id, platform)` 唯一，换取实现简单
   - 以后再根据需要扩展

4. **UI 过度暴露内部对象**
   - 解决：用户界面始终以“书”为主，不以 publication 为主

## 11. 文件结构建议

### 新增/重构
- `src/domain/platform.ts`
- `src/domain/platform-account.ts`
- `src/domain/publication.ts`
- `src/publish/publisher-adapter.ts`
- `src/publish/platform-registry.ts`
- `src/publish/fanqie-adapter.ts`
- `src/publish/qidian-adapter.ts`
- `src/db/repositories/platform-accounts-repo.ts`
- `src/db/repositories/book-publications-repo.ts`
- `src/db/repositories/chapter-publications-repo.ts`

### 修改
- `src/db/schema.ts`
- `src/server/routes/accounts.ts` → 重构为平台账号 route
- `src/server/routes/books.ts`
- `src/publish/publish-runner.ts`
- `src/publish/publish-job-service.ts`
- `src/web/pages/accounts-page.tsx`
- `src/web/pages/books-page.tsx`

## 12. 验证策略

### 自动测试
- schema migration：新表创建与旧字段兼容
- repo tests：publication 表的 CRUD、唯一约束、映射查询
- adapter contract tests：不同平台 adapter 的统一行为
- route tests：
  - 创建发布目标
  - 获取发布目标列表
  - 发布章节
  - 查询平台章节状态

### 手工验证
1. 创建番茄账号并登录
2. 创建起点账号并登录
3. 对一本本地书分别绑定：
   - 番茄目标
   - 起点目标
4. 在书籍页看到两个目标卡片
5. 单独触发某一个目标的：
   - 同步书信息
   - 发布章节
6. 验证另一平台目标状态不受影响

## 结论

多平台发布底座的核心不是“在现有番茄逻辑上打补丁”，而是把系统改成：

**本地书籍（source of truth） + 平台账号（platform_accounts） + 发布目标（book_publications） + 章节映射（chapter_publications） + 平台适配器（PublisherAdapter）**

这样第一阶段就能稳妥承载“番茄 + 起点”，同时为后续晋江等平台留出清晰扩展路径。
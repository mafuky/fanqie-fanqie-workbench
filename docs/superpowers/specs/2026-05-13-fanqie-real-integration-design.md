# 番茄小说真实集成设计

## 概述

将 fanqie-workbench 中的账号管理和发布功能从 stub 升级为真实可用的番茄小说作者后台集成。包含登录、会话管理、API 发现、书籍管理和章节发布全流程。

## 架构决策

**方案：API 优先 + Playwright 辅助**

- Playwright 仅用于两个场景：用户登录（弹浏览器手动操作）和 API 发现（抓包录制）
- 所有实际业务操作（创书、发章节、查状态）通过 HTTP API + Cookie 直接调用
- 同时支持 Cookie 手动粘贴作为备用登录方式

## 1. 登录与会话管理

### 1.1 Playwright 弹窗登录（主路径）

用户点击「登录」按钮：

1. 调用 `POST /api/accounts/:id/login-session`
2. 后端用 `chromium.launchPersistentContext(profilePath, { headless: false })` 打开有头浏览器
3. 导航到 `https://author.fanqie.com`
4. 用户在浏览器里手动登录（抖音扫码 / 手机号验证码）
5. 后端轮询检测登录状态：检查页面 URL 是否不再包含 `login`，或 DOM 中出现已登录标识
6. 登录成功后，从浏览器上下文提取 cookies：`context.cookies()`
7. 将 cookies 序列化为 JSON 存入 `accounts.cookies_json`
8. 关闭浏览器，更新账号状态为 `active`
9. 返回成功响应给前端

轮询超时设为 5 分钟，超时后关闭浏览器、返回失败。

### 1.2 Cookie 手动粘贴（备用路径）

用户点击「粘贴 Cookie」按钮：

1. 前端弹出文本输入框
2. 用户从 Chrome DevTools → Application → Cookies 复制 cookie 字符串
3. 支持两种格式：
   - 分号分隔的 `key=value; key2=value2` 格式
   - JSON 数组格式 `[{name, value, domain, path}]`
4. 调用 `POST /api/accounts/:id/import-cookies` 提交
5. 后端解析 cookies，存入 `accounts.cookies_json`
6. 立即执行一次健康检查验证 cookie 是否有效
7. 根据结果更新状态为 `active` 或 `expired`

### 1.3 会话健康检查

`POST /api/accounts/:id/check-health`：

1. 从数据库读取 `cookies_json`
2. 用 cookies 发起一个轻量 API 请求（如获取用户信息或书籍列表）
3. 检查响应：
   - 200 且返回有效数据 → `active`
   - 401 / 302 重定向到登录页 / 错误码 → `expired`
4. 更新 `accounts.status` 和 `accounts.last_checked_at`
5. 返回当前状态

健康检查时机：
- 每次发布操作前自动检查
- 用户手动点击「检查状态」
- 前端定期轮询（可选，频率不高于每 10 分钟）

## 2. API 发现（抓包录制）

### 2.1 录制流程

`POST /api/accounts/:id/start-recording`：

1. 用 Playwright 加载账号的 browser profile（已登录状态）打开 author.fanqie.com
2. 注册 `page.on('request')` 和 `page.on('response')` 拦截器
3. 只记录匹配 `/api/` 路径的请求
4. 用户在浏览器中正常操作（创建书、编辑章节、发布等）
5. 每个 API 调用记录：
   - `url`: 完整 URL
   - `method`: GET/POST/PUT/DELETE
   - `requestHeaders`: 请求头（过滤掉敏感 cookie 值）
   - `requestBody`: 请求体
   - `responseStatus`: HTTP 状态码
   - `responseBody`: 响应体（截断超大响应）
   - `timestamp`: 时间戳

### 2.2 停止录制

`POST /api/accounts/:id/stop-recording`：

1. 关闭浏览器
2. 将捕获的 API 记录保存到 `data/api-captures/{timestamp}.json`
3. 返回捕获的 API 端点摘要

### 2.3 存储格式

```json
{
  "capturedAt": "2026-05-13T10:00:00Z",
  "accountId": "xxx",
  "entries": [
    {
      "url": "https://author.fanqie.com/api/v1/book/list",
      "method": "GET",
      "requestHeaders": { "content-type": "application/json" },
      "requestBody": null,
      "responseStatus": 200,
      "responseBody": { "code": 0, "data": { "book_list": [...] } },
      "timestamp": "2026-05-13T10:00:05Z"
    }
  ]
}
```

这是一次性操作。完成后开发者根据捕获数据填充 `FanqieApiClient` 的具体端点和参数。

## 3. FanqieApiClient

### 3.1 类设计

```typescript
// src/publish/fanqie-api-client.ts

type FanqieCookie = { name: string; value: string; domain: string; path: string }

class FanqieApiClient {
  private baseUrl = 'https://author.fanqie.com'
  private cookies: FanqieCookie[]

  constructor(cookies: FanqieCookie[])

  // 会话
  async checkSession(): Promise<boolean>

  // 书籍
  async getBookList(): Promise<FanqieBook[]>
  async getBookInfo(bookId: string): Promise<FanqieBookDetail>
  async createBook(params: CreateBookParams): Promise<string> // returns bookId

  // 章节
  async getChapterList(bookId: string): Promise<FanqieChapter[]>
  async createChapter(bookId: string, title: string, content: string): Promise<string> // returns chapterId
  async updateChapter(chapterId: string, title: string, content: string): Promise<void>

  // 内部
  private async request(path: string, options?: RequestInit): Promise<any>
}
```

### 3.2 请求机制

- `request()` 方法统一处理：
  - 将 cookies 序列化为 `Cookie` header
  - 设置必要的 headers（Content-Type, User-Agent 等）
  - 错误处理：401 → 抛出 SessionExpiredError
  - 速率限制：请求间隔至少 500ms，避免触发风控

### 3.3 端点映射

API 端点在 `FanqieApiClient` 内部硬编码。初始值基于 API 发现阶段的抓包结果。如果番茄改版，只需更新这个文件。

预期端点模式（待抓包确认）：
- `GET /api/v1/book/list` — 书籍列表
- `POST /api/v1/book/create` — 创建书籍
- `GET /api/v1/book/info?book_id=xxx` — 书籍详情
- `GET /api/v1/chapter/list?book_id=xxx` — 章节列表
- `POST /api/v1/chapter/create` — 创建章节
- `POST /api/v1/chapter/update` — 更新章节

## 4. 发布流程

### 4.1 发布章节到番茄

`POST /api/books/:id/publish`：

1. **预检**：
   - 检查书籍是否绑定了账号
   - 检查账号 cookie 是否有效（调用 `checkSession()`）
   - 检查是否有 `stage === '可发布'` 的章节
2. **确定远程书籍**：
   - 如果 `books.remote_book_id` 存在 → 使用已有的远程书籍
   - 如果不存在 → 调用 `createBook()` 在番茄创建新书，保存 remote_book_id
3. **上传章节**（按 chapter_number 升序）：
   - 对每个待发布章节：
     - 如果 `chapters.remote_id` 不存在 → `createChapter()` 创建新章节
     - 如果存在 → `updateChapter()` 更新已有章节
   - 保存 remote_id 到数据库
   - 更新 stage 为 `已发布`
4. **返回结果**：
   - 成功/失败的章节列表
   - 错误信息

### 4.2 同步远程状态

`POST /api/books/:id/sync-remote`：

1. 用 `getBookInfo(remote_book_id)` 获取远程书籍信息
2. 用 `getChapterList(remote_book_id)` 获取远程章节列表
3. 将审核状态、字数等信息更新到本地数据库
4. 前端展示同步后的状态

## 5. 数据库变更

### accounts 表

```sql
ALTER TABLE accounts ADD COLUMN cookies_json TEXT;
```

`cookies_json` 存储格式：JSON 数组 `[{name, value, domain, path, expires, httpOnly, secure}]`

### books 表

```sql
ALTER TABLE books ADD COLUMN remote_book_id TEXT;
```

### chapters 表

```sql
ALTER TABLE chapters ADD COLUMN remote_id TEXT;
```

### 迁移策略

在 `schema.ts` 的建表 SQL 中直接添加新字段（项目处于早期，无需正式 migration）。

## 6. 前端 UI 变更

### 6.1 账号管理页

现有功能保留（添加、删除、列表），新增：

- **「登录」按钮**：触发 Playwright 弹窗登录，显示 loading 状态直到登录完成或超时
- **「粘贴 Cookie」按钮**：弹出 Modal，包含一个 textarea 和格式说明
- **「检查状态」按钮**：替换原来的「激活」按钮，调用真实的健康检查
- **状态显示增强**：显示最后检查时间的相对时间（如「3 分钟前」）

### 6.2 书籍管理页

现有功能保留，新增：

- **远程状态标识**：Badge 显示「已关联」/「未关联」（是否有 remote_book_id）
- **「发布到番茄」按钮**：触发发布流程，显示进度
- **「同步状态」按钮**：拉取远程最新状态
- **发布进度展示**：显示正在上传第 X/N 章，完成后展示结果

### 6.3 API 录制（开发者工具）

暂时放在账号管理页的折叠区域：

- **「开始录制」按钮**：选择账号，打开录制浏览器
- **「停止录制」按钮**：关闭浏览器，保存抓包数据
- **录制结果展示**：列表显示捕获的 API 端点

## 7. 文件结构

### 新增文件

```
src/publish/fanqie-api-client.ts  — HTTP API 客户端
src/publish/api-recorder.ts       — Playwright 抓包录制
src/publish/cookie-store.ts       — Cookie 解析与序列化
```

### 修改文件

```
src/domain/account.ts             — AccountRecord 增加 cookiesJson 字段
src/domain/book.ts                — BookRecord 增加 remoteBookId 字段
src/domain/chapter.ts             — 增加 remoteId 字段
src/db/schema.ts                  — 增加新字段
src/db/repositories/accounts-repo.ts  — 增加 cookie 存取方法
src/db/repositories/books-repo.ts     — 增加 remote_book_id 存取
src/db/repositories/chapters-repo.ts  — 增加 remote_id 存取
src/publish/account-session.ts    — 扩展登录流程：添加 cookie 提取和登录检测
src/publish/session-health.ts     — 改为 API 方式检查
src/publish/publish-runner.ts     — 改为调用 FanqieApiClient
src/server/routes/accounts.ts     — 新增 login-session、import-cookies、recording 端点
src/server/routes/books.ts        — 新增 publish、sync-remote 端点
src/web/pages/accounts-page.tsx   — UI 改造
src/web/pages/books-page.tsx      — UI 改造
```

## 8. 错误处理

- **SessionExpiredError**：cookie 过期，提示用户重新登录
- **RateLimitError**：触发风控，自动降低请求频率
- **ApiError**：番茄 API 返回错误码，展示原始错误信息
- **NetworkError**：网络问题，提示重试

所有发布操作支持部分成功：如果上传到第 5 章失败，前 4 章的结果仍然保存。

## 9. 安全考量

- Cookie 存储在本地 SQLite，不上传到任何远程服务
- Browser profile 目录包含敏感数据，.gitignore 中已忽略 `data/` 目录
- API 录制结果中自动脱敏 cookie 值（只保留 cookie name）
- 请求间隔限制（500ms+）避免对番茄服务器造成压力

## 10. 依赖变更

`playwright` 需要从 devDependencies 提升为 dependencies（登录和 API 录制在运行时使用）：

```json
{
  "dependencies": {
    "playwright": "^1.53.0"
  }
}
```

## 11. 并发与限制

- 同一时刻只允许一个 Playwright 浏览器实例（登录或录制），使用现有的 `PublishQueue` 控制
- 发布操作串行执行：一本书发布完才能发下一本，避免触发番茄风控
- 每个 API 请求间隔不低于 500ms

## 12. API 端点说明

第 3.3 节中的端点模式（如 `/api/v1/book/list`）是基于字节系平台的常见模式推测的**占位符**。实际端点需要通过第 2 节的 API 录制流程确认后更新到 `FanqieApiClient` 中。在 API 端点确认之前，`FanqieApiClient` 的方法会抛出 `NotConfiguredError`。

# 小番茄 Web 形态 v0.2 设计

## 1. 目标定位

小番茄 Web 是一个以“书”为中心的 AI 网文生产工作台。

它不是简单的 prompt 页面，也不是把 Claude Code 终端搬到浏览器里。它的定位是：

> Web 管理小说项目、编辑器、文件、Claude Code 会话、市场情报、资料和发布；具体写作工程由可替换能力包执行，默认能力包是 `oh-story-claudecode`。

核心产品闭环：

```text
市场情报 / 对标
→ 绑定到书
→ 写前材料检查
→ Claude Code 生成章节
→ 编辑器人工修改
→ 去 AI 味
→ 审稿
→ 发布
→ 数据反馈
```

v0.2 原型文件：

```text
docs/superpowers/specs/2026-05-18-xiaofanqie-web-shape-v02-interactive-prototype.html
```

## 2. 设计原则

### 2.1 以书为中心

所有高频动作都围绕一本书展开。用户不是先选择 skill，也不是先进入终端，而是先选择一本书，再在这本书里写作、修改、审稿、管理资料和发布。

### 2.2 Web 不复制写作工程

小番茄 Web 不重新实现 `oh-story-claudecode` 的写作流程。

Web 负责：

- 书库
- 单书工作台
- 章节编辑器
- 文件读写
- Claude Code 会话控制
- 执行日志
- 用户回答
- 任务状态
- 市场情报系统
- 资料库
- 账号发布
- 设置与能力绑定

能力包负责：

- 写前材料检查
- 补细纲
- 读取上一章
- 读取大纲
- 读取追踪上下文
- 读取伏笔 / 时间线
- 读取对标 / 市场扫描材料
- 生成正文
- 去 AI 味
- 审稿
- 重写
- 更新追踪文件

默认能力包是 `oh-story-claudecode`。如果以后不用它，Web 通过 Action Registry 替换能力绑定，不改产品界面。

### 2.3 文件系统是长期记忆

Claude Code 会话负责连续交互，文件系统负责长期延续。

一本书的长期记忆在：

```text
设定/
大纲/
正文/
追踪/上下文.md
追踪/伏笔.md
追踪/时间线.md
对标/
参考资料/
```

即使 Claude 会话断开，也应能通过文件系统继续写。

### 2.4 用户保留最终控制权

Claude 生成后的正文必须进入编辑器，用户可以直接修改、保存、再触发工具加工。

选区工具默认使用建议模式：Claude 返回修改建议或替换预览，用户接受后再写入编辑器。

## 3. 一级导航

全局一级导航固定为六项：

```text
书库
当前任务
市场情报
资料库
账号发布
设置
```

### 3.1 书库

默认首页。

职责：

- 查看所有书
- 新建一本书
- 导入小说
- 扫描 `novels/`
- 进入单书工作台

书库只负责“选书”和“建书”，不承载复杂章节工作流。

### 3.2 当前任务

全局任务队列。

职责：

- 查看所有运行中任务
- 查看等待用户回答的任务
- 查看失败任务
- 查看排队任务
- 快速回到对应书 / 章节 / Claude 会话
- 停止、继续、恢复异常任务

### 3.3 市场情报

市场情报是完整市场系统，不只是扫榜按钮。

职责：

- 扫榜
- 全平台自动采集
- 结构化入库
- 趋势图表
- 题材热度
- 智能推荐
- 榜单变化监控
- 把市场结果绑定到书

### 3.4 资料库

职责：

- 全局资料
- 本书资料
- 角色资料
- 世界观资料
- 伏笔 / 时间线
- 外部调研结果
- 文件素材

资料库管理资料，能力包使用资料。

### 3.5 账号发布

职责：

- 平台账号
- 登录状态
- 平台书籍绑定
- 发布任务
- 发布日志
- 截图 / 校验
- 发布失败恢复

发布状态机在小番茄内实现，不交给 Claude 自由操作。

### 3.6 设置

职责：

- 工作区路径
- Claude Code runtime
- Action Registry
- 能力绑定
- 浏览器 CDP
- 数据库 / 备份
- 高级调试

## 4. 单书工作台

进入一本书后，显示单书工作台。

```text
单书工作台
├─ Dashboard
├─ 写作
├─ Claude 会话
├─ 创作流程
├─ 发布
└─ 资料 / 工具
```

### 4.1 Dashboard

Dashboard 是下一步行动型，不是纯统计页。

展示：

- 推荐下一步
- 当前书状态
- 可发布库存
- 待写章节
- 待审稿章节
- 当前 Claude 会话
- 市场情报绑定情况
- 资料缺口
- 发布风险

它回答：

> 这本书现在下一步该做什么？

### 4.2 写作

写作页是最高频核心页。

布局：

```text
左侧：章节 / 文件导航
中间：正文编辑器
右侧：Claude Code 执行面板
```

#### 左侧：章节 / 文件导航

展示：

- 章节列表
- 阶段状态
- 文件路径
- 字数
- 是否有细纲
- 是否有审稿报告
- 是否有发布记录

点击章节后，中间编辑器打开对应 `.md` 文件。

#### 中间：正文编辑器

编辑器能力：

- 打开章节正文
- 手动修改
- 保存
- 未保存提示
- 字数统计
- 标题编辑
- 生成后自动刷新
- 支持选中文本

编辑器工具分为整章工具和选区工具。

整章工具：

- 继续写本章
- 去 AI 味本章
- 审稿本章
- 重写本章
- 润色本章
- 强化钩子

选区工具：

- 润色选中段落
- 改写选中段落
- 扩写选中段落
- 缩写选中段落
- 改对白
- 加强冲突
- 去 AI 味选中段落

选区工具默认流程：

```text
用户选中文本
→ 触发选区动作
→ Claude 返回建议 / 替换预览
→ Web 展示 diff 或预览
→ 用户接受
→ 写入编辑器
→ 用户保存
```

#### 右侧：Claude Code 执行面板

右侧执行面板是 Web 和 Claude Code 的交互核心。

展示：

- 当前产品动作
- 当前绑定能力
- 当前阶段
- 结构化日志
- Claude 提问
- 用户回答
- 停止
- 继续 / 恢复
- 完整会话入口

### 4.3 Claude 会话

Claude 会话 Tab 是高级控制区。

展示：

- 书级主会话状态
- tmux / PTY session 名
- 最近任务
- 历史会话
- 完整日志
- 等待回答的问题
- 上下文查看
- 手动压缩上下文
- 停止 / 继续 / 恢复

普通写作不需要进入此 Tab；调试、恢复、压缩、查看上下文时使用。

### 4.4 创作流程

创作流程展示书从市场输入到发布的阶段：

```text
市场情报绑定
→ 写前材料检查
→ 补细纲 / 补资料
→ 生成正文
→ 编辑器人工修改
→ 去 AI 味
→ 审稿
→ 发布
```

创作流程不替代写作页，只提供流程视角。

### 4.5 发布

发布 Tab 只展示当前书的发布状态。

包含：

- 发布平台目标
- 当前绑定账号
- 平台书籍 ID
- 章节发布状态
- 可发布章节
- 发布中任务
- 发布失败原因
- 校验结果
- 最近发布时间

全局账号管理仍在“账号发布”。本 Tab 只关心“这本书发到哪里”。

### 4.6 资料 / 工具

展示当前书绑定的资料和工具结果：

- 本书追踪上下文
- 伏笔
- 时间线
- 角色设定
- 世界观设定
- 对标分析
- 市场扫描
- 参考资料

## 5. 写作动作真实流程

`继续写本章` 不是直接生成正文。

真实流程：

```text
用户点击继续写本章
→ Web 创建 chapter.continue action
→ 后端发送命令到该书 Claude Code 会话
→ 默认能力包 oh-story-claudecode 接管
→ skill 执行写前材料检查
→ 缺材料则补材料 / 提问
→ 材料齐备后写正文
→ 写入章节 .md
→ 更新追踪文件
→ Web 刷新编辑器
→ 用户手动改稿
```

### 5.1 写前材料阶段

写前材料阶段由能力包负责，Web 负责展示。

右侧面板应能展示：

```text
写前材料检查

✓ 大纲/细纲_第037章.md
✓ 正文/第036章_旧案卷宗.md
✓ 追踪/上下文.md
✓ 追踪/伏笔.md
✓ 追踪/时间线.md
✓ 设定/角色/林岚.md
✓ 对标/市场扫描/番茄悬疑榜.md
△ 参考资料/法医鉴定流程.md 缺失
```

材料分为硬阻塞和软提醒。

硬阻塞：

- 本章细纲缺失
- 章节文件路径不存在
- 书籍目录不存在

硬阻塞时，能力包应先补材料或请求用户确认。

软提醒：

- 对标报告缺失
- 参考资料缺失
- 某个角色设定缺失
- 伏笔表为空

软提醒不阻止写作，但应展示给用户。

### 5.2 Web 不硬编码材料规则

Web 不自己判断“长篇写作必须读哪些材料”。

规则属于能力包。Web 只解析能力包输出的结构化标记。

建议标记：

```text
[WORKBENCH_STAGE: materials]
[WORKBENCH_CHECK: 大纲/细纲_第037章.md | ok]
[WORKBENCH_CHECK: 参考资料/法医鉴定流程.md | missing | soft]
[WORKBENCH_STAGE: writing]
[WORKBENCH_FILE_UPDATED: 正文/第037章_暴雨夜的第二具尸体.md]
[WORKBENCH_STAGE: done]
```

Web 看到这些标记后，将终端日志渲染为结构化阶段。

## 6. Claude Code 会话模型

### 6.1 一本书一个长期 Claude Code 会话

会话属于书，不属于单次按钮点击。

```text
bookId
→ tmux / PTY session
→ interactive claude
```

同一本书所有写作、编辑、审稿动作，优先走同一个书级 Claude Code 会话。

### 6.2 不依赖 `claude -p`

正式设计不使用 `claude -p`。

优先路径：

```text
tmux / PTY
→ 交互式 claude
→ slash skills
```

如果会话断开：

- 优先恢复该书 tmux session
- 必要时用 Claude Code 的 continue / resume 能力恢复
- 不让 Web 用户直接操作 `/resume`

### 6.3 并发模型

同一本书同一时间只允许一个 Claude 写作 / 编辑任务运行，避免并发写同一批文件。

不同书可以并行运行，初始上限建议为 2 本。

## 7. Action Registry

Web 不硬编码 skill。

Web 只发送产品动作：

```text
book.create
book.import
book.outline.revise
chapter.continue
chapter.deslop
chapter.review
chapter.rewrite
editor.selection.polish
editor.selection.rewrite
market.scan
market.bindToBook
publish.chapters
```

后端维护：

```text
actionKey
scope
input schema
default capability
command template
availability check
```

默认绑定：

```text
chapter.continue → oh-story-claudecode /story-long-write
chapter.deslop → oh-story-claudecode /story-deslop
chapter.review → oh-story-claudecode /story-review
market.scan → oh-story-claudecode scan scripts
publish.chapters → fanqie-workbench publisher adapter
```

如果以后不用 `oh-story-claudecode`：

```text
actionKey 不变
替换 capability binding
Web 不改
```

能力绑定默认隐藏在设置的高级区域。

## 8. 市场情报系统

市场情报是一级模块。

目标不是只做扫榜按钮，而是建立市场情报系统。

### 8.1 数据采集

支持：

- 手动扫榜
- 定时扫榜
- 全平台自动抓取
- 失败重试
- 登录态检查
- 原始 Markdown 保存
- 结构化 JSON 保存

复用 `oh-story-claudecode` 现有脚本。

长篇：

```text
fanqie-rank-scraper.js
qidian-rank-scraper.js
qimao-rank-scraper.js
jjwxc-rank-scraper.js
ciweimao-rank-scraper.js
```

短篇：

```text
dz-browse-scraper.js
heiyan-booklist-scraper.js
```

### 8.2 结构化入库

扫榜结果同时保存 Markdown 和结构化数据。

建议表：

```text
market_scan_jobs
market_scan_results
market_books
market_book_snapshots
market_tags
market_trends
book_market_references
```

核心字段：

- 平台
- 榜单
- 频道
- 题材
- 排名
- 书名
- 作者
- 标签
- 字数
- 状态
- 简介
- 作品链接
- 核心指标
- 抓取时间
- 数据质量

核心指标按平台区分：

- 番茄：在读
- 起点：月票 / 推荐 / 收藏
- 七猫：热度
- 晋江：收藏 / 营养液 / 积分
- 黑岩：价格 / 字数 / 标签

### 8.3 趋势图表

支持：

- 题材热度变化
- 标签热词排行
- 新书上升速度
- 作品重复上榜
- 平台间题材对比
- 榜单变化趋势
- 在读 / 热度 / 收藏变化

### 8.4 智能推荐题材排序

推荐依据：

- 热度
- 增长速度
- 竞争程度
- 平台匹配
- 用户当前书的题材
- 用户能力偏好
- 是否有可复用资料 / 对标

输出：

- 推荐方向
- 推荐理由
- 风险
- 适合平台
- 对标作品
- 可写切入点

### 8.5 市场雷达

市场雷达负责持续监控。

能力：

- 定时抓榜
- 新上榜提醒
- 排名快速上升提醒
- 题材热度异常提醒
- 题材饱和提醒
- 日报 / 周报

### 8.6 与单书绑定

市场结果可以绑定到书。

```text
某次扫榜结果
→ 绑定到《雾港疑局》
→ 进入 novels/雾港疑局/对标/市场扫描/
→ 后续 /story-long-write 写作时读取
```

单书 `资料 / 工具` Tab 展示：

- 本书绑定的市场扫描
- 本书对标作品
- 本书题材定位
- 推荐调整方向

## 9. 资料库

资料库分全局和单书。

全局资料库：

- 外部调研
- 行业资料
- 职业资料
- 题材资料
- 市场资料
- 写作素材

单书资料：

- 设定
- 角色
- 世界观
- 伏笔
- 时间线
- 对标
- 市场扫描
- 参考资料

Web 管理和展示资料；能力包读取和使用资料。

## 10. 发布系统

发布系统由小番茄负责，不交给 Claude 自由操作。

已有底座应继续复用：

```text
platform_accounts
book_publications
chapter_publications
publisher adapters
publish runner
```

发布页负责：

- 账号
- 登录态
- 平台书籍绑定
- 发布章节
- 校验章节
- 失败恢复
- 截图 / 日志
- 发布状态回写

可以复用 `oh-story-claudecode` 的 `browser-cdp` 启动和浏览器控制能力，但发布状态机在小番茄内实现。

## 11. 现有资源复用

### 11.1 直接复用

前端组件：

- `Button`
- `Card`
- `Badge`
- `Input`
- `Modal`
- `PageHeader`
- `Table`
- `Toast`
- `Spinner`
- `EmptyState`
- `tokens.ts`

数据底座：

- `books`
- `chapters`
- `sessions`
- `session_messages`
- `platform_accounts`
- `book_publications`
- `chapter_publications`

现有能力：

- `BookCreationModal`
- `BookSessionPanel`
- `ChapterActionMenu`
- `LiveLogPanel`
- `terminal-runtime`
- `runtime-scheduler`
- `publish adapters`
- `story-setup-service`

### 11.2 需要重构复用

`BooksPage` 过胖，需要拆成：

```text
LibraryPage
BookWorkspacePage
BookDashboardTab
BookWritingTab
BookClaudeTab
BookWorkflowTab
BookPublishTab
BookToolsTab
```

`PromptPage` 降级为设置里的高级调试入口。

`chapter-command-builder` 和 `chapterActionMap` 迁入 Action Registry。

## 12. 第一阶段范围

第一阶段目标：写作闭环成立。

必须做：

- 书库
- 单书工作台
- 写作页三栏布局
- 章节编辑器
- 章节内容读写 API
- 真实 Claude Code runtime 长运行捕获
- 右侧执行面板
- 章节动作通过 Action Registry 调用能力
- 生成后刷新编辑器
- 用户可保存修改
- 市场情报页面骨架
- 扫榜脚本接入的最小 runner

第一阶段可以简化：

- 市场图表先用基础表格 / 简单柱状图
- 智能推荐先输出文本报告
- 定时监控先手动触发
- 结构化入库先覆盖核心字段
- 选区工具先做建议模式，不直接自动覆盖

## 13. 第二阶段增强

- 完整结构化市场库
- 趋势图表
- 自动抓全平台
- 智能推荐排序
- 市场雷达
- 选区工具 diff 接受
- 文件 watcher
- 发布自动化增强
- 能力绑定可视化编辑

## 14. API 草案

### 14.1 章节编辑器

```http
GET /api/chapters/:chapterId/content
PUT /api/chapters/:chapterId/content
```

保存要求：

- 路径必须在书籍 `root_path` 内
- 只允许写 `.md`
- 保存时避免覆盖正在运行中的 Claude 写入
- 标题变更时同步章节记录

### 14.2 动作执行

```http
POST /api/actions
GET  /api/actions/:id
GET  /api/actions/:id/stream
POST /api/actions/:id/answer
POST /api/actions/:id/interrupt
```

第一阶段可继续复用现有 `/api/sessions`，但内部语义应迁移到 Action Registry。

### 14.3 市场情报

```http
POST /api/market-scans
GET  /api/market-scans
GET  /api/market-scans/:id
POST /api/market-scans/:id/bind-book
GET  /api/market-trends
GET  /api/market-recommendations
```

### 14.4 资料绑定

```http
GET  /api/books/:bookId/resources
POST /api/books/:bookId/resources
DELETE /api/books/:bookId/resources/:resourceId
```

## 15. 数据模型草案

新增市场相关表：

```text
market_scan_jobs
market_scan_results
market_books
market_book_snapshots
market_tags
market_trends
book_market_references
```

新增动作绑定相关表或配置：

```text
action_bindings
capability_adapters
```

第一阶段可以先使用配置文件实现能力绑定，待稳定后入库。

## 16. 风险与约束

### 16.1 Claude runtime 风险

当前 tmux capture 不能只捕获一次。必须支持长运行、持续捕获、回答、停止、恢复。

### 16.2 文件写入冲突

用户编辑器保存和 Claude 写文件可能冲突。第一阶段同一本书同一时间只允许一个 Claude 任务运行，并在编辑器保存时检测运行状态。

### 16.3 市场采集风险

扫榜依赖平台页面结构、登录态、CDP、agent-browser。失败时应记录原因，不阻塞写作主流程。

### 16.4 能力包替换风险

不同能力包输出格式可能不同。结构化标记应作为推荐协议，不应让 Web 依赖某个 skill 的自然语言表述。

## 17. 测试策略

第一阶段至少覆盖：

- 章节内容 GET / PUT
- 非法路径不能读取 / 写入
- 保存时能更新章节内容
- 运行中 Claude 任务能阻止危险覆盖
- Action Registry 能把 `chapter.continue` 解析到默认能力
- 右侧执行面板能显示日志、问题和完成状态
- 用户回答能发送回同一书级 Claude 会话
- session 完成后编辑器刷新章节内容
- 市场扫描 runner 能调用脚本并保存结果
- 市场结果能绑定到书
- 旧的书库 / 发布 / session 测试不回归

## 18. 最终确认规则

小番茄 Web 的正确心智是：

```text
Web = 书籍生产工作台 + 编辑器 + Claude 会话控制 + 市场/发布/资料管理
能力包 = 写作工程
文件系统 = 长期记忆
用户 = 最终作者和最终确认者
```

本设计确认后，进入 implementation plan。实现时不得把 Web 后端写成第二套 `story-long-write`。

# Fanqie Workbench Design

## Goal

Build a local web console inside this project for managing Chinese web novel production and Fanqie publishing.

The first useful version must support:

- Managing multiple books in the same workspace.
- Running writing, review, de-AI, and analytics tasks through local Claude skills.
- Publishing one book at a time, chapter by chapter, through browser automation.
- Supporting full automatic publish mode with strong preflight checks, logs, screenshots, and stop-on-risk behavior.

Mobile layout, cloud deployment, multi-account publishing, and decorative product features are out of scope.

## Product Shape

The project gets a local app named `fanqie-workbench`.

The user starts it from the project root, opens a local browser page, and uses that page as the command center.

The console is not the writing engine. It is the scheduler, dashboard, and publishing operator. Writing quality work remains delegated to the existing skills:

- `chinese-novelist-skill` for fast chapter drafting and chapter word count checks.
- `oh-story-claudecode` for long-form web novel structure, review, de-AI, platform rubrics, cover, browser workflow references, and analytics.

## Core Workflow

### Multi-Book Production

Writing, review, de-AI, and analytics can run across multiple books.

The console creates tasks such as:

- Draft chapter for book A.
- Review chapter for book B using Fanqie rubric.
- De-AI chapter for book C.
- Analyze stockpile, update rhythm, and quality score for all books.

These tasks can run with limited concurrency.

Recommended first defaults:

- Writing concurrency: `2`
- Review/de-AI concurrency: `2`
- Analytics concurrency: `2`

### Book-Level Publishing

Publishing is book-level, not free-floating chapter-level.

The user creates a publishing job like:

```text
Publish book: 雾港疑局
Chapter range: 第001章 - 第020章
Mode: dry-run | assisted | auto
```

The system then publishes that book in order:

```text
scan chapters
-> validate chapter order
-> extract title and body
-> open Fanqie author backend
-> select the target book
-> create or edit chapter
-> fill title and body
-> run browser-side confirmation
-> save or publish according to mode
-> verify result
-> continue next chapter
```

Only one book owns the publishing worker at a time. If publishing fails on one chapter, the whole book publishing job pauses.

## Publishing Modes

### `dry-run`

The automation reads chapters, extracts title/body, opens the browser if configured, and produces logs/screenshots, but it does not submit content.

Use for first-time selector calibration, upload rehearsal, and regression testing.

### `assisted`

The automation opens Fanqie, selects the book, fills title/body, and stops before the final publish action.

The user reviews the browser and manually clicks publish or save.

### `auto`

The automation fills the chapter and clicks the publish/save action automatically.

This mode must require explicit enablement per book or per publishing job. It must run stricter checks than `assisted`:

- Book title on page matches target book.
- Chapter number and title match the current job.
- Body length matches local extraction within an acceptable tolerance.
- The page is not a login, captcha, verification, risk warning, or unexpected error page.
- The chapter is not already marked published unless the job explicitly allows overwrite/update.

If any check fails, the publishing job changes to `needs-human` and stops before publishing.

## Safety Boundary

The system should make publishing stable and observable. It must not implement bypasses for platform safety or access controls.

Allowed:

- Reuse a normal logged-in browser profile.
- Detect login expiry and pause.
- Detect captcha, verification, risk warnings, or abnormal pages and pause.
- Rate-limit publishing.
- Keep screenshots, DOM snapshots, logs, and local state.
- Avoid duplicate publish and wrong-book publish.

Not allowed:

- Captcha bypass.
- Device fingerprint evasion.
- Anti-bot or platform risk-control circumvention.
- Hidden mass-account behavior.
- Attempts to defeat platform limits.

## Data Analytics

Analytics is a first-class feature, not an afterthought.

First version analytics should focus on data available locally plus publisher workflow state:

- Book progress: planned chapters, completed chapters, reviewed chapters, uploaded chapters.
- Stockpile: publishable chapters remaining.
- Update rhythm: daily/weekly publish count, missed publish days, upcoming shortage risk.
- Chapter quality metrics: word count, review verdict, AI-flavor severity, Fanqie rubric score when available.
- Publishing metrics: success rate, failure reason, time per chapter, screenshots, verification status.
- Cross-book comparison: which book has the healthiest stockpile, best review score, and most publish-ready chapters.

Later versions may include manual or automated import of platform-visible performance data, but only after the local workflow is stable.

## Architecture

### Suggested Stack

- Frontend: Vite + React.
- Backend: Fastify.
- Database: SQLite.
- Browser automation: Playwright.
- Local skill execution: Node `child_process.spawn` calling `claude`.

### Directory Layout

```text
fanqie-workbench/
├── package.json
├── app/
│   ├── src/
│   └── index.html
├── server/
│   ├── index.ts
│   ├── routes/
│   └── services/
├── workers/
│   ├── claude-worker.ts
│   ├── analytics-worker.ts
│   └── fanqie-publish-worker.ts
├── db/
│   ├── schema.sql
│   └── database.ts
├── scripts/
│   ├── dev.ts
│   └── scan-books.ts
├── skills/
│   └── fanqie-pipeline/
└── data/
    ├── workbench.sqlite
    ├── logs/
    └── screenshots/
```

## Main Components

### Web Console

Views:

- Books dashboard.
- Book detail with chapter list.
- Task queue.
- Publishing job detail.
- Analytics dashboard.
- Settings.

The first UI should be dense and operational, not a marketing-style page.

### Fastify API

Initial endpoints:

```text
GET  /api/books
POST /api/books/scan
GET  /api/books/:bookId
GET  /api/books/:bookId/chapters
POST /api/tasks
GET  /api/tasks
GET  /api/tasks/:taskId/logs
POST /api/publish-jobs
GET  /api/publish-jobs
POST /api/publish-jobs/:jobId/pause
POST /api/publish-jobs/:jobId/resume
GET  /api/analytics/overview
GET  /api/settings
PUT  /api/settings
```

### SQLite Data Model

Core tables:

- `books`
- `chapters`
- `tasks`
- `task_logs`
- `publish_jobs`
- `publish_job_chapters`
- `analytics_snapshots`
- `settings`

Each task and publish step stores enough state to resume or diagnose failure.

### Claude Worker

The Claude worker executes local skill prompts through the installed `claude` command.

It should:

- Build deterministic prompts from task type, book path, chapter path, and target platform.
- Stream stdout/stderr into `task_logs`.
- Mark status as `succeeded`, `failed`, or `needs-human`.
- Avoid hiding failures behind generic success messages.

### Fanqie Publish Worker

The publish worker uses Playwright with a persistent browser profile.

It should:

- Open the configured Fanqie author backend URL.
- Wait for the user to log in during setup if needed.
- Select the configured book.
- Fill chapter title and body.
- Verify the filled content.
- In `auto` mode, submit only after all checks pass.
- Save screenshots before and after publish.
- Stop on unexpected pages.

Selectors for Fanqie should be stored in config or a small adapter file so they can be updated when the site changes.

## Existing Skill Integration

The new project-level skill should be an orchestrator skill, not a replacement for the existing writing skills.

Possible skill name:

```text
fanqie-pipeline
```

Responsibilities:

- Decide which existing skill should handle the task.
- Normalize book paths.
- Enforce upload readiness checks.
- Explain when to run analytics, review, or publish tasks.

It should not duplicate the full writing theory from either existing skill.

## Error Handling

Important failure states:

- Claude command missing or exits non-zero.
- Skill prompt produces no expected chapter file.
- Chapter word count below threshold.
- Review rejects chapter.
- Fanqie page is login/captcha/risk warning.
- Target book cannot be confidently selected.
- Filled title/body do not match local chapter.
- Publish result cannot be verified.

Default policy:

- Production tasks may continue if one book fails.
- A publishing job stops on the first chapter failure.
- Auto publish never continues after an uncertain browser state.

## Testing Strategy

First version testing should include:

- Unit tests for chapter title/body extraction.
- Unit tests for task state transitions.
- Unit tests for analytics calculations.
- SQLite migration smoke test.
- Playwright dry-run against a local mock page that imitates a publishing form.
- Manual Fanqie dry-run before assisted or auto mode.

## Implementation Phases

### Phase 1: Foundation

Create `fanqie-workbench`, basic Fastify server, React app, SQLite schema, and a dev command.

### Phase 2: Book Scanning

Scan existing `novels/` and standard `oh-story` style book folders. Create book and chapter records.

### Phase 3: Task Queue

Implement task creation, status tracking, logs, and limited concurrency. Start with mock workers.

### Phase 4: Claude Worker

Connect tasks to the local `claude` command. Start with review/de-AI or dry prompt tasks before long writing tasks.

### Phase 5: Analytics

Compute progress, stockpile, quality, and publishing metrics. Show analytics in the console.

### Phase 6: Publishing Dry Run

Build Playwright publisher against a local mock publishing form. Then calibrate Fanqie selectors with dry-run only.

### Phase 7: Assisted Publish

Auto-fill one real chapter and stop before final publish.

### Phase 8: Auto Publish

Enable auto mode behind explicit job-level setting, strict checks, screenshots, and stop-on-risk behavior.

## Open Decisions

- Whether the first implementation should use TypeScript everywhere or JavaScript for faster setup.
- Exact Fanqie author backend URL and current page flow.
- Whether chapter publishing should target draft save or direct publish in `auto` mode.
- Whether existing `novels/书名/第XX章.md` files should be converted in place or only indexed as-is.


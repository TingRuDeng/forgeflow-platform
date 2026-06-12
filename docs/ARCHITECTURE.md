# forgeflow-platform Architecture

> Verified overview of the current main path. This is not a full code catalog. Facts below were checked against the live script entrypoints under `scripts/` and `scripts/lib/`, the dispatcher TypeScript foundations under `apps/dispatcher/src/`, and the packaged Trae runtime under `packages/trae-beta-runtime/src/`.

## 目的

说明当前主线系统形态、模块边界、运行时所有权、关键数据流和非目标范围。

## 适合读者

适合修改 dispatcher、worker runtime、Trae 自动化链路、持久化路径或部署方式的维护者和 AI 代理。

## 一分钟摘要

- `dispatcher` 是任务和状态真相源，`scripts/lib/*` 仍是 live adapter / bootstrap 层。
- `apps/dispatcher/src/modules/server/*` 承载 dispatcher TypeScript runtime foundation。
- Trae 首选 automation gateway + automation worker；Trae MCP worker 是 fallback。
- SQLite snapshot 是当前真相源，结构化投影和 Postgres / queue shadow 不是 primary store。
- 阶段三 lease 通用结构已存在，但强约束路径当前只确认接入 assignment。

```yaml
ai_summary:
  authority: "系统形态、模块边界、运行时所有权和关键数据流"
  scope: "dispatcher、worker daemon、Trae automation、MCP thin-wrapper、持久化和审查边界"
  read_when:
    - "修改主链运行时或服务边界"
    - "判断某个目录是否是运行时权威实现"
    - "更新阶段二或阶段三架构说明"
  verify_with:
    - "scripts/lib/dispatcher-server.js"
    - "scripts/lib/dispatcher-state.js"
    - "apps/dispatcher/src/modules/server/runtime-state.ts"
    - "packages/trae-beta-runtime/src/runtime/worker.ts"
  stale_when:
    - "live adapter、dispatcher runtime、Trae runtime 或持久化真相源发生变化"
```

## 权威边界

本文件是架构概览，不是接口字段字典、数据库 schema 完整目录或操作 runbook。接口看 `API_ENDPOINTS.md`，持久化看 `DATABASE_SCHEMA.md`，操作步骤看 `runbooks/*`，最终事实以代码为准。

## 如何验证

- 对运行入口核对 `scripts/start-control-plane.sh`、`scripts/run-dispatcher-server.js` 和 `scripts/lib/dispatcher-server.js`。
- 对状态真相源核对 `apps/dispatcher/src/modules/server/runtime-state.ts` 与 `runtime-state-sqlite.ts`。
- 对 Trae 路径核对 `scripts/lib/trae-automation-worker.ts` 和 `packages/trae-beta-runtime/src/runtime/worker.ts`。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## 1. System Shape

forgeflow-platform is a control-plane repository for multi-agent development, not a single monolithic application.

Current active building blocks:

- `dispatcher`
  - Current truth source for task state, worker state, assignments, reviews, PR metadata, and audit events.
  - Active runtime entry still lives in `scripts/lib/dispatcher-server.js`.
  - Trae-specific dispatcher route handling, review-memory loading, and task-worktree ownership now live in the TypeScript runtime foundation under `apps/dispatcher/dist/modules/server/*.js`; `scripts/lib/*` only bootstraps or re-exports those modules.
  - HTTP surface supports optional bearer-token protection via `DISPATCHER_API_TOKEN`; `/health` remains public.
- `worker daemon`
  - Preferred unattended path for `codex` and `gemini`.
  - Pulls tasks from dispatcher, materializes per-task worktrees, runs assignment execution, and reports results.
- `Trae automation gateway`
  - Local HTTP bridge that drives the Trae desktop client through automation APIs.
  - Separate from dispatcher.
- `Trae automation worker`
  - Dispatcher-facing worker loop for unattended Trae execution.
  - Uses the automation gateway to drive the Trae client.
- `control-layer CLI/scripts`
  - Used to create dispatches, watch task state, inspect review material, and submit merge/block decisions.

## 2. Current Runtime Authority

The current main runtime is hybrid:

- live entrypoints and CLI/bootstrap remain under `scripts/` and `scripts/lib/`
- the `scripts/` root is intentionally trimmed to supported entrypoints plus a small legacy drill set, rather than keeping duplicate staging wrappers
- the old local codex drill flow has been retired from active entrypoints; only the deferred `worker-daemon` execution path remains for `codex/gemini`
- the dispatcher TypeScript foundation now owns major runtime logic under `apps/dispatcher/src/modules/server/`
- current live bridges import built output from `apps/dispatcher/dist/`
- dispatcher-generated `traceId` is now the stable stage-2 correlation key across snapshot, worker events, CLI summaries, console drill-down, and Trae worker evidence
- dispatcher runtime state now also owns explicit stage-3 lease semantics and a query-first SQLite projection layer

Verified bridge points:

- HTTP dispatcher server Trae route handling: `scripts/lib/dispatcher-server.js` -> `apps/dispatcher/dist/modules/server/runtime-dispatcher-server.js`
- Dispatcher state machine: `scripts/lib/dispatcher-state.js` -> `apps/dispatcher/dist/modules/server/runtime-state.js`
- Review-memory loading and lesson extraction: `scripts/lib/review-memory.js` -> `apps/dispatcher/dist/modules/server/review-memory.js`
- Task worktree planning and reuse rules: `scripts/lib/task-worktree.js` -> `apps/dispatcher/dist/modules/server/task-worktree.js`
- Generic worker loop bridge: `scripts/lib/worker-daemon.js` / `scripts/run-worker-daemon.js` -> `apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js`
- Review decision bridge: `scripts/lib/review-decision.js` / `scripts/submit-review-decision.js` -> `apps/dispatcher/dist/modules/server/runtime-glue-review-decision.js`

Still script-owned glue:

- dashboard HTML shell
- generic worker execution bootstrap and worker-daemon process glue
- Trae automation gateway and Trae automation worker runtime

Not part of the active runtime surface anymore:

- unreferenced `start-staging-*.sh` wrapper scripts
- the old `trigger-ai-dispatch.*` GitHub workflow trigger helper
- the old local codex drill helpers (`run-codex-control-flow.*`, `create-two-codex-drill-planner.*`, `run-dispatch-assignments.*`, `process-worker-result.*`)
- checked-in declaration stubs under `scripts/*.d.ts` and `scripts/lib/*.d.ts`

Do not assume `apps/dispatcher/src/index.ts` is the live server entry. It is not. The live process still starts from `scripts/*.js`, but the main dispatcher runtime path is no longer purely script-first.

## 3. Persistence Model

Current mainline persistence is hybrid, with SQLite now active for dispatcher runtime state and structured reads:

- Dispatcher runtime state truth source: `.forgeflow-dispatcher/runtime-state.db`
  - Default backend in `apps/dispatcher/src/modules/server/runtime-state.ts`
  - Implemented through `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
  - Uses `node:sqlite`
  - Stores both append-only snapshots and dispatcher-owned structured projection tables
- Dispatcher JSON fallback and import source: `.forgeflow-dispatcher/runtime-state.json`
  - Only used when `RUNTIME_STATE_BACKEND=json` or `--persistence-backend json` is explicitly selected
  - Also used as one-time import source when SQLite is the default but only a JSON snapshot exists
- Review memory: `.forgeflow-dispatcher/memory.json`
  - owned by `apps/dispatcher/src/modules/server/review-memory.ts`
  - accessed through the thin wrapper `scripts/lib/review-memory.js`
- Trae gateway sessions: `~/.forgeflow-trae-beta/sessions/sessions.json`
  - `scripts/lib` 和发布包默认使用同一用户级目录
  - `scripts/run-trae-automation-gateway.js --state-dir <path>` 仍可显式覆盖
- Optional Postgres / queue shadow path:
  - enabled with `DISPATCHER_SHADOW_MODE` / `DISPATCHER_POSTGRES_URL`
  - current role is shadow projection / queue shadow, not dispatcher truth source

`apps/dispatcher/src/db/schema.ts` still defines standalone SQLite schema constants, but dispatcher runtime persistence is now owned by the runtime-state SQLite backend rather than those constants directly.

## 4. Main Flows

### 4.1 Codex / Gemini flow

1. Control layer creates a dispatch payload.
2. Dispatcher records tasks, assignments, reviews, and events.
   - Each task receives a stable `traceId`.
   - Assignment ownership is guarded by dispatcher lease acquisition.
3. Worker daemon registers and heartbeats against dispatcher.
4. Worker daemon claims an assigned task or a ready task in its pool.
5. Worker daemon creates a per-task worktree from the latest fetched default branch.
6. Worker executes assignment scripts inside the worktree.
7. Worker reports verification results, changed files, and optional PR metadata back to dispatcher.
8. Worker may additionally report best-effort runtime events such as delivery failure, cleanup failure, session interruption, and structured failure codes back to dispatcher metrics.
9. Dispatcher moves the task to `review` or `failed`.
10. Control layer submits `merge` or `block`.

### 4.2 Trae unattended flow

1. Dispatcher exposes Trae-specific worker endpoints under `/api/trae/*`.
2. Trae automation worker registers and fetches tasks from dispatcher.
3. Dispatcher computes task-specific worktree and assignment directories for the Trae worker.
   - The task payload also carries the stable dispatcher `trace_id`.
4. Trae automation worker calls the local automation gateway.
5. Automation gateway drives Trae, tracks session state, and returns the final response.
6. Trae automation worker reports structured phase events plus `traceId` / `sessionId` / `failureCode` hints back to dispatcher.
7. Trae automation worker submits `review_ready` or `failed` back to dispatcher.
8. Dispatcher maps those statuses to `review` or `failed`.

### 4.3 Rework continuation flow

1. A task reaches `review`.
2. Control layer blocks it with rework notes.
3. `worker-review-orchestrator-cli redrive` can now redrive either:
   - `failed`
   - `blocked` with latest review decision `rework`
4. The new task is created with:
   - `continuationMode = "continue"`
   - `continueFromTaskId = <original task id>`
5. Trae workers only reuse chat/session when that explicit continuation directive is present.
6. Rework notes are injected into the continuation task prompt/context so the worker can continue on the original thread with current review guidance.

## 5. Review and Merge Boundary

Dispatcher owns task/review state transitions.

Current review states verified in code:

- worker states: `idle`, `busy`, `offline`
- task states: `ready`, `assigned`, `in_progress`, `review`, `merged`, `failed`, `blocked`
- assignment state also uses `pending` before a worker is bound

Current stage-3 ownership additions:

- runtime state now includes `leases[]`
- 当前活跃 lease resource type 包含 `assignment`、`repo`、`branch`、`session`
- task 被 worker claim 后会同时获取 assignment / repo / branch lease；continuation 或 follow-up 任务还会获取 session lease，释放任务时同步释放这些资源
- reconcile may reclaim expired leases and emit audit events
- read paths can prefer structured projection when `DISPATCHER_STRUCTURED_READS=1`
- write paths can be blocked by `DISPATCHER_READ_ONLY_MODE=1` for dispatcher HTTP `/api` mutation methods; direct file or external database writes remain operator-controlled
- SQLite writes may best-effort shadow to Postgres / queue, but those external stores are not the primary authority yet

The control layer should not rewrite state arbitrarily. It should go through the dispatcher review flow.

## 6. What This Repo Is Not

- It is not a repo where Trae is the top-level scheduler.
- It is not yet a fully externalized Postgres-first control plane; dispatcher now has a query-first SQLite projection and optional Postgres / queue shadow path, but SQLite snapshots remain the truth source.
- It is not a single-service API with one uniform response envelope.
- It is not a complete knowledge-base system; review memory is selective injection, not a general long-term memory layer.

## 7. Document Boundaries

- Workflow rules stay in `../AGENTS.md`.
- Document navigation stays in `README.md`.
- Tactical module guidance should live in local module `README.md` files.
- Historical material belongs under `archive/`, not in the active docs path.

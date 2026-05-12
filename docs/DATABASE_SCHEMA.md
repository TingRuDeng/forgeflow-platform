# forgeflow-platform Database Schema

> Verified persistence overview. Dispatcher runtime state now defaults to SQLite, but the repository still uses a hybrid persistence model rather than one fully normalized database for every subsystem.

## 目的

说明当前持久化来源、dispatcher runtime state 形态、SQLite snapshot / projection、review memory 和 Trae session store。

## 适合读者

适合修改状态字段、SQLite backend、结构化投影、shadow path、review memory、session store 或恢复流程的维护者和 AI 代理。

## 一分钟摘要

- `.forgeflow-dispatcher/runtime-state.db` 是 dispatcher 默认真相源，JSON 只是显式 fallback / import。
- `snapshots` 仍是权威 runtime snapshot，结构化表是 query projection。
- `leases[]` 当前代码层只支持 assignment resource type；repo/branch/session 并发治理尚未实现。
- Postgres / queue shadow path 是 best-effort，不是 primary store。
- `apps/dispatcher/src/db/schema.ts` 不是当前 live runtime persistence path。

```yaml
ai_summary:
  authority: "持久化来源、运行时状态集合、SQLite snapshot/projection 和 shadow 边界"
  scope: "dispatcher runtime state、review memory、Trae session store、SQLite projection、Postgres/queue shadow"
  read_when:
    - "修改 runtime state 字段或 SQLite 存储"
    - "修改 review memory、session store 或 DR 备份恢复"
    - "判断 schema 常量是否代表 live persistence"
  verify_with:
    - "apps/dispatcher/src/modules/server/runtime-state.ts"
    - "apps/dispatcher/src/modules/server/runtime-state-sqlite.ts"
    - "apps/dispatcher/src/modules/server/runtime-state-shadow.ts"
    - "scripts/lib/trae-automation-session-store.ts"
  stale_when:
    - "状态集合、SQLite 表、shadow 表、session 字段或 fallback 语义变化"
```

## 权威边界

本文件是持久化概览，不是完整数据库迁移脚本或所有字段字典。接口语义看 `API_ENDPOINTS.md`，状态转换看 `STATE_MACHINE.md`，最终字段以 runtime 代码和测试为准。

## 如何验证

- 核对 `apps/dispatcher/src/modules/server/runtime-state.ts` 的 `RuntimeState` 相关类型与状态集合。
- 核对 `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts` 的 `initDb`、`saveRuntimeState` 和 projection 表写入。
- 核对 `apps/dispatcher/src/modules/server/runtime-state-shadow.ts` 的 shadow 表和健康读取 helper。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## 1. Active Persistence Sources

Current active persistence sources verified in code:

- `.forgeflow-dispatcher/runtime-state.db`
  - Main dispatcher runtime state truth source on the default path.
- `.forgeflow-dispatcher/runtime-state.json`
  - Explicit JSON fallback and one-time SQLite import source.
- `.forgeflow-dispatcher/memory.json`
  - Review-memory lesson store.
- `.forgeflow-trae-gateway/sessions.json`
  - Session store for the script-local automation gateway.
- `~/.forgeflow-trae-beta/sessions/sessions.json`
  - Session store for the packaged remote runtime.

## 2. Dispatcher Runtime State

Dispatcher runtime state is created and loaded through `scripts/lib/dispatcher-state.js`, which bootstraps the dispatcher-owned implementation in `apps/dispatcher/src/modules/server/runtime-state.ts`.

Default backend:

- `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
  - file: `.forgeflow-dispatcher/runtime-state.db`
  - engine: `node:sqlite`

Explicit fallback backend:

- `apps/dispatcher/src/modules/server/runtime-state-json.ts`
  - file: `.forgeflow-dispatcher/runtime-state.json`
  - selected only when `RUNTIME_STATE_BACKEND=json` or `--persistence-backend json`

Top-level collections currently include:

- `workers`
- `tasks`
- `taskAttempts`
- `artifactBundles`
- `events`
- `assignments`
- `reviews`
- `pullRequests`
- `dispatches`
- `leases`

`events` 当前除了 `created` / `status_changed` / `assignment_claimed` / `review_decided` / `progress_reported` 外，还会承载主链指标事件，例如：

- `submit_result_retry_failed`
- `attempt_expired`
- `task_redriven`
- `delivery_failed`
- `worktree_cleanup_failed`
- `session_interrupted`
- `state_lock_timeout`

当前事件记录还会保留最小关联字段：

- `summary`
- `payload.traceId`
- `payload.sessionId`
- `payload.failureCode`

Supporting metadata:

- `version`
- `updatedAt`
- `sequence`

时间字段说明：

- dispatcher state、review memory、task ledger、local CLI state、session store 现在统一写 ISO 8601 字符串，并显式携带本地时区偏移，例如 `2026-04-04T23:15:00.000+08:00`
- 历史数据中已有的 UTC `Z` 时间戳继续兼容读取与排序，不要求迁移

### 2.1 Workers

Verified core worker fields include:

- `id`
- `pool`
- `hostname`
- `labels`
- `repoDir`
- `status`
- `lastHeartbeatAt`
- `currentTaskId`

### 2.2 Tasks

Verified core task fields include:

- `id`
- `externalTaskId`
- `repo`
- `defaultBranch`
- `title`
- `pool`
- `allowedPaths`
- `acceptance`
- `dependsOn`
- `branchName`
- `targetWorkerId`
- `chatMode`
- `continuationMode`
- `continueFromTaskId`
- `verification`
- `traceId`
- `status`
- `assignedWorkerId`
- `lastAssignedWorkerId`
- `requestedBy`
- `createdAt`

当前调度语义补充：

- `dependsOn` 不再只是持久化字段
- 带依赖的任务初始保持 `planned`
- 依赖任务全部进入 `merged` 后，dispatcher 才会把该任务自动解锁到 `ready`

### 2.3 Assignments

Assignment records wrap the assignment package plus dispatcher tracking metadata:

- `taskId`
- `workerId`
- `pool`
- `status`
- `assignment`
- `workerPrompt`
- `contextMarkdown`
- `workerPromptMode`
- `reportSchemaVersion`
- `assignedAt`
- `claimedAt`
- `traceId`
- `continuationMode` / `continueFromTaskId` / `chatMode` inside `assignment`

### 2.4 Reviews and PR metadata

Reviews track dispatcher-side review state:

- `taskId`
- `decision`
- `actor`
- `notes`
- `decidedAt`
- `reviewMaterial`
- `latestWorkerResult`
- `evidence`

`latestWorkerResult` is now dispatcher-canonicalized. The following fields are derived from dispatcher task / assignment truth, not blindly trusted from worker payload:

- `latestWorkerResult.taskId`
- `latestWorkerResult.workerId`
- `latestWorkerResult.pool`
- `latestWorkerResult.repo`
- `latestWorkerResult.defaultBranch`
- `latestWorkerResult.branchName`
- `latestWorkerResult.mode`

Current additive review-side structured fields:

- `latestWorkerResult.evidence`
  - `failureType`
  - `failureSummary`
  - `blockers[]`
  - `findings[]`
  - `artifacts`
- `evidence`
  - `reasonCode`
  - `mustFix[]`
  - `canRedrive`
  - `redriveStrategy`

`reviewMaterial` is retained after a final review decision so the control layer keeps the original review snapshot alongside the structured evidence.

Pull request records track review-side Git metadata:

- `taskId`
- `number`
- `url`
- `headBranch`
- `baseBranch`
- `title`
- `status`
- `createdAt`
- `updatedAt`

### 2.5 Leases

Stage-3 runtime ownership is now persisted in `leases[]`.

Verified core lease fields include:

- `id`
- `resourceType`
- `resourceId`
- `ownerId`
- `ownerToken`
- `acquiredAt`
- `renewedAt`
- `expiresAt`
- `releasedAt`
- `reclaimReason`
- `metadata`

当前 schema-level resource types：

- `assignment`

Current enforced ownership path verified in code:

- `assignment`

`session` / `repo` / `branch` are present in the shared lease type, SQLite projection and metrics aggregation, but current `runtime-state.ts` acquisition / release helpers only wire assignment lease into task execution paths.

## 3. Review Memory Store

`memory.json` is owned by `apps/dispatcher/src/modules/server/review-memory.ts` and accessed through the thin wrapper `scripts/lib/review-memory.js`.

Verified top-level shape:

- `version`
- `lessons`
- `updated_at`

Each lesson stores source metadata and injection matching hints, including:

- `id`
- `source_type`
- `source_task_id`
- `source_worker_type`
- `repo`
- `scope`
- `category`
- `rule`
- `rationale`
- `trigger_paths`
- `trigger_tags`
- `severity`
- `created_at`

This is a selective lesson store for context injection, not a general-purpose knowledge base.

## 4. Trae Session Store

Both gateway implementations use `sessions.json`, but the default storage root differs:

- script-local gateway: relative `.forgeflow-trae-gateway/`
- packaged runtime gateway: user-stable `~/.forgeflow-trae-beta/sessions/`

Verified session fields include:

- `sessionId`
- `status`
- `startedAt`
- `lastActivityAt`
- `updatedAt`
- `responseDetected`
- `error`
- `responseText`
- `requestFingerprint`
- `target`
- `completedAt`

Verified status values:

- `prepared`
- `running`
- `completed`
- `failed`
- `interrupted`

## 5. Dispatcher SQLite Snapshot Schema

The active runtime SQLite backend currently uses an append-only snapshot schema in `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`:

- `metadata`
  - generic key/value table
- `snapshots`
  - append-only authoritative runtime snapshots
  - columns:
    - `revision` (`INTEGER PRIMARY KEY AUTOINCREMENT`)
    - `data` (`TEXT`)
    - `checksum_sha256` (`TEXT`)
    - `created_at` (`TEXT`)

Stage-3 query-first projection tables now also live in the same SQLite file:

- `workers`
- `tasks`
- `assignments`
- `task_attempts`
- `artifact_bundles`
- `reviews`
- `pull_requests`
- `dispatches`
- `runtime_events`
- `leases`
- `sessions`

Current role of those tables:

- they are dispatcher-owned structured projections
- they support `/api/query/*`, structured reads, and projection health checks
- `task_attempts` 保存 vNext synthetic attempt projection，authoritative truth 仍以 snapshot 的 `taskAttempts[]` 为准
- `artifact_bundles` 保存 vNext ArtifactBundle 摘要和 refs projection，不保存 diff / log 正文
- they do not replace `snapshots` as the runtime truth source

Current stage-3 optional shadow path:

- environment:
  - `DISPATCHER_SHADOW_MODE`
  - `DISPATCHER_POSTGRES_URL`
  - `DISPATCHER_QUEUE_SHADOW_MODE`
- shadow tables currently include:
  - `dispatcher_workers`
  - `dispatcher_tasks`
  - `dispatcher_assignments`
  - `dispatcher_reviews`
  - `dispatcher_events`
  - `dispatcher_leases`
- assignment delivery queue shadow is stored separately through the queue shadow adapter

Current shadow semantics:

- SQLite remains the authority
- Postgres / queue writes are best-effort shadow projection
- drift should be detected through projection health first; `readRuntimeStateShadowHealth()` exists in code, but current `/api/dr/status` does not expose shadow counts yet

This is intentionally not a fully normalized operational schema. The current design optimizes for:

- revision history for audit / rescue
- checksum validation to detect silent corruption
- WAL mode for safer concurrent read/write behavior
- transactional snapshot persistence
- file-backed SQLite correctness
- simple JSON import from `runtime-state.json`

Recovery semantics:

- runtime-state.db 读取失败时默认 fail-closed
- 只有显式设置 `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1` 且 `runtime-state.json` 存在时，才允许走 JSON 救援导入

`apps/dispatcher/src/db/schema.ts` still contains additional SQLite schema constants, but those constants are not the active dispatcher runtime persistence path.

## 6. What To Update When Persistence Changes

Update this document when you change:

- dispatcher state collections or key fields
- review-memory lesson shape
- session-store fields or default storage paths
- dispatcher backend defaults, JSON fallback behavior, or JSON-to-SQLite import behavior
- lease fields or resource ownership semantics
- SQLite structured projection tables or shadow store behavior

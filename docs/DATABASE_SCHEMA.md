# forgeflow-platform Database Schema

> Verified persistence overview. Dispatcher runtime state now defaults to SQLite, but the repository still uses a hybrid persistence model rather than one fully normalized database for every subsystem.

## 目的

说明当前持久化来源、dispatcher runtime state 形态、SQLite snapshot / projection、review memory 和 Trae session store。

## 适合读者

适合修改状态字段、SQLite backend、结构化投影、shadow path、review memory、session store 或恢复流程的维护者和 AI 代理。

## 一分钟摘要

- `.forgeflow-dispatcher/runtime-state.db` 是 dispatcher 默认真相源，JSON 只是显式 fallback / import。
- `snapshots` 仍是权威 runtime snapshot，结构化表是 query projection。
- runtime state 只保留最近 500 条事件窗口；SQLite/PostgreSQL 另有 append-only audit table 保存可分页历史。
- `leases[]` 当前支持 `assignment`、`repo`、`branch`、`session` resource type；dispatcher 管理的 task 生命周期会获取并释放对应资源。
- Postgres / queue shadow path 是 best-effort，不是 primary store。
- live SQLite schema ownership is in `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`; standalone dispatcher schema constants are not kept.

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
- `~/.forgeflow-trae-beta/sessions/sessions.json`
  - Session store for both the script-local automation gateway and the packaged remote runtime by default.

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
- `task_interrupted`
- `task_resumed`
- `delivery_failed`
- `worktree_cleanup_failed`
- `session_interrupted`
- `state_lock_timeout`
- `review_risk_flagged`
- `dispatch_quality_flagged`
- `review_merge_risk_acknowledged`

当前事件记录还会保留最小关联字段：

- `eventId`（dispatcher 生成的稳定事件 ID）
- `auditSequence`（从 durable audit 表读取时附带的分页序列）
- `summary`
- `payload.traceId`
- `payload.sessionId`
- `payload.failureCode`

Supporting metadata:

- `version`
- `updatedAt`
- `sequence`
- `eventSequence`

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
- `riskAssessment`

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
- `riskAssessment`
  - `level`（`low` / `needs_human_attention` / `too_large_for_auto_review`）
  - `changedFileCount`
  - `maxChangedFiles`
  - `protectedPathHits[]`（`pattern` 与命中的 `files`）
  - `reasons[]`
  - 由 dispatcher 在任务进入 `review` 时确定性计算，并持久化到 `reviews.risk_assessment_json`（SQLite 结构化投影列）。

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
- `repo`
- `branch`
- `session`

Current enforced ownership path verified in code:

- `assignment`
- `repo`
- `branch`
- `session`（仅 continuation 或 follow-up 任务存在会话锚点时）

`runtime-state.ts` task claim 会获取 `assignment` / `repo` / `branch` lease；存在 `continueFromTaskId` 或 `followUpOfTaskId` 时还会获取 `session` lease。释放路径覆盖 result、cancel、review decision、worker offline 和 reconcile 回收。该约束不覆盖 dispatcher 外部直接操作同一 repo、branch 或 Trae session store 的脚本。

HITL interrupt/resume 字段：

- `tasks.waiting_for_input_json` 保存 `waitingForInput`，包括 requestedBy、reason、requestedAt
- `tasks.resume_payload_json` 保存 resume 时写入的 `resumePayload`
- `waiting_for_input` 是非终态任务状态；resume 后任务回到 `ready`

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

Both gateway implementations use `sessions.json` and default to the same user-stable storage root:

- script-local gateway: `~/.forgeflow-trae-beta/sessions/`
- packaged runtime gateway: `~/.forgeflow-trae-beta/sessions/`
- script-local gateway can still override the directory with `--state-dir <path>`
- local writers serialize through `sessions.json.lock`, reload the latest file while holding that lock, and publish with a process-unique temporary file plus rename
- malformed JSON fails closed instead of being replaced by an empty store

The lock protects one local state directory from lost updates. It is not a distributed lease and does not make multiple active gateways safe; gateway startup still marks persisted non-terminal sessions as `interrupted`.

Lock timing can be adjusted with `FORGEFLOW_TRAE_SESSION_LOCK_TIMEOUT_MS`, `FORGEFLOW_TRAE_SESSION_LOCK_RETRY_MS`, and `FORGEFLOW_TRAE_SESSION_LOCK_STALE_MS`.

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
- `runtime_audit_events`
- `leases`
- `sessions`

Current role of those tables:

- they are dispatcher-owned structured projections
- they support `/api/query/*`, structured reads, and projection health checks
- `task_attempts` 保存 vNext synthetic attempt projection，authoritative truth 仍以 snapshot 的 `taskAttempts[]` 为准
- `artifact_bundles` 保存 vNext ArtifactBundle 摘要、refs projection、`trajectory_json` 和可选 retained diff / log / test result / trajectory 正文片段
- `runtime_events` 只保存 runtime snapshot 当前保留的最近 500 条事件投影
- `runtime_audit_events` 按 `event_id` 幂等追加完整历史，`sequence` 是分页游标；`/api/query/events` 优先读取该表
- they do not replace `snapshots` as the runtime truth source

每次 SQLite 状态写入在同一个 `BEGIN IMMEDIATE` transaction 内完成三件事：

1. 追加带 checksum 的权威 snapshot。
2. 按 `event_id` 幂等追加 `runtime_audit_events`。
3. 重写 query-first structured projection。

任一步失败都会 rollback，避免 snapshot 已推进但 projection 或 audit 未落账。

Artifact 文件正文不进入 SQLite 表：

- dispatcher 会把结构化报告、`trajectory` 或 `retainedContent.trajectory`，以及 `retainedContent.diff`、`retainedContent.logs`、`retainedContent.testResults` 写入 `${stateDir}/artifacts/<bundle-dir>/`
- 每个 bundle 目录包含 `manifest.json`，用于登记可读取的文件名、ref 和字节数
- 当前生成文件名为 `result.json`、`diff.patch`、`session.log`、`test-results.txt`、`trajectory.json` 和 `trajectory.traj`（按实际内容存在）
- 本地 artifact store 的 bundle retention 由 `DISPATCHER_ARTIFACT_RETENTION_MAX_BUNDLES` 控制，默认 100
- retention 删除 bundle 目录时，同一次 dispatcher 状态写入会同步移除对应 `artifactBundles[]` / SQLite projection 索引；bundle metadata 读取本身不要求当前节点持有本地 manifest，避免 Postgres 多节点读取被本机文件系统错误过滤
- SQLite `artifact_bundles.refs_json` 保存指向这些文件的 `artifact://<bundleId>/<fileName>` 引用

PostgreSQL primary backend 使用 `dispatcher_runtime_audit_events` 保存同类 append-only 审计记录。primary snapshot 与新审计事件在同一个 PostgreSQL transaction 内提交；查询同样使用 `audit_sequence` 做 `beforeSequence` 分页。

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
- shadow write status is persisted separately in `runtime-state-shadow-status.json`; automatic reconciliation status is persisted in `shadow-reconciler-status.json`; both are operational health records, not runtime truth sources
- drift should be checked through `scripts/check-shadow-drift.mjs <stateDir>` before shadow rollout or cutover decisions; `/api/dr/status` stays focused on lightweight DR posture, shadow write health, and the latest reconciler status file
- `scripts/check-shadow-drift.mjs <stateDir> --reconcile` replays SQLite truth into the configured shadow path, and `--record-alert` can append `shadow_drift_detected` to runtime events

This is intentionally not a fully normalized operational schema. The current design optimizes for:

- revision history for rescue plus append-only runtime audit events
- checksum validation to detect silent corruption
- WAL mode for safer concurrent read/write behavior
- transactional snapshot / audit / projection persistence
- file-backed SQLite correctness
- simple JSON import from `runtime-state.json`

Recovery semantics:

- runtime-state.db 读取失败时默认 fail-closed
- 只有显式设置 `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1` 且 `runtime-state.json` 存在时，才允许走 JSON 救援导入

Standalone dispatcher SQLite schema constants have been removed. Runtime schema changes must be made in `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts` with matching round-trip tests.

## 6. What To Update When Persistence Changes

Update this document when you change:

- dispatcher state collections or key fields
- review-memory lesson shape
- session-store fields or default storage paths
- dispatcher backend defaults, JSON fallback behavior, or JSON-to-SQLite import behavior
- lease fields or resource ownership semantics
- SQLite structured projection tables or shadow store behavior

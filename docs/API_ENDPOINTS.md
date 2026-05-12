# forgeflow-platform API Endpoints

> Verified HTTP surface overview for the current live runtime. This is not a field-complete contract catalog. For exact payload semantics, keep using `docs/contracts/*` and the live code.

## 目的

概览 dispatcher server 与 Trae automation gateway 的当前 HTTP 接口面、响应形态差异和已验证边界。

## 适合读者

适合修改 HTTP 路由、CLI client、console 调用、worker runtime 回写或接口文档的维护者和 AI 代理。

## 一分钟摘要

- dispatcher 和 Trae automation gateway 是两套不同 HTTP 面，不共享统一响应 envelope。
- dispatcher 鉴权、read-only、structured reads 和 shadow mode 都在 server/runtime 层体现。
- generic worker claim 已是 `POST /api/workers/:workerId/claim-task`，`GET assigned-task` 只读。
- 本文件是接口概览，不是完整字段字典；精确契约看 `docs/contracts/*` 和测试。
- read-only 模式会默认冻结 `/api` 下所有写方法，避免新增写路由遗漏手写 matcher。

```yaml
ai_summary:
  authority: "dispatcher 与 Trae automation gateway 的已验证 HTTP 接口概览"
  scope: "路由职责、认证、response shape、worker/review/Trae/query/SLO/DR 接口边界"
  read_when:
    - "新增或修改 HTTP 路由"
    - "修改 worker runtime、CLI 或 console 的 API 调用"
    - "判断 dispatcher 与 automation gateway 是否可共用 envelope"
  verify_with:
    - "apps/dispatcher/src/modules/server/dispatcher-server.ts:handleDispatcherHttpRequest"
    - "apps/dispatcher/src/modules/server/dispatcher-server.ts:startDispatcherServer"
    - "apps/dispatcher/tests/modules/server/dispatcher-server.test.ts"
    - "packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts"
  stale_when:
    - "HTTP 路由、鉴权、请求校验、响应 envelope 或 gateway 实现发生变化"
```

## 权威边界

本文件只描述已验证接口概览；字段级契约以 `docs/contracts/*` 和真实代码为准。状态转换看 `STATE_MACHINE.md`，持久化字段看 `DATABASE_SCHEMA.md`。

## 如何验证

- 核对 `apps/dispatcher/src/modules/server/dispatcher-server.ts:handleDispatcherHttpRequest` 的路由分支。
- 核对 `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts` 的接口测试。
- 核对 `scripts/lib/trae-automation-gateway.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 的 gateway 路由差异。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## Scope

This document covers the HTTP surfaces that were verified directly in code:

- dispatcher server entry in `scripts/lib/dispatcher-server.js`
- dispatcher TypeScript Trae route foundation in `apps/dispatcher/src/modules/server/runtime-dispatcher-server.ts`
- Trae automation gateway in `scripts/lib/trae-automation-gateway.js`
- packaged Trae automation gateway in `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts`

It does not catalog CLI flags, GitHub workflow inputs, or every internal assignment field.

## 1. Dispatcher Server

Base role: task state, worker coordination, review decisions, dashboard snapshot.

### Authentication

The dispatcher server supports three authentication modes controlled by the `DISPATCHER_AUTH_MODE` environment variable:

- **Environment variables**:
  - `DISPATCHER_AUTH_MODE`: One of `token`, `legacy`, or `open` (default: `token`)
  - `DISPATCHER_API_TOKEN`: The token to use for authentication (required in `token` mode)

- **Auth modes**:
  - `token` (default): All endpoints except `/health` require `Authorization: Bearer <DISPATCHER_API_TOKEN>` header. Returns `500` if `DISPATCHER_API_TOKEN` is not set.
  - `legacy`: When `DISPATCHER_API_TOKEN` is not set, only loopback addresses (127.0.0.1, ::1, ::ffff:127.0.0.1) can access endpoints without authentication. When set, requires `Authorization: Bearer <token>` header for all endpoints except `/health`.
  - `open`: All endpoints are accessible without authentication. Useful for local development.

- **Whitelist**: `/health` endpoint is always accessible without authentication in all modes.
- **Authentication failure**: Returns `401` status code with `{ "error": "unauthorized" }` JSON response

### State lock

Dispatcher 当前会在状态目录下维护 `.runtime-state.lock`，状态型 endpoint 共用同一把文件锁。

- Lock env:
  - `DISPATCHER_STATE_LOCK_TIMEOUT_MS` (default `2000`)
  - `DISPATCHER_STATE_LOCK_RETRY_MS` (default `25`)
  - `DISPATCHER_STATE_LOCK_STALE_MS` (default `30000`)
- Lock timeout response:
  - `503` with `{ "error": "state lock timeout after ...: <lock-path>" }`
- Caller expectation:
  - 把它当作暂时性竞争错误并重试，不要误判成认证或 payload 问题

Current endpoint families:

- `GET /health`
  - Liveness probe.
  - Current payload also includes:
    - `readOnly`
    - `structuredReads`
- `GET /dashboard`
  - HTML dashboard view.
  - Current GET response sets `Cache-Control: no-store`.
- `GET /api/dashboard/snapshot`
  - 返回 workers、tasks、taskAttempts、artifactBundles、assignments、reviews、PRs、recent events 和 stats 的 JSON snapshot。
  - Current GET response sets `Cache-Control: no-store`.
  - Snapshot now also includes minimum control-plane metrics:
    - `metrics.queueDepth`
    - `metrics.plannedTasks`
    - `metrics.reviewBacklog`
    - `metrics.avgAssignmentLagMs`
    - `metrics.maxAssignmentLagMs`
    - `metrics.retryRatePct`
    - `metrics.branchProtectionHitCount`
    - `metrics.repoConcurrencySaturation`
    - `metrics.failureCodes`
    - `metrics.reviewReasonCodes`
  - Current task/event correlation additions:
    - tasks now carry stable `traceId`
    - recent events may include derived `summary`
    - `taskAttempts` 和 `artifactBundles` 可被 Console 任务详情用于渲染 attempt timeline 与 artifact summary
- `GET /api/metrics`
  - Returns a small control-plane metrics document for automation, dashboards, and alerts.
  - Current GET response sets `Cache-Control: no-store`.
  - Current payload includes:
    - `updatedAt`
    - `queueDepth`
    - `plannedTasks`
    - `reviewBacklog`
    - `avgAssignmentLagMs`
    - `maxAssignmentLagMs`
    - `retryRatePct`
    - `submitResultRetryCount`
    - `deliveryFailedCount`
    - `cleanupFailureCount`
    - `sessionInterruptionCount`
    - `stateLockTimeoutCount`
    - `leaseConflictCount`
    - `leaseReclaimCount`
    - `activeLeases`
    - `branchProtectionHitCount`
    - `repoConcurrencySaturation`
    - `failureCodes`
    - `reviewReasonCodes`
    - `workers`
    - `tasks`
- `GET /api/workers`
  - Returns worker list from the current snapshot.
  - Current GET response sets `Cache-Control: no-store`.
- `GET /api/leases`
  - Returns the current reconciled lease list from dispatcher runtime state.
  - Current GET response sets `Cache-Control: no-store`.
- `GET /api/query/tasks`
  - Returns structured task projection rows from the SQLite query store.
- `GET /api/query/events`
  - Returns structured event projection rows from the SQLite query store.
- `GET /api/query/reviews`
  - Returns structured review projection rows from the SQLite query store.
- `GET /api/query/leases`
  - Returns structured lease projection rows from the SQLite query store.
- `GET /api/query/artifacts`
  - Returns structured ArtifactBundle projection rows from the SQLite query store.
- `GET /api/query/dashboard-snapshot`
  - Builds dashboard snapshot from the structured query store path.
- `GET /api/query/projection-health`
  - Compares snapshot-derived counts with the SQLite structured projection tables.
- `GET /api/artifacts/:bundleId`
  - Returns one persisted ArtifactBundle by `bundleId`.
  - Returns `404 artifact_not_found` when the bundle is unknown.
- `GET /api/slo`
  - Returns stage-3 SLO targets, live indicators, and burn-rate reasons.
  - Current thresholds are controlled by:
    - `DISPATCHER_SLO_MAX_QUEUE_DEPTH`
    - `DISPATCHER_SLO_MAX_REVIEW_BACKLOG`
    - `DISPATCHER_SLO_MAX_ASSIGNMENT_LAG_MS`
    - `DISPATCHER_SLO_MAX_DELIVERY_FAILED`
    - `DISPATCHER_SLO_MAX_LEASE_CONFLICTS`
- `GET /api/dr/status`
  - Returns current DR posture summary.
  - Current payload includes:
    - `readOnly`
    - `structuredReads`
    - `shadowMode`
    - `projectionHealth`
    - `backups`

### Structured reads, read-only, and shadow modes

- `DISPATCHER_STRUCTURED_READS=1`
  - Makes dispatcher prefer the SQLite structured query store for:
    - `/api/dashboard/snapshot`
    - `/api/metrics`
    - `/api/workers`
- `DISPATCHER_READ_ONLY_MODE=1`
  - Keeps query endpoints available while rejecting `/api` write methods with:
    - HTTP `503`
    - `{ "error": "dispatcher is in read-only mode", "code": "read_only_mode" }`
  - Write methods are `POST` / `PUT` / `PATCH` / `DELETE`; `GET` query routes remain available.
- `DISPATCHER_SHADOW_MODE=shadow-write`
- `DISPATCHER_POSTGRES_URL=postgres://...`
- `DISPATCHER_QUEUE_SHADOW_MODE=shadow-write`
  - Enable best-effort Postgres / queue shadow projection.
  - SQLite remains the main runtime truth source.

### Generic worker endpoints

- `POST /api/workers/register`
  - Register or refresh a generic worker.
- `POST /api/workers/:workerId/heartbeat`
  - Update worker heartbeat.
- `POST /api/workers/:workerId/offline`
  - Best-effort operator/runtime path to mark a worker `offline` immediately instead of waiting for heartbeat lease expiry.
  - Current request body may include:
    - `at`
    - `reason`
  - Current mainline callers:
    - `forgeflow-trae-beta stop worker`
    - `forgeflow-trae-beta restart worker`
    - `forgeflow-trae-beta stop all`
    - `forgeflow-trae-beta restart all`
- `GET /api/workers/:workerId/assigned-task`
  - Read-only lookup for the task currently bound to that worker.
  - Current GET response sets `Cache-Control: no-store`.
- `POST /api/workers/:workerId/claim-task`
  - The only generic worker claim path.
  - May return an already assigned task for that worker, or atomically claim a `ready` task from the same pool.
  - Tasks whose `dependsOn` prerequisites are not yet merged stay in `planned` and are excluded until dispatcher unlocks them to `ready`.
  - Assignment claim is now also guarded by dispatcher lease ownership; conflicting claims are recorded as `lease_conflict` audit events.
  - Reclaimed retry tasks create the next `TaskAttempt` when they are claimed again, preserving expired attempt history.
- `POST /api/workers/:workerId/start-task`
  - Move task from `assigned` to `in_progress`.
- `POST /api/workers/:workerId/result`
  - Submit execution result, changed files, and optional PR metadata.
  - Caller should only treat the task as durably delivered after this endpoint returns success; `worker-daemon` no longer treats exhausted submission retries as a completed task.
  - Worker execution now uses a child-process env allowlist; do not assume parent-side secrets such as `GITHUB_TOKEN` or `DISPATCHER_API_TOKEN` are visible inside the assignment process.
  - Dispatcher now canonicalizes dispatcher-owned fields:
    - `taskId`
    - `workerId`
    - `pool`
    - `repo`
    - `defaultBranch`
    - `branchName`
    - `mode`
  - Dispatcher will reject mismatched worker metadata with `409`.
  - Dispatcher will reject stale result writes with `409` when the payload carries a terminal historical `attemptId`.
  - Request-body validation now rejects malformed result payloads with `400`.
  - `result` may now include additive structured worker evidence for dispatcher persistence:
    - `failureType`
    - `failureSummary`
    - `blockers[]`
    - `findings[]`
    - `artifacts`
  - `artifactBundle` may be provided as a top-level field; dispatcher validates ownership against the active attempt and stores the bundle summary / refs.
- `POST /api/workers/:workerId/events`
  - Best-effort worker telemetry path for control-plane metrics and audit hints.
  - Current request body validates:
    - `type` required, non-empty string
    - `taskId` optional string
    - `at` optional string
    - `payload` optional object or primitive
  - Current mainline producers include:
    - `submit_result_retry_failed`
    - `attempt_expired`
    - `task_redriven`
    - `delivery_failed`
    - `worktree_cleanup_failed`
    - `session_interrupted`
    - Trae runtime phase events such as `fetch_task_start`, `prepare_session_done`, `artifact_check_failed`, `submit_result_done`
  - Current producer payloads commonly carry:
    - `traceId`
    - `sessionId`
    - `failureCode`
    - `message`

### Dispatch and review endpoints

- `POST /api/dispatches`
  - Create a dispatch, task records, assignment records, and initial review placeholders.
  - Review-memory injection may mutate assignment context during this call.
  - Task payloads can also carry continuation metadata such as `continuationMode` and `continueFromTaskId`.
  - Dispatcher now assigns each task a stable `traceId` and persists it into the assignment package.
  - Assignment packages may additionally persist prompt metadata such as:
    - `workerPromptMode`
    - `reportSchemaVersion`
- `POST /api/reviews/:taskId/decision`
  - 提交 `merge`、`block`、`rework` 或 `changes_requested`。
  - `merge` 会把任务从 `review` 推进到 `merged`。
  - `block` / `rework` / `changes_requested` 都会把任务从 `review` 推进到 `blocked`，但 dispatcher 会保留原始 review decision 供审计和 redrive 使用。
  - Request body 必须是 JSON object，并校验：
    - `actor` 必填，非空字符串
    - `decision` 必填 enum
    - `notes` 可选字符串
    - `evidence` 可选 object
  - 结构化决策证据可放在 `evidence` 内，也可直接作为顶层便捷字段提交；顶层字段会归一化写入 `review.evidence`：
    - `reasonCode`
    - `mustFix[]`
    - `canRedrive`
    - `redriveStrategy`
  - 标准 `reasonCode` 包括 `looks_good`、`tests_passed`、`minor_fix_needed`、`incomplete_implementation`、`test_failure`、`policy_violation`、`security_risk`、`unclear_diff`、`requires_pairing`、`needs_redrive`、`other`；旧版自定义字符串仍兼容。
  - 最新 review decision 为 `rework` 或 `changes_requested` 的 blocked 任务可由 orchestrator CLI redrive。
  - 任务或 assignment 不存在时返回 `404`。
  - 任务存在但不在 `review` 状态时返回 `409`。
- `POST /api/tasks/:taskId/cancel`
  - Explicitly move a non-terminal task to `cancelled`.
  - Current request body may include:
    - `actor`
    - `reason`
    - `at`
  - Current dispatcher behavior:
    - rejects `merged` / `failed` / invalid-task transitions with `409`
    - returns `404` when the task or assignment does not exist
    - frees the bound worker when the task was still assigned or running
    - appends both `status_changed` and `task_cancelled` events

### Trae-specific dispatcher endpoints

- `POST /api/trae/register`
  - Register a Trae worker with `worker_id` and `repo_dir`.
- `POST /api/trae/fetch-task`
  - Fetch an assigned or ready Trae task, including task goal, scope, constraints, worktree/assignment directories, and Trae execution metadata.
  - Current task payload can include:
    - `chat_mode`
    - `continuation_mode`
    - `continue_from_task_id`
    - `trace_id`
    - `worker_prompt_mode`
    - `report_schema_version`
- `POST /api/trae/start-task`
  - Mark Trae task as started.
- `POST /api/trae/report-progress`
  - Append progress events.
- `POST /api/trae/submit-result`
  - Accepts `review_ready` or `failed`, then maps to dispatcher task states.
  - `review_ready` now assumes the runtime already verified that remote branch HEAD exactly matches the reported commit SHA.
  - Packaged runtime may briefly retry remote verification after push before downgrading the report to `failed`.
  - Delivery evidence may include a remote-verified push state plus `remoteHeadSha`.
  - Dispatcher now rebuilds canonical worker result metadata for Trae too; route-local payload no longer overrides dispatcher-owned task identity fields.
  - Failure evidence may now carry structured blocker codes such as:
    - `workspace_prepare_failed`
    - `worktree_mismatch`
    - `branch_mismatch`
    - `preflight_workspace_mismatch`
    - `transient_gateway_timeout`
    - `transient_model_3003`
    - `artifact_remote_unverified`
    - `prompt_contract_mismatch`
- `POST /api/trae/heartbeat`
  - Heartbeat endpoint for Trae workers.

## 2. Trae Automation Gateway

Base role: local automation bridge for the Trae desktop client.

Common verified endpoints across both gateway implementations:

- `GET /ready`
  - Readiness and target-discovery probe.
- `GET /v1/sessions/:sessionId`
  - Return current session state from the session store.
- `POST /v1/sessions/prepare`
  - Prepare a reusable session and optional session id.
- `POST /v1/chat`
  - Send prompt content to the automation driver and return the final response.
  - In `new_chat` flows, the packaged runtime now scopes baseline sampling to the last visible chat root and may fail early when the baseline still exposes a different completed task id.

### Current implementation divergence

The packaged runtime gateway adds one endpoint that the `scripts/lib/` gateway does not currently expose:

- `POST /v1/sessions/:sessionId/release`
  - Present in `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts`
  - Not present in `scripts/lib/trae-automation-gateway.js`

Do not assume the two gateway implementations are API-identical.

## 3. Response Shape Differences

Dispatcher does not use one uniform envelope.

Examples:

- snapshot endpoints return direct JSON objects
- worker mutation endpoints often return `{ status, ... }`
- some Trae endpoints return `{ ok: true }`
- not-found/error paths often return `{ error: ... }`
- malformed JSON on POST now returns `400` with `{ error: "invalid_json_body" }`

Trae automation gateway uses a different envelope:

- success: `{ success: true, code: "OK", data: ... }`
- failure: `{ success: false, code, message, details }`

Do not normalize these by assumption in docs or client code. Check the actual endpoint family first.

## 4. Coverage Notes

- This file is a verified endpoint overview, not a complete request/response schema dump.
- Dispatcher and automation gateway are separate HTTP surfaces and should stay separated in future docs.
- If either server adds new endpoints, update this file and the related contract docs in the same task.

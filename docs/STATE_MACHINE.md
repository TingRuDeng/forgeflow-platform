# Dispatcher State Machine

This document is the current implementation-oriented summary of dispatcher task flow. For API shapes, see `API_ENDPOINTS.md`. For persisted fields, see `DATABASE_SCHEMA.md`.

## 目的

说明 dispatcher task、assignment、review、continuation、worker result 和 dashboard metrics 的当前状态语义。

## 适合读者

适合修改任务状态机、worker claim/start/result、review decision、redrive/continuation 或控制层摘要的维护者和 AI 代理。

## 一分钟摘要

- `planned -> ready -> assigned -> in_progress -> review -> merged` 是主线成功流。
- `in_progress` 的 active attempt lease 过期且 worker 离线时，reconcile 会按最小 retry policy 自动 redrive 或失败。
- `failed`、`blocked`、`cancelled` 有不同 redrive / follow-up 语义，不能混用。
- generic worker claim 只能通过 `POST /api/workers/:workerId/claim-task` 产生副作用。
- worker result 中 dispatcher-owned metadata 会被 canonicalize，worker 不能覆盖。
- 本文件描述状态语义，字段持久化看 `DATABASE_SCHEMA.md`。

```yaml
ai_summary:
  authority: "dispatcher 状态机、review decision、continuation 和 worker result canonicalization 摘要"
  scope: "task/assignment/review 状态、redrive 条件、follow-up 语义和阶段二 metrics"
  read_when:
    - "修改任务状态流转或 review decision"
    - "修复 redrive、continuation、claim 或 result 回写问题"
    - "判断 failed、blocked、cancelled 是否可继续"
  verify_with:
    - "apps/dispatcher/src/modules/server/runtime-state.ts"
    - "apps/dispatcher/tests/modules/server/runtime-state.test.ts"
    - "apps/dispatcher/tests/modules/server/dispatcher-server.test.ts"
    - "packages/worker-review-orchestrator-cli/src/redrive.ts"
  stale_when:
    - "新增任务状态、assignment 状态、review decision 或 redrive 规则"
```

## 权威边界

本文件只描述状态语义，不替代 `API_ENDPOINTS.md` 的 HTTP 路由说明或 `DATABASE_SCHEMA.md` 的字段说明。最终状态转换以 `runtime-state.ts` 和测试为准。

## 如何验证

- 核对 `apps/dispatcher/src/modules/server/runtime-state.ts` 中的 claim、begin、record result、review decision 和 cancel 函数。
- 核对 `packages/worker-review-orchestrator-cli/src/redrive.ts` 的 redrive 判断。
- 运行 `pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts`。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## Task States

`planned -> ready -> assigned -> in_progress -> review -> merged`

Terminal or branch states:

- `review -> blocked`
- `assigned|in_progress -> failed`
- `ready|assigned|in_progress|review|blocked -> cancelled`
- `in_progress -> awaiting_retry -> ready` 目前只作为 runtime event 审计语义落账，不是持久化 `TaskStatus` 枚举值。

Current rules:

- `dependsOn` is active. Tasks with unresolved dependencies enter `planned`, not `ready`.
- Reconcile unlocks `planned -> ready` only after every dependency task reaches `merged`.
- `GET /api/workers/:workerId/assigned-task` is read-only.
- `POST /api/workers/:workerId/claim-task` is the only generic worker claim path.
- Claim may either:
  - return an already assigned task for that worker
  - or atomically select a `ready` task for that worker pool and move it to `assigned`
- Reconcile now scans active running attempts. If `leaseExpiresAt` has passed and the owning worker is offline:
  - dispatcher marks the current attempt as `expired` with `failureCode = attempt_lease_expired`
  - if attempts are still below the default max of 2, dispatcher records `attempt_expired` and `task_redriven`, releases worker / assignment ownership, and moves the task back to `ready`
  - if attempts are exhausted, dispatcher records `attempt_expired` and moves task / assignment to `failed`
- A late worker result that still carries an expired / terminal `attemptId` is rejected before it can mutate task, assignment, review, artifact, or worker state.

## Assignment States

`pending -> assigned -> in_progress -> review|blocked|failed|merged|cancelled`

Current rules:

- Assignment state follows task state.
- `assignedAt` is written on dispatcher-side assignment.
- `claimedAt` is written only by the explicit claim path.
- Trae fetch/start now converges through the same dispatcher authority rules instead of mutating ad hoc route-local state.

## Dispatch Quality Gate

`createDispatch` now applies a deterministic server-side quality gate to every task at creation time, instead of relying only on a dispatch-time prompt checklist. The gate is configurable via env:

- `DISPATCHER_DISPATCH_QUALITY_MODE` — `off` / `warn` (default) / `enforce`.
- `DISPATCHER_DISPATCH_REQUIRE_ACCEPTANCE` — require ≥1 acceptance criterion (default `true`).
- `DISPATCHER_DISPATCH_REQUIRE_ALLOWED_PATHS` — require a bounded `allowedPaths` scope (default `true`).
- Sensitive-tier detection reuses `DISPATCHER_REVIEW_PROTECTED_PATHS`.

Trait-style behavior: a task whose `allowedPaths` intersect protected globs is graded `sensitive` and automatically requires acceptance even when the global flag is off, and must not ship with a catch-all-only scope (`**`, `*`, `.`).

Modes:

- `off` — no grading.
- `warn` — task is still created, but dispatcher appends a `dispatch_quality_flagged` event carrying `mode`, `riskTier` and `violations[]` when the task has violations or is sensitive.
- `enforce` — `createDispatch` throws before creating the task when there are blocking violations (`missing_acceptance`, `missing_allowed_paths`, `unbounded_scope_sensitive`).

## Review Decisions

Supported decisions:

- `merge`
- `block`
- `rework`
- `changes_requested`

### Deterministic risk grading on review entry

When a worker result passes verification and the task moves `in_progress -> review`, dispatcher attaches a deterministic, explainable risk grade to the review (`review.riskAssessment`). There is no LLM judge; grading is a pure function of the result's `changedFiles` plus configurable thresholds:

- `low` — no protected path touched and within the changed-file budget; the only auto-merge-eligible grade.
- `needs_human_attention` — at least one changed file matches a protected-path glob (default set covers `auth`, `payments`, `migrations`, `infra`, `.github/workflows`, and secret/credential/permission-like files).
- `too_large_for_auto_review` — changed-file count exceeds the budget (default `50`).

Configuration (env, read at result time):

- `DISPATCHER_REVIEW_PROTECTED_PATHS` — comma-separated glob list; an explicitly empty value disables the protected-path gate.
- `DISPATCHER_REVIEW_MAX_CHANGED_FILES` — positive integer file budget.

When the grade is not `low`, dispatcher appends a `review_risk_flagged` event carrying `level`, `changedFileCount`, `maxChangedFiles`, `protectedPathHits` and `reasons`. The grade is informational: it does not block the control layer's decision, but it surfaces in the dashboard snapshot reviews and is preserved through the final review decision.

### Server-side merge risk gate

`recordReviewDecision` applies an authoritative merge gate (covers Console, CLI, and direct HTTP), configured via `DISPATCHER_REVIEW_MERGE_GATE`:

- `off` (default) — no gate; behavior unchanged.
- `warn` — a `merge` on a non-`low` review proceeds, but dispatcher appends a `review_merge_risk_acknowledged` audit event.
- `enforce` — a `merge` on a non-`low` review is rejected unless the decision carries `acknowledgeRisk: true` (HTTP body `acknowledgeRisk` or `acknowledge_risk`); the rejection surfaces as `409` over HTTP. With acknowledgement the merge proceeds and the audit event is recorded.

The CLI `decide --acknowledge-risk` forwards the flag to the dispatcher so the server gate honors it. Only `merge` is gated; `block` / `rework` / `changes_requested` are never gated.

Current mapping:

- `merge` moves `review -> merged`
- `block` moves `review -> blocked`
- `rework` moves `review -> blocked`, while preserving `decision = rework` for audit and redrive
- `changes_requested` moves `review -> blocked`, while preserving `decision = changes_requested` for audit and redrive

Redriveability:

- `failed` tasks may be redriven by failure policy
- `blocked` tasks are only redriveable when latest review decision is `rework` or `changes_requested` and review evidence does not disable redrive
- `cancelled` is terminal and not redriveable in-place; follow-up or fresh dispatch should create a new task id

## Continuation And Follow-up

Current dispatcher-side semantics:

- `blocked + rework -> continuation` is an explicit protocol, not an implicit retry
- continuation metadata is persisted through:
  - `continuationMode`
  - `continueFromTaskId`
- follow-up tasks may carry:
  - `followUpOfTaskId`
  - `workerChangeReason`
- sticky-worker reuse is only valid when the source task already has a verifiable remote branch artifact and worker continuity is still legitimate

## Worker Result Canonicalization

Worker-submitted result payloads are no longer authoritative for dispatcher-owned metadata.

Dispatcher now canonicalizes:

- `taskId`
- `workerId`
- `pool`
- `repo`
- `defaultBranch`
- `branchName`
- `mode`

Dispatcher may reject mismatched worker metadata with `409`, for example:

- wrong `repo`
- wrong `defaultBranch`
- wrong `branchName`
- wrong `workerId`
- wrong PR head/base branch pair

Worker-owned payload remains:

- `output`
- `generatedAt`
- `verification`
- `evidence`

Current worker evidence may additionally carry structured blocker `code`s. Current control-plane redrive policy prefers those explicit codes, then falls back to legacy text-pattern matching for older history.

## Snapshot Metrics

`buildDashboardSnapshot()` now exports minimum stage-two control-plane metrics:

- `metrics.queueDepth`
- `metrics.plannedTasks`
- `metrics.reviewBacklog`
- `metrics.avgAssignmentLagMs`
- `metrics.maxAssignmentLagMs`

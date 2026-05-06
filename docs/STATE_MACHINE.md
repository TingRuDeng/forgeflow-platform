# Dispatcher State Machine

This document is the current implementation-oriented summary of dispatcher task flow. For API shapes, see `API_ENDPOINTS.md`. For persisted fields, see `DATABASE_SCHEMA.md`.

## 目的

说明 dispatcher task、assignment、review、continuation、worker result 和 dashboard metrics 的当前状态语义。

## 适合读者

适合修改任务状态机、worker claim/start/result、review decision、redrive/continuation 或控制层摘要的维护者和 AI 代理。

## 一分钟摘要

- `planned -> ready -> assigned -> in_progress -> review -> merged` 是主线成功流。
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

Current rules:

- `dependsOn` is active. Tasks with unresolved dependencies enter `planned`, not `ready`.
- Reconcile unlocks `planned -> ready` only after every dependency task reaches `merged`.
- `GET /api/workers/:workerId/assigned-task` is read-only.
- `POST /api/workers/:workerId/claim-task` is the only generic worker claim path.
- Claim may either:
  - return an already assigned task for that worker
  - or atomically select a `ready` task for that worker pool and move it to `assigned`

## Assignment States

`pending -> assigned -> in_progress -> review|blocked|failed|merged|cancelled`

Current rules:

- Assignment state follows task state.
- `assignedAt` is written on dispatcher-side assignment.
- `claimedAt` is written only by the explicit claim path.
- Trae fetch/start now converges through the same dispatcher authority rules instead of mutating ad hoc route-local state.

## Review Decisions

Supported decisions:

- `merge`
- `block`
- `rework`
- `changes_requested`

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

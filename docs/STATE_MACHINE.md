# Dispatcher State Machine

This document is the current implementation-oriented summary of dispatcher task flow. For API shapes, see `API_ENDPOINTS.md`. For persisted fields, see `DATABASE_SCHEMA.md`.

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

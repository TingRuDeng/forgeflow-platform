# ForgeFlow API Endpoints

> Verified HTTP surface overview for the current live runtime. This is not a field-complete contract catalog. For exact payload semantics, keep using `docs/contracts/*` and the live code.

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

The dispatcher server supports optional token-based authentication:

- **Environment variable**: `DISPATCHER_API_TOKEN`
- **Behavior**:
  - When not set: all endpoints are accessible without authentication (backward compatible)
  - When set: requires `Authorization: Bearer <token>` header for all endpoints except `/health`
  - Authentication failure returns `401` status code with `{ "error": "unauthorized" }` JSON response
- **Whitelist**: `/health` endpoint is always accessible without authentication

Current endpoint families:

- `GET /health`
  - Liveness probe.
- `GET /dashboard`
  - HTML dashboard view.
- `GET /api/dashboard/snapshot`
  - Returns a JSON snapshot of workers, tasks, assignments, reviews, PRs, recent events, and stats.
- `GET /api/workers`
  - Returns worker list from the current snapshot.

### Generic worker endpoints

- `POST /api/workers/register`
  - Register or refresh a generic worker.
- `POST /api/workers/:workerId/heartbeat`
  - Update worker heartbeat.
- `GET /api/workers/:workerId/assigned-task`
  - Claim an assigned task or pick a `ready` task for that worker pool.
- `POST /api/workers/:workerId/start-task`
  - Move task from `assigned` to `in_progress`.
- `POST /api/workers/:workerId/result`
  - Submit execution result, changed files, and optional PR metadata.

### Dispatch and review endpoints

- `POST /api/dispatches`
  - Create a dispatch, task records, assignment records, and initial review placeholders.
  - Review-memory injection may mutate assignment context during this call.
  - Task payloads can also carry continuation metadata such as `continuationMode` and `continueFromTaskId`.
- `POST /api/reviews/:taskId/decision`
  - Submit `merge` or `block` and move task from `review` to `merged` or `blocked`.

### Trae-specific dispatcher endpoints

- `POST /api/trae/register`
  - Register a Trae worker with `worker_id` and `repo_dir`.
- `POST /api/trae/fetch-task`
  - Fetch an assigned or ready Trae task, including task goal, scope, constraints, worktree/assignment directories, and Trae execution metadata.
  - Current task payload can include:
    - `chat_mode`
    - `continuation_mode`
    - `continue_from_task_id`
- `POST /api/trae/start-task`
  - Mark Trae task as started.
- `POST /api/trae/report-progress`
  - Append progress events.
- `POST /api/trae/submit-result`
  - Accepts `review_ready` or `failed`, then maps to dispatcher task states.
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

Trae automation gateway uses a different envelope:

- success: `{ success: true, code: "OK", data: ... }`
- failure: `{ success: false, code, message, details }`

Do not normalize these by assumption in docs or client code. Check the actual endpoint family first.

## 4. Coverage Notes

- This file is a verified endpoint overview, not a complete request/response schema dump.
- Dispatcher and automation gateway are separate HTTP surfaces and should stay separated in future docs.
- If either server adds new endpoints, update this file and the related contract docs in the same task.

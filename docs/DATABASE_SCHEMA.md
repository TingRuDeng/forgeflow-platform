# forgeflow-platform Database Schema

> Verified persistence overview. Dispatcher runtime state now defaults to SQLite, but the repository still uses a hybrid persistence model rather than one fully normalized database for every subsystem.

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

Dispatcher runtime state is created and loaded through `scripts/lib/dispatcher-state.js`, which bridges into `apps/dispatcher/src/modules/server/runtime-state.ts`.

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
- `events`
- `assignments`
- `reviews`
- `pullRequests`
- `dispatches`

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
- `status`
- `assignedWorkerId`
- `lastAssignedWorkerId`
- `requestedBy`
- `createdAt`

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

## 3. Review Memory Store

`memory.json` is loaded in `scripts/lib/review-memory.js`.

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

The active runtime SQLite backend currently uses a minimal snapshot schema in `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`:

- `metadata`
  - generic key/value table
- `snapshots`
  - single authoritative runtime snapshot row
  - stores serialized dispatcher state JSON plus `updated_at`

This is intentionally not a fully normalized operational schema. The current design optimizes for:

- transactional snapshot persistence
- file-backed SQLite correctness
- simple JSON import from `runtime-state.json`

`apps/dispatcher/src/db/schema.ts` still contains additional SQLite schema constants, but those constants are not the active dispatcher runtime persistence path.

## 6. What To Update When Persistence Changes

Update this document when you change:

- dispatcher state collections or key fields
- review-memory lesson shape
- session-store fields or default storage paths
- dispatcher backend defaults, JSON fallback behavior, or JSON-to-SQLite import behavior

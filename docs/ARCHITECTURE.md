# forgeflow-platform Architecture

> Verified overview of the current main path. This is not a full code catalog. Facts below were checked against the live script entrypoints under `scripts/lib/`, the dispatcher TypeScript foundations under `apps/dispatcher/src/`, and the packaged Trae runtime under `packages/trae-beta-runtime/src/`.

## 1. System Shape

forgeflow-platform is a control-plane repository for multi-agent development, not a single monolithic application.

Current active building blocks:

- `dispatcher`
  - Current truth source for task state, worker state, assignments, reviews, PR metadata, and audit events.
  - Active runtime entry still lives in `scripts/lib/dispatcher-server.js`.
  - Trae-specific dispatcher route handling is now bridged into the TypeScript runtime foundation under `apps/dispatcher/dist/modules/server/runtime-dispatcher-server.js`.
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
- the dispatcher TypeScript foundation now owns major runtime logic under `apps/dispatcher/src/modules/server/`
- current live bridges import built output from `apps/dispatcher/dist/`

Verified bridge points:

- HTTP dispatcher server Trae route handling: `scripts/lib/dispatcher-server.js` -> `apps/dispatcher/dist/modules/server/runtime-dispatcher-server.js`
- Dispatcher state machine: `scripts/lib/dispatcher-state.js` -> `apps/dispatcher/dist/modules/server/runtime-state.js`
- Generic worker loop bridge: `scripts/lib/worker-daemon.js` / `scripts/run-worker-daemon.js` -> `apps/dispatcher/dist/modules/server/runtime-glue-dispatcher-client.js`
- Review decision bridge: `scripts/lib/review-decision.js` / `scripts/submit-review-decision.js` -> `apps/dispatcher/dist/modules/server/runtime-glue-review-decision.js`

Still script-owned glue:

- task worktree materialization
- review-memory injection
- dashboard HTML shell
- Trae automation gateway and Trae automation worker runtime

Do not assume `apps/dispatcher/src/index.ts` is the live server entry. It is not. The live process still starts from `scripts/*.js`, but the main dispatcher runtime path is no longer purely script-first.

## 3. Persistence Model

Current mainline persistence is hybrid, with SQLite now active for dispatcher runtime state:

- Dispatcher runtime state truth source: `.forgeflow-dispatcher/runtime-state.db`
  - Default backend in `apps/dispatcher/src/modules/server/runtime-state.ts`
  - Implemented through `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
  - Uses `node:sqlite`
- Dispatcher JSON fallback and import source: `.forgeflow-dispatcher/runtime-state.json`
  - Only used when `RUNTIME_STATE_BACKEND=json` or `--persistence-backend json` is explicitly selected
  - Also used as one-time import source when SQLite is the default but only a JSON snapshot exists
- Review memory: `.forgeflow-dispatcher/memory.json`
- Script-local Trae gateway sessions: `.forgeflow-trae-gateway/sessions.json`
- Packaged Trae runtime sessions: `~/.forgeflow-trae-beta/sessions/sessions.json`

`apps/dispatcher/src/db/schema.ts` still defines standalone SQLite schema constants, but dispatcher runtime persistence is now owned by the runtime-state SQLite backend rather than those constants directly.

## 4. Main Flows

### 4.1 Codex / Gemini flow

1. Control layer creates a dispatch payload.
2. Dispatcher records tasks, assignments, reviews, and events.
3. Worker daemon registers and heartbeats against dispatcher.
4. Worker daemon claims an assigned task or a ready task in its pool.
5. Worker daemon creates a per-task worktree from the latest fetched default branch.
6. Worker executes assignment scripts inside the worktree.
7. Worker reports verification results, changed files, and optional PR metadata back to dispatcher.
8. Dispatcher moves the task to `review` or `failed`.
9. Control layer submits `merge` or `block`.

### 4.2 Trae unattended flow

1. Dispatcher exposes Trae-specific worker endpoints under `/api/trae/*`.
2. Trae automation worker registers and fetches tasks from dispatcher.
3. Dispatcher computes task-specific worktree and assignment directories for the Trae worker.
4. Trae automation worker calls the local automation gateway.
5. Automation gateway drives Trae, tracks session state, and returns the final response.
6. Trae automation worker submits `review_ready` or `failed` back to dispatcher.
7. Dispatcher maps those statuses to `review` or `failed`.

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

The control layer should not rewrite state arbitrarily. It should go through the dispatcher review flow.

## 6. What This Repo Is Not

- It is not a repo where Trae is the top-level scheduler.
- It is not a fully relational, query-first database-centric control plane; dispatcher uses SQLite as the default runtime state backend, but still persists review memory and several worker-side stores as JSON files.
- It is not a single-service API with one uniform response envelope.
- It is not a complete knowledge-base system; review memory is selective injection, not a general long-term memory layer.

## 7. Document Boundaries

- Workflow rules stay in `../AGENTS.md`.
- Document navigation stays in `README.md`.
- Tactical module guidance should live in local module `README.md` files.
- Historical material belongs under `archive/`, not in the active docs path.

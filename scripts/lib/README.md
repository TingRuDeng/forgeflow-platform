# Runtime Scripts Guide

## Owns

`scripts/lib/` is the live entry-adapter and runtime-glue layer for ForgeFlow's active execution path.

This directory contains the code that actually wires together:

- dispatcher HTTP handling
- dispatcher runtime state loading/saving and live bridges
- worker-daemon loops
- task worktree creation
- review-memory injection
- Trae automation gateway and worker behavior

Top-level `scripts/*.js` files are mostly thin CLI wrappers around this directory.

Several mainline dispatcher paths are now bridged into `apps/dispatcher/dist` rather than being implemented only here:

- `dispatcher-server.js` bridges Trae route handling to `runtime-dispatcher-server.js`
- `dispatcher-state.js` bridges state transitions to `runtime-state.js`
- `worker-daemon.js` bridges dispatcher client glue to `runtime-glue-dispatcher-client.js`
- `review-decision.js` bridges review submission logic to `runtime-glue-review-decision.js`

## High-Value Entry Files

- `dispatcher-server.js`
  - dispatcher HTTP surface and dashboard
- `dispatcher-state.js`
  - authoritative state transitions for tasks, workers, assignments, reviews, PR metadata, and events
- `worker-daemon.js`
  - unattended worker loop for `codex` and `gemini`
- `task-worktree.js`
  - fetches default branch and creates per-task worktrees
- `review-memory.js`
  - lesson extraction and selective context injection
- `trae-automation-gateway.js`
  - local HTTP bridge for Trae automation
- `trae-automation-worker.js`
  - dispatcher-facing unattended Trae worker

## Change Ripple

Changes here usually require checking:

- `../../README.md`
- `../../docs/ARCHITECTURE.md`
- `../../docs/API_ENDPOINTS.md`
- `../../docs/DATABASE_SCHEMA.md`
- `../../docs/KNOWN_PITFALLS.md`
- `../../apps/dispatcher/README.md`
- `../../packages/trae-beta-runtime/`

## Local Traps

- Generic worker endpoints and Trae endpoints share dispatcher state but not identical payload shapes.
- Trae automation gateway in this directory is not perfectly identical to the packaged runtime implementation.
- Worktree creation is strict and will fail fast on fetch/ref problems.
- Dispatcher runtime state now defaults to SQLite through the TS bridge, with JSON only as explicit fallback/import; do not document the script layer as owning a separate DB-first state model.
- Dispatcher bridge code must not assume a pre-existing `apps/dispatcher/dist` is fresh.

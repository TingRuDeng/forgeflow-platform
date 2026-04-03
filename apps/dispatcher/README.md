# Dispatcher Module Guide

## Owns

`apps/dispatcher/` owns the reusable dispatcher-side domain code, TypeScript runtime foundations, and dispatcher-focused tests in this repository.

Current verified contents:

- dispatcher domain services under `src/modules/*`
- dispatcher runtime foundations under `src/modules/server/*`
- schema constants under `src/db/schema.ts`
- dispatcher-focused tests under `tests/modules/*`

## Does Not Own Alone

Do not assume this package alone is the live runtime entry.

Current live entry adapters are still under:

- `../../scripts/lib/dispatcher-server.js`
- `../../scripts/lib/dispatcher-state.js`
- `../../scripts/lib/worker-daemon.js`
- `../../scripts/lib/review-decision.js`

Current live bridges import built output from `apps/dispatcher/dist`, so behavior changes may require checking:

- source in `apps/dispatcher/src/modules/server/*`
- tests in `apps/dispatcher/tests/modules/server/*`
- live adapters in `scripts/lib/*`

## Local Map

- `src/modules/dispatch/`
  - worker selection and ready-task assignment helpers
- `src/modules/tasks/`
  - task domain transitions
- `src/modules/workers/`
  - worker registry/status helpers
- `src/modules/events/`
  - task event handling
- `src/modules/review/`
  - review-side domain logic
- `src/modules/runtime/`
  - worker assignment payload shaping and runtime adapters
- `src/db/schema.ts`
  - SQLite schema constants, but not the active runtime snapshot backend

## Change Ripple

Changing dispatcher state semantics usually ripples into:

- `../../scripts/lib/dispatcher-state.js`
- `../../scripts/lib/dispatcher-server.js`
- `../../scripts/lib/worker-daemon.js`
- `../../scripts/lib/review-decision.js`
- `../../packages/worker-review-orchestrator-cli/`
- `../../docs/ARCHITECTURE.md`
- `../../docs/API_ENDPOINTS.md`
- `../../docs/DATABASE_SCHEMA.md`

## Non-Negotiable Constraints

- Do not treat SQLite schema constants as proof of the active runtime persistence path; the current default runtime backend is `runtime-state-sqlite.ts`, with JSON only as explicit fallback/import.
- Do not change task/worker statuses casually; review dispatcher-state transitions first.
- If runtime behavior changes, update docs in the same task or explicitly record `no doc impact`.

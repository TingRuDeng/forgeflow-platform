# Local Time Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record new project timestamps in the current local timezone offset instead of forcing UTC `Z`, while keeping historical UTC records readable and correctly ordered.

**Architecture:** Add narrow timezone-aware timestamp helpers inside each active boundary that currently writes UTC strings (`apps/dispatcher`, `scripts/lib`, selected workspace packages). Update ordering logic to compare parsed timestamps rather than raw strings so mixed historical `Z` and new `+08:00` records remain stable. Leave persisted historical data untouched.

**Tech Stack:** TypeScript, Node.js `Date`, Vitest, existing dispatcher runtime state modules

---

### Task 1: Lock behavior with failing dispatcher tests

**Files:**
- Modify: `apps/dispatcher/tests/modules/server/runtime-state.test.ts`
- Modify: `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts`

- [ ] **Step 1: Add a dispatcher runtime-state test that expects new records to carry a local offset instead of trailing `Z`**

Add assertions around a newly created task/event/worker timestamp so the test expects a value like `+08:00` and rejects `Z`.

- [ ] **Step 2: Add a mixed-format ordering test**

Add a test where one worker/task uses a historical UTC timestamp and another uses a local-offset timestamp representing a later instant; assert the runtime picks the chronologically older/newer record by parsed time, not lexical order.

- [ ] **Step 3: Run targeted dispatcher tests and confirm RED**

Run: `pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts`

Expected: failures around timezone suffix and/or timestamp ordering.

### Task 2: Implement local-offset timestamps inside dispatcher runtime

**Files:**
- Create: `apps/dispatcher/src/modules/server/time.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state-json.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-dispatcher-server.ts`
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-glue-dispatcher-client.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-glue-worker-daemon-cycle.ts`
- Modify: `apps/dispatcher/src/modules/dispatch/service.ts`

- [ ] **Step 1: Add dispatcher-local time helpers**

Implement a helper that formats `Date` as local ISO with explicit offset and a helper that compares timestamp strings by `Date.parse`.

- [ ] **Step 2: Replace dispatcher `toISOString()` writers with the local-offset helper**

Update `nowIso()` style functions and any direct timestamp creation in dispatcher runtime paths.

- [ ] **Step 3: Replace lexical timestamp sorts with parsed-time compares**

Update worker/task selection logic to use parsed timestamps so mixed persisted formats remain safe.

- [ ] **Step 4: Re-run targeted dispatcher tests and confirm GREEN**

Run: `pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts`

Expected: pass.

### Task 3: Extend the change to script-written records

**Files:**
- Create: `scripts/lib/time.ts`
- Modify: `scripts/lib/time.js`
- Modify: `scripts/lib/review-memory.ts`
- Modify: `scripts/lib/review-memory.js`
- Modify: `scripts/lib/worker-daemon.ts`
- Modify: `scripts/lib/worker-daemon.js`
- Modify: `scripts/lib/trae-automation-session-store.ts`
- Modify: `scripts/lib/trae-automation-session-store.js`
- Modify: `scripts/run-worker-assignment.ts`
- Modify: `scripts/run-worker-assignment.js`

- [ ] **Step 1: Add a script-side local time helper**

Create a helper mirroring dispatcher formatting/comparison behavior for script entrypoints that persist local state.

- [ ] **Step 2: Swap script-side UTC writes to local-offset writes**

Update review memory, worker daemon heartbeats, worker assignment ledgers, and session-store timestamps.

- [ ] **Step 3: Run focused script-adjacent tests**

Run: `pnpm --filter @forgeflow/dispatcher test tests/modules/server/review-memory.test.ts tests/modules/server/run-worker-daemon.test.ts tests/modules/server/trae-automation-session-store.test.ts`

Expected: pass with local-offset timestamps.

### Task 4: Update local CLI/package recorders and ordering

**Files:**
- Create: `packages/worker-review-orchestrator-cli/src/time.ts`
- Modify: `packages/worker-review-orchestrator-cli/src/http.ts`
- Modify: `packages/worker-review-orchestrator-cli/src/decide.ts`
- Modify: `packages/worker-review-orchestrator-cli/src/redrive.ts`
- Create: `packages/task-decomposer/src/time.ts`
- Modify: `packages/task-decomposer/src/index.ts`

- [ ] **Step 1: Add package-local time helpers**

Keep helper ownership local to each publishable package instead of importing from repo scripts.

- [ ] **Step 2: Replace package UTC writes and lexical ordering**

Update local runtime-state writes, decision timestamps, redrive review ordering, and task ledger `generatedAt`.

- [ ] **Step 3: Run focused package tests**

Run: `pnpm --filter @tingrudeng/worker-review-orchestrator-cli test`

Run: `pnpm --filter @forgeflow/task-decomposer test`

Expected: pass.

### Task 5: Final verification and doc sync

**Files:**
- Modify: `README.md` only if user-facing behavior or expected timestamp format is documented
- Modify: `docs/onboarding.md` only if startup/inspection examples need explicit timezone wording

- [ ] **Step 1: Decide whether docs need updates**

Check active docs for claims that project timestamps are UTC or examples that would become misleading.

- [ ] **Step 2: Run full required verification**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `git diff --check`

Expected: all pass.

- [ ] **Step 3: Summarize doc impact**

If no active docs need changes, record `no doc impact` with the reason that only runtime timestamp recording/ordering changed without startup, protocol, or onboarding changes.

# Trae Prompt Contract And Session Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Trae dispatch prompts auto-rendered and contract-validated, persist the rendered prompt metadata, and stop `new_chat` from sampling stale prior-task content.

**Architecture:** Tighten the control-plane side first by generating and validating the final Trae prompt in `worker-review-orchestrator-cli`, then persist prompt metadata through dispatcher assignments, then narrow Trae DOM sampling and add a lightweight stale-task guard in runtime. Keep all changes additive to the existing dispatcher state machine and Trae worker flow.

**Tech Stack:** TypeScript, Vitest, dispatcher runtime-state, worker-review-orchestrator-cli, Trae DOM driver

---

### Task 1: CLI Prompt Rendering And Contract Validation

**Files:**
- Modify: `packages/worker-review-orchestrator-cli/src/types.ts`
- Modify: `packages/worker-review-orchestrator-cli/src/dispatch.ts`
- Test: `packages/worker-review-orchestrator-cli/tests/dispatch.test.ts`

- [ ] Add `workerPromptMode` and `reportSchemaVersion` to `DispatchTaskInputOptions` and pass them through payload assembly.
- [ ] Implement a Trae-only prompt builder in `dispatch.ts` that appends a standard final report template when `pool === "trae"` and no custom prompt is provided.
- [ ] Implement a Trae-only custom prompt validator that throws before dispatch if the final prompt is missing any of: `任务完成`, `结果`, `任务ID`.
- [ ] Make `buildSingleTaskDispatchInput()` choose between:
  - custom prompt from file / inline + validation
  - auto-rendered Trae prompt + auto `workerPromptMode = "auto"`
  - existing fallback behavior for non-Trae pools
- [ ] Add tests for:
  - Trae auto prompt includes the final report template and `任务ID`
  - custom Trae prompt missing `任务ID` throws
  - valid custom Trae prompt passes
  - non-Trae pools are unaffected

### Task 2: Dispatcher Assignment Metadata Persistence

**Files:**
- Modify: `apps/dispatcher/src/modules/server/runtime-state.ts`
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- Test: `apps/dispatcher/tests/modules/server/runtime-state.test.ts`

- [ ] Extend `Assignment` and `CreateDispatchInput.packages[]` with optional `workerPromptMode` and `reportSchemaVersion`.
- [ ] Preserve these fields when `createDispatch()` copies package data into assignment records.
- [ ] Ensure dispatcher HTTP normalization for `/api/dispatches` passes through the new optional fields without breaking existing callers.
- [ ] Add runtime-state tests that a dispatch package containing rendered prompt metadata persists it into assignments.
- [ ] Add a test that legacy dispatch payloads without the new fields still succeed.

### Task 3: Trae DOM Sampling Boundary Narrowing

**Files:**
- Modify: `packages/trae-beta-runtime/src/runtime/trae-dom-driver.ts`
- Test: `packages/trae-beta-runtime/tests/runtime/trae-dom-driver.test.ts`

- [ ] Extend browser-side snapshot helpers so response/activity capture can optionally limit queries to a resolved root element instead of global `document`.
- [ ] In `sendPrompt()`, after `prepareSession(new_chat)`, resolve a narrower active chat root and use it for baseline and response snapshots when available.
- [ ] Keep the implementation additive: if no suitable root can be found, fall back to current behavior rather than breaking execution.
- [ ] Add DOM-driver tests showing that root-limited snapshots exclude stale text outside the selected root.
- [ ] Add a regression test ensuring existing extraction behavior still works when no root is provided.

### Task 4: Lightweight Stale Task Guard And Runtime Tests

**Files:**
- Modify: `packages/trae-beta-runtime/src/runtime/trae-dom-driver.ts`
- Modify: `packages/trae-beta-runtime/src/runtime/worker.ts`
- Test: `packages/trae-beta-runtime/tests/runtime/trae-dom-driver.test.ts`
- Test: `packages/trae-beta-runtime/tests/runtime/worker.test.ts`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `packages/worker-review-orchestrator-cli/README.md`
- Modify: `packages/trae-beta-runtime/README.md`

- [ ] Add a lightweight stale-session check after `new_chat` preparation that waits briefly, samples activity/response text, and fast-fails with `AUTOMATION_PREPARE_STALE_SESSION` if the previous task id is still being read.
- [ ] Thread the previous-task-id context from worker/runtime into the DOM driver only as needed for this guard; do not redesign the task model.
- [ ] Add DOM-driver tests that stale prior-task content triggers the new error.
- [ ] Add worker tests that stale-session preparation fails early instead of hanging on `/v1/chat`.
- [ ] Update docs to state:
  - Trae prompts are auto-rendered by CLI by default
  - custom Trae prompts must satisfy the final-report contract
  - runtime now guards against stale previous-task sampling after `new_chat`

### Verification

- [ ] Run `pnpm --filter @tingrudeng/worker-review-orchestrator-cli test tests/dispatch.test.ts`
- [ ] Run `pnpm --filter @tingrudeng/dispatcher test tests/modules/server/runtime-state.test.ts`
- [ ] Run `pnpm --filter @tingrudeng/trae-beta-runtime test tests/runtime/trae-dom-driver.test.ts tests/runtime/worker.test.ts`
- [ ] Run `pnpm test`
- [ ] Run `pnpm typecheck`
- [ ] Run `git diff --check`

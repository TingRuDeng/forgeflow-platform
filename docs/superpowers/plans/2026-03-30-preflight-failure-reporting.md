# 启动前预检失败回写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 worker 启动任务前捕获 branch / worktree / readiness 冲突，并把失败原因以结构化字段回写到现有 `failed` 结果中，方便控制层及时纠错和重试。

**Architecture:** 方案保持现有任务状态机不变，只在 `failed` 结果里增加结构化 `failure` 信息。worker 在进入正文执行前先做预检：worker 在线、gateway ready、worktree / branch 与任务一致；一旦失败，立即提交 `failed`。dispatcher 负责原样落账并展示该失败原因，契约文档同步说明字段语义。

**Tech Stack:** TypeScript, Vitest, existing forgeflow-platform dispatcher/runtime scripts, existing contract docs.

---

### Task 1: Define structured preflight failure payload and persist it through submit_result

**Files:**
- Modify: `packages/trae-beta-runtime/src/runtime/clients.ts`
- Modify: `scripts/lib/dispatcher-server.mjs`
- Modify: `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts`
- Modify: `packages/trae-beta-runtime/tests/runtime/clients.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add a client test that calls `submitResult()` with a nested `failure` object and verifies the JSON payload includes it. Add a dispatcher-server test that posts `submit-result` with `failure` metadata and asserts the resulting task event keeps the structured fields instead of dropping them.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

  Run:
  `pnpm --filter @tingrudeng/trae-beta-runtime test tests/runtime/clients.test.ts`
  `pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-server.test.ts`

  Expected: fail because `failure` is not yet accepted or persisted.

- [ ] **Step 3: Implement the minimal payload plumbing**

  Extend `submitResult()` so it accepts an optional structured `failure` object and forwards it to `/api/trae/submit-result`. Update `scripts/lib/dispatcher-server.mjs` so the submit-result handler stores `failure` in the `status_changed` event payload without changing the existing `failed` task state behavior.

- [ ] **Step 4: Re-run the targeted tests**

  Run:
  `pnpm --filter @tingrudeng/trae-beta-runtime test tests/runtime/clients.test.ts`
  `pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-server.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/trae-beta-runtime/src/runtime/clients.ts scripts/lib/dispatcher-server.mjs apps/dispatcher/tests/modules/server/dispatcher-server.test.ts packages/trae-beta-runtime/tests/runtime/clients.test.ts
  git commit -m "feat(runtime): preserve structured preflight failure details"
  ```

### Task 2: Add startup preflight checks in worker execution flow

**Files:**
- Create: `packages/trae-beta-runtime/src/runtime/preflight.ts`
- Modify: `packages/trae-beta-runtime/src/runtime/worker.ts`
- Modify: `packages/trae-beta-runtime/tests/runtime/worker.test.ts`
- Create or modify: `packages/trae-beta-runtime/tests/runtime/preflight.test.ts`

- [ ] **Step 1: Write the failing tests**

  Cover the four startup-preflight outcomes:
  - worker offline
  - gateway not ready
  - worktree mismatch
  - branch mismatch

  The tests should assert that `runOnce()` stops before prompt execution and submits a `failed` result carrying a structured `failure.code` and `failure.kind: "preflight"`.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

  Run:
  `pnpm --filter @tingrudeng/trae-beta-runtime test tests/runtime/worker.test.ts tests/runtime/preflight.test.ts`

  Expected: fail because the worker does not yet emit structured preflight failures.

- [ ] **Step 3: Implement the minimal preflight helper and worker hook**

  Add a small `preflight.ts` helper that returns a normalized result object for the current worker / gateway / worktree / branch checks. Wire `worker.ts` to call it after task workspace materialization and before `launchTrae()` / `prepareSession()` / prompt submission. Reuse the existing `failed` path and attach the structured failure payload from Task 1.

- [ ] **Step 4: Re-run the targeted tests**

  Run:
  `pnpm --filter @tingrudeng/trae-beta-runtime test tests/runtime/worker.test.ts tests/runtime/preflight.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/trae-beta-runtime/src/runtime/preflight.ts packages/trae-beta-runtime/src/runtime/worker.ts packages/trae-beta-runtime/tests/runtime/worker.test.ts packages/trae-beta-runtime/tests/runtime/preflight.test.ts
  git commit -m "feat(runtime): fail fast on startup preflight conflicts"
  ```

### Task 3: Document the new failure contract and verify the full package

**Files:**
- Modify: `docs/contracts/trae-worker-v1.md`
- Modify: `packages/trae-beta-runtime/README.md`
- Modify: `packages/trae-beta-runtime/PUBLISHING.md` if the release notes need to mention the new failure payload

- [ ] **Step 1: Write the documentation changes**

  Add a short contract section describing:
  - `failed` still remains the only failure state
  - `failure.kind = "preflight"` is a structured metadata extension
  - the supported `failure.code` values
  - how control-layer consumers should interpret them

  Mirror the minimal runtime-facing behavior in the package README so users know the worker now fails fast on startup mismatches.

- [ ] **Step 2: Run the package test and typecheck**

  Run:
  `pnpm --filter @tingrudeng/trae-beta-runtime test`
  `pnpm --filter @tingrudeng/trae-beta-runtime typecheck`
  `git diff --check`

  Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/contracts/trae-worker-v1.md packages/trae-beta-runtime/README.md packages/trae-beta-runtime/PUBLISHING.md
  git commit -m "docs(runtime): document structured preflight failure reporting"
  ```

## Completion Criteria

- Startup preflight failures are reported as `failed` with structured metadata.
- Dispatcher preserves the structured failure reason.
- Worker tests cover the offline / not-ready / worktree mismatch / branch mismatch cases.
- Contract docs explain the new failure semantics without adding a new task state.

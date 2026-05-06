# Dispatcher Module Guide

## 目的

说明 `apps/dispatcher/` 的模块职责、真实入口、修改扩散范围和本地约束。

## 适合读者

适合修改 dispatcher domain、runtime foundation、server state、review memory、task worktree 或 dispatcher 测试的维护者和 AI 代理。

## 一分钟摘要

- `apps/dispatcher/` owns dispatcher-side domain code and TypeScript runtime foundations.
- live runtime entry 仍经过 `scripts/lib/*` adapter / bootstrap。
- 修改状态、接口或持久化时必须同步检查 `scripts/lib/*`、CLI、docs 和测试。
- `src/db/schema.ts` 不是 live SQLite snapshot backend。

```yaml
ai_summary:
  authority: "apps/dispatcher 模块职责、入口、扩散范围和局部约束"
  scope: "dispatcher domain、runtime foundation、server modules、tests 和 scripts/lib bridge"
  read_when:
    - "修改 apps/dispatcher 代码前"
    - "判断 dispatcher live path 是否只在 apps/dispatcher 内"
    - "更新状态、接口、持久化或 worktree 行为"
  verify_with:
    - "src/modules/server/runtime-state.ts"
    - "src/modules/server/dispatcher-server.ts"
    - "tests/modules/server/runtime-state.test.ts"
    - "../../scripts/lib/README.md"
  stale_when:
    - "dispatcher live adapter、runtime module ownership 或测试入口变化"
```

## 权威边界

本文件只说明 `apps/dispatcher/` 局部规则，不替代仓库规则、架构文档或接口文档。全仓规则看 `../../AGENTS.md`，架构看 `../../docs/ARCHITECTURE.md`。

## 如何验证

- 核对 `src/modules/server/*` 与 `tests/modules/server/*`。
- 涉及 live adapter 时核对 `../../scripts/lib/*`。
- 运行 `pnpm --filter @forgeflow/dispatcher test` 和 `pnpm docs:validate`。

## Owns

`apps/dispatcher/` owns the reusable dispatcher-side domain code, TypeScript runtime foundations, and dispatcher-focused tests in this repository.

Current verified contents:

- dispatcher domain services under `src/modules/*`
- dispatcher runtime foundations under `src/modules/server/*`
- dispatcher-owned review-memory and task-worktree implementations under `src/modules/server/*`
- schema constants under `src/db/schema.ts`
- dispatcher-focused tests under `tests/modules/*`

## Does Not Own Alone

Do not assume this package alone is the live runtime entry.

Current live entry adapters are still under:

- `../../scripts/lib/dispatcher-server.js`
- `../../scripts/lib/dispatcher-state.js`
- `../../scripts/lib/worker-daemon.js`
- `../../scripts/lib/review-decision.js`
- `../../scripts/lib/review-memory.js`
- `../../scripts/lib/task-worktree.js`

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
- `../../scripts/lib/review-memory.js`
- `../../scripts/lib/task-worktree.js`
- `../../packages/worker-review-orchestrator-cli/`
- `../../docs/ARCHITECTURE.md`
- `../../docs/API_ENDPOINTS.md`
- `../../docs/DATABASE_SCHEMA.md`

## Non-Negotiable Constraints

- Do not treat SQLite schema constants as proof of the active runtime persistence path; the current default runtime backend is `runtime-state-sqlite.ts`, with JSON only as explicit fallback/import.
- Do not change task/worker statuses casually; review dispatcher-state transitions first.
- If runtime behavior changes, update docs in the same task or explicitly record `no doc impact`.

# Runtime Scripts Guide

## 目的

说明 `scripts/lib/` 作为 live adapter / runtime glue 层的职责、入口文件、扩散范围和局部陷阱。

## 适合读者

适合修改源码仓启动入口、dispatcher bridge、worker daemon、Trae automation gateway / worker 或脚本 glue 的维护者和 AI 代理。

## 一分钟摘要

- `scripts/lib/` 仍是源码仓 live entry-adapter，不是纯历史目录。
- 多个 dispatcher 路径会 bridge 到 `apps/dispatcher/dist`，必须检查 dist freshness 风险。
- Trae automation gateway 的脚本实现和 packaged runtime 实现不完全一致。
- 修改这里通常会扩散到 README、稳定文档、`apps/dispatcher` 和 runtime package。

```yaml
ai_summary:
  authority: "scripts/lib live adapter、runtime glue 和局部修改陷阱"
  scope: "dispatcher bridge、worker daemon、Trae automation gateway/worker、review-memory/task-worktree wrappers"
  read_when:
    - "修改 scripts/lib 或顶层 scripts 入口"
    - "排查源码仓运行路径与 apps/dispatcher 行为差异"
    - "同步 Trae gateway 脚本实现和 packaged runtime 实现"
  verify_with:
    - "dispatcher-server.ts"
    - "dispatcher-state.ts"
    - "worker-daemon.ts"
    - "trae-automation-worker.ts"
  stale_when:
    - "脚本 live entry、bridge 目标、Trae gateway 或 worker daemon 入口变化"
```

## 权威边界

本文件只说明 `scripts/lib/` 局部职责。dispatcher 状态真相源仍看 `../../apps/dispatcher/README.md` 和 `../../docs/ARCHITECTURE.md`；HTTP 面看 `../../docs/API_ENDPOINTS.md`。

## 如何验证

- 核对本目录同名 `.ts` 和 `.js` 入口是否仍对应。
- 涉及 dispatcher bridge 时核对 `../../apps/dispatcher/src/modules/server/*`。
- 涉及 Trae runtime 时核对 `../../packages/trae-beta-runtime/src/runtime/*`。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## Owns

`scripts/lib/` is the live entry-adapter and runtime-glue layer for ForgeFlow's active execution path.

This directory contains the code that actually wires together:

- dispatcher HTTP handling
- dispatcher runtime state loading/saving and live bridges
- worker-daemon loops
- thin bootstrap wrappers for dispatcher-owned review-memory and task-worktree modules
- Trae automation gateway and worker behavior

Top-level `scripts/*.js` files are mostly thin CLI wrappers around this directory.

Several mainline dispatcher paths are now bridged into `apps/dispatcher/dist` rather than being implemented only here:

- `dispatcher-server.js` bridges Trae route handling to `runtime-dispatcher-server.js`
- `dispatcher-state.js` bridges state transitions to `runtime-state.js`
- `worker-daemon.js` bridges dispatcher client glue to `runtime-glue-dispatcher-client.js`
- `review-decision.js` bridges review submission logic to `runtime-glue-review-decision.js`
- `review-memory.js` bridges lesson loading/extraction to `apps/dispatcher/dist/modules/server/review-memory.js`
- `task-worktree.js` bridges worktree planning/reuse logic to `apps/dispatcher/dist/modules/server/task-worktree.js`

## High-Value Entry Files

- `dispatcher-server.js`
  - dispatcher HTTP surface and dashboard
- `dispatcher-state.js`
  - authoritative state transitions for tasks, workers, assignments, reviews, PR metadata, and events
- `worker-daemon.js`
  - unattended worker loop for `codex` and `gemini`
- `task-worktree.js`
  - thin wrapper for dispatcher-owned worktree planning helpers
- `review-memory.js`
  - thin wrapper for dispatcher-owned lesson extraction and selective context injection
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

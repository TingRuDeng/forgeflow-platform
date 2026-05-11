# AI Context

> ForgeFlow 是 Trae-first 的多智能体协作开发控制平面；本文件帮助 AI 代理用最少上下文定位权威文档、任务入口和代码证据。

## 权威文档地图

- `../AGENTS.md`：唯一规则入口，负责分支、提交、worker、审查和验证边界。
- `README.md`：文档导航入口，负责读什么、不读什么、哪些材料非权威。
- `../README.md`：主线能力、推荐启动方式、运行入口和当前定位。
- `ARCHITECTURE.md`：系统边界、服务关系、运行时所有权和主链数据流。
- `STATE_MACHINE.md`：dispatcher task / assignment / review / continuation 状态语义。
- `API_ENDPOINTS.md`：dispatcher 与 Trae automation gateway 的已验证 HTTP 面概览。
- `DATABASE_SCHEMA.md`：SQLite snapshot、结构化投影、review memory 和 session store 事实。
- `KNOWN_PITFALLS.md`：有代码证据支撑的高风险误读点。
- `TECH_DEBT.md`：已确认仍存在的技术债和不能顺手掩盖的例外。
- `DOC_SYNC_CHECKLIST.md`：收尾时的文档同步门禁。

## 任务读取路径

- 修改 dispatcher 状态机：读 `AGENTS.md`、`README.md`、`STATE_MACHINE.md`、`API_ENDPOINTS.md`，再查 `../apps/dispatcher/src/modules/server/runtime-state.ts`。
- 修改 HTTP 接口：读 `API_ENDPOINTS.md`，再查 `../apps/dispatcher/src/modules/server/dispatcher-server.ts` 和对应测试。
- 修改持久化或 DR：读 `DATABASE_SCHEMA.md`、`runbooks/runtime-state-backup-restore-repair.md`，再查 `../apps/dispatcher/src/modules/server/runtime-state-sqlite.ts` 与 `../scripts/*runtime-state.mjs`。
- 修改 Trae 无人值守链路：读 `ARCHITECTURE.md`、`API_ENDPOINTS.md`、`KNOWN_PITFALLS.md`，再查 `../scripts/lib/trae-automation-worker.ts` 与 `../packages/trae-beta-runtime/src/`。
- 修改文档：读本文件、`README.md` 和 `DOC_SYNC_CHECKLIST.md`，改完运行 `pnpm docs:validate`。

## 关键证据入口

- `../apps/dispatcher/src/modules/server/dispatcher-server.ts:handleDispatcherHttpRequest`
- `../apps/dispatcher/src/modules/server/dispatcher-server.ts:startDispatcherServer`
- `../apps/dispatcher/src/modules/server/runtime-state.ts:claimAssignedTaskForWorker`
- `../apps/dispatcher/src/modules/server/runtime-state.ts:recordWorkerResult`
- `../apps/dispatcher/src/modules/server/runtime-state-sqlite.ts:saveRuntimeState`
- `../apps/dispatcher/src/modules/server/runtime-state-shadow.ts:syncRuntimeStateShadow`
- `../scripts/backup-runtime-state.mjs:backupRuntimeState`
- `../scripts/restore-runtime-state.mjs:restoreRuntimeState`
- `../packages/worker-review-orchestrator-cli/src/dispatch.ts`
- `../packages/trae-beta-runtime/src/runtime/worker.ts`

## 高风险误读点

- `scripts/lib/*` 仍是 live adapter / bootstrap 层，不能只改 `apps/dispatcher/src` 就假定运行入口同步。
- `leases[]` 当前代码层已收窄为 assignment-only；repo/branch/session 并发治理尚未实现。
- `DISPATCHER_READ_ONLY_MODE=1` 目前按 `isMutationRequest` 拦截，不能当成完整写冻结。
- Postgres / queue shadow path 是 best-effort；SQLite snapshot 仍是真相源。
- 源码脚本 `backup-runtime-state.mjs` / `restore-runtime-state.mjs` 使用位置参数，不等同于打包后的 `forgeflow-dispatcher backup --backup-dir` CLI。
- `plans/`、`research/`、`archive/`、`external/` 默认不是当前实现权威来源。

## Optional

- `archive/README.md`：追溯旧入口、旧 v1 手册或历史 runbook 时读取。
- `external/5、权威文档执行状态回写（2026-04-08）.md`：对照外部评审阶段状态时读取。
- `superpowers/plans/`：追溯历史执行计划时读取，不能替代当前代码和权威文档。

---
ai_summary:
  purpose: "为人类维护者和 AI 代理提供 forgeflow-platform 的最小可信上下文地图。"
  read_when:
    - "进入仓库后需要快速判断读哪些文档和代码入口。"
    - "准备修改 dispatcher、worker runtime、Trae 自动化或文档体系前。"
  source_of_truth:
    - "AGENTS.md"
    - "docs/README.md"
    - "README.md"
    - "apps/dispatcher/src/modules/server/dispatcher-server.ts"
    - "apps/dispatcher/src/modules/server/runtime-state.ts"
    - "packages/trae-beta-runtime/src/runtime/worker.ts"
  verify_with:
    - "python3 scripts/validate_docs.py . --profile generic"
    - "pnpm docs:validate"
  stale_when:
    - "主线运行入口、权威文档、dispatcher 状态机、Trae runtime 或持久化真相源变化。"
---

# AI Context

ForgeFlow 是多智能体协作开发的控制平面；`codex`/`gemini`/`trae` worker 接入并列受支持。本文件只做上下文路由，不替代规则、接口或代码事实。

## Project Snapshot

- 仓库类型：pnpm / TypeScript monorepo，核心代码在 `apps/`、`packages/`、`scripts/`。
- 当前定位：`dispatcher` 是任务、分配、状态流转和审计记录的真相源。
- 当前推荐路径：源码仓运行读 `scripts/start-control-plane.sh`；install-and-run 读 `packages/forgeflow-dispatcher/README.md`。
- Worker 定位：Trae automation gateway + Trae automation worker 是首选无人值守路径，Trae MCP worker 是 fallback。
- 持久化定位：SQLite snapshot 是当前 runtime state 真相源，Postgres / queue shadow path 不是 primary store。

## Core Directories

- `apps/dispatcher/src/modules/server/`：dispatcher HTTP、状态机、SQLite、shadow、SLO 和 worktree 核心实现。
- `packages/trae-beta-runtime/src/`：远程 Trae worker runtime。
- `packages/forgeflow-dispatcher/`：install-and-run dispatcher runtime 包。
- `packages/worker-review-orchestrator-cli/`：dispatch、watch、inspect、decide 控制层 CLI。
- `scripts/`：源码仓 live entrypoint、DR 脚本、发布脚本和 bootstrap glue。
- `scripts/lib/`：仍在运行链路中的 adapter / gateway / worker glue，不要误判为纯 legacy。
- `docs/contracts/`：精确协议边界；`docs/runbooks/`：场景操作流程。

## Documentation Map

- `AGENTS.md`：仓库规则、分支、提交、worker、审查和验证边界。
- `docs/README.md`：唯一文档导航入口，说明权威文档、阅读路径和 legacy 边界。
- `README.md`：当前主线能力、推荐启动方式和运行入口索引。
- `docs/ARCHITECTURE.md`：系统形态、模块边界、运行时所有权和主链数据流。
- `docs/STATE_MACHINE.md`：task / assignment / review / continuation 状态语义。
- `docs/API_ENDPOINTS.md`：dispatcher 与 Trae automation gateway 的 HTTP 面。
- `docs/DATABASE_SCHEMA.md`：SQLite snapshot、结构化投影、review memory 和 session store。
- `docs/KNOWN_PITFALLS.md`：已有代码或历史问题支撑的高风险误读点。
- `docs/TECH_DEBT.md`：已确认仍存在的技术债。
- `docs/DOC_SYNC_CHECKLIST.md`：收尾时判断是否需要刷新文档。

## Common Task Reading Paths

- 修改 dispatcher HTTP：读 `docs/API_ENDPOINTS.md`，再查 `apps/dispatcher/src/modules/server/dispatcher-server.ts`。
- 修改状态机或任务流转：读 `docs/STATE_MACHINE.md`，再查 `apps/dispatcher/src/modules/server/runtime-state.ts`。
- 修改持久化或 DR：读 `docs/DATABASE_SCHEMA.md`、`docs/runbooks/runtime-state-backup-restore-repair.md`，再查 `runtime-state-sqlite.ts` 和 `scripts/*runtime-state.mjs`。
- 修改 Trae 无人值守链路：读 `docs/ARCHITECTURE.md`、`docs/API_ENDPOINTS.md`、`docs/KNOWN_PITFALLS.md`，再查 `scripts/lib/trae-automation-worker.ts` 与 `packages/trae-beta-runtime/src/`。
- 修改非 Trae runtime 或 npm 包：读对应 `packages/*/README.md`、`package.json` 和包内测试，再回到根级 `pnpm test` / `pnpm typecheck` 验证。
- 推进 vNext runtime reliability：读 `docs/rfcs/0001-runtime-reliability-vnext.md`、`docs/WORKER_PROTOCOL_V1.md`、`docs/TASK_ATTEMPT_MODEL.md`、`docs/ARTIFACT_BUNDLE_V1.md`。
- 修改文档体系：读 `docs/README.md`、`docs/DOC_SYNC_CHECKLIST.md` 和本文件，改完运行 `pnpm docs:validate`。

## High-Risk Areas

- 不要只改 `apps/dispatcher/src` 就假定 live entrypoint 已同步；`scripts/*.js` 和 `scripts/lib/*` 仍是源码仓运行入口。
- `leases[]` 当前在 task claim 生命周期内强约束 assignment / repo / branch；continuation 或 follow-up 任务还会强约束 session。
- `DISPATCHER_READ_ONLY_MODE=1` 默认冻结 `/api/` 写方法；它覆盖 dispatcher HTTP API 写入，但不覆盖直接文件、外部数据库或绕过 HTTP 的写入。
- Postgres / queue shadow path 是 best-effort shadow；SQLite snapshot 仍是真相源。
- `backup-runtime-state.mjs` / `restore-runtime-state.mjs` 使用位置参数；打包 CLI 的 `--backup-dir` 是另一路入口。
- `docs/plans/`、`docs/research/`、`docs/archive/`、`docs/external/` 默认不是当前实现权威。

## Validation Commands

Quick:

```bash
python3 scripts/validate_docs.py . --profile generic
pnpm docs:validate
git diff --check
```

Full:

```bash
pnpm test
pnpm typecheck
pnpm verify:stage2
pnpm verify:stage3
```

Device-required:

- 无固定设备验证命令；涉及 Trae 桌面端或远程 worker 时按对应 runbook 准备外部环境。

Release-side-effect:

```bash
node scripts/release-publish-preflight.mjs
```

## Stale when

- `scripts/` live entrypoint、dispatcher runtime、Trae runtime、SQLite / shadow path 或发布包入口变化。
- 新增、归档或重命名权威文档。
- `package.json` 的验证脚本或 stage gate 变化。

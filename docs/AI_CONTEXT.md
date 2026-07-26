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
    - ".github/workflows/release.yml"
    - "docs/runbooks/release-cadence.md"
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
- 持久化定位：SQLite snapshot 是默认 runtime state 真相源，并默认保留最近 128 个 revision；runtime 只保留最近 500 条事件窗口，SQLite/PostgreSQL audit table 另存可分页历史。Postgres / queue 默认是 revision-gated shadow path；只有完成 cutover evidence 且显式选择 `RUNTIME_STATE_BACKEND=postgres` 时才使用 Postgres primary。
- 发布包定位：`@tingrudeng/codex-beta-runtime` 与 `@tingrudeng/trae-beta-runtime` 当前在 npm registry 可安装；`@tingrudeng/gemini-beta-runtime` 与 `@tingrudeng/beta-runtime-core` 源码已存在，但仍需 npm 包名和 Trusted Publisher 外部配置。

## Core Directories

- `apps/dispatcher/src/modules/server/`：dispatcher HTTP、状态机、SQLite、shadow、SLO 和 worktree 核心实现。
- `packages/trae-beta-runtime/src/`：远程 Trae worker runtime；`packages/beta-runtime-core/src/runtime/execution-profile.ts`：Codex / Gemini trusted-host 与 isolated-container 执行边界。
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
- 修改非 Trae runtime 或 npm 包：读对应 `packages/*/README.md`、`package.json` 和包内测试；执行隔离还要读 `docs/contracts/execution-profile-v1.md` 并查 `execution-profile.ts`、`run-worker-assignment.ts` 和 provider `start-worker.ts`，再回到根级验证。
- 修改发布或 runtime 包可安装性：读 `README.md`、`.github/workflows/release.yml`、`docs/runbooks/release-cadence.md` 和对应 `packages/*/package.json`，先用只读 `npm view <pkg> version dist-tags --json` 核对 registry 事实；需要核验实际 registry payload 时运行 `node scripts/verify-published-package-tarball.mjs --package <package>`。
- 推进 vNext runtime reliability：读 `docs/rfcs/0001-runtime-reliability-vnext.md`、`docs/WORKER_PROTOCOL_V1.md`、`docs/TASK_ATTEMPT_MODEL.md`、`docs/ARTIFACT_BUNDLE_V1.md`。
- 修改文档体系：读 `docs/README.md`、`docs/DOC_SYNC_CHECKLIST.md` 和本文件，改完运行 `pnpm docs:validate`。

## High-Risk Areas

- 不要只改 `apps/dispatcher/src` 就假定 live entrypoint 已同步；`scripts/*.js` 和 `scripts/lib/*` 仍是源码仓运行入口。
- `leases[]` 当前在 task claim 生命周期内强约束 assignment / repo / branch；continuation 或 follow-up 任务还会强约束 session。
- `DISPATCHER_READ_ONLY_MODE=1` 默认冻结 `/api/` 写方法；它覆盖 dispatcher HTTP API 写入，但不覆盖直接文件、外部数据库或绕过 HTTP 的写入。
- 控制层使用 `DISPATCHER_API_TOKEN`；远程 worker 应使用按 workerId 绑定的 `DISPATCHER_WORKER_TOKEN`。Codex / Gemini 默认是 `trusted-host`；`isolated-container` 必须由 operator 显式启用并 fail closed，Docker `bridge` 不是域名级网络 allowlist。
- `/api/metrics` 的事件型计数只覆盖 `metrics.eventWindow` 标出的最近 500 条运行窗口；完整审计应分页读取 `/api/query/events`。
- Postgres / queue shadow path 是 best-effort shadow；每次同步绑定已持久化 SQLite revision，projection 与 queue 原子推进并拒绝旧 revision 回退。SQLite snapshot 默认仍是真相源。
- shadow drift 的 `--record-alert` 写入与 dispatcher 共用本机 `.runtime-state.lock` 并在锁内重读最新状态；它不提供跨主机互斥。
- Trae `sessions.json` mutation 通过本机 `sessions.json.lock` 串行化并在锁内重读；它解决 lost update，不代表多 gateway 或跨主机 session ownership。
- 不要把源码中存在的 `@tingrudeng/gemini-beta-runtime` / `@tingrudeng/beta-runtime-core` 误写成当前已公开 npm 安装入口；npm registry 返回 E404 时先处理包名权限和 Trusted Publisher 配置。
- `backup-runtime-state.mjs` / `restore-runtime-state.mjs` 使用位置参数；打包 CLI 的 `--backup-dir` 是另一路入口。两者复用同一个 backup core 和 v1 manifest；正式 restore 前仍需停止 dispatcher 与直接文件 / SQLite 写入者。
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
pnpm lint
pnpm test
pnpm typecheck
pnpm audit --prod --audit-level high
pnpm verify:stage2
pnpm verify:stage3
# 只读 registry 可安装性检查，无发布副作用
npm view @tingrudeng/codex-beta-runtime version dist-tags --json
npm view @tingrudeng/trae-beta-runtime version dist-tags --json
```

Device-required:

- 无固定设备验证命令；涉及 Trae 桌面端或远程 worker 时按对应 runbook 准备外部环境。

Release-side-effect:

- 不在快速上下文里提供直接发布命令；实际 create/sign/publish/tag/push 只通过 `.github/workflows/release.yml` 的受控发布流程执行。

## Stale when

- `scripts/` live entrypoint、dispatcher runtime、Trae runtime、SQLite / shadow path、发布包入口或 npm registry 可安装状态变化。
- 新增、归档或重命名权威文档。
- `package.json` 的验证脚本或 stage gate 变化。

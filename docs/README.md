# forgeflow-platform Docs Guide

这份文档是仓库唯一的文档导航入口。它负责说明哪些文件是权威来源，哪些只是补充、计划或研究材料。

## Authority Map

- `../AGENTS.md`
  - 仓库唯一规则入口。
  - 定义修改边界、验证要求、文档同步要求。
- `DOC_SYNC_CHECKLIST.md`
  - 文档同步完成门禁。
  - 每个代码任务都要更新受影响文档，或明确写出 `no doc impact`。
- `../README.md`
  - 当前主线能力、当前推荐使用入口与 Trae 路径定位。
  - 不是规则文件。
- `ARCHITECTURE.md`
  - 当前主线架构与运行边界的验证版概览。
- `STATE_MACHINE.md`
  - dispatcher task / assignment / review / continuation 状态机摘要。
  - 用于核对阶段二主链规则，不替代 API 字段文档。
- `API_ENDPOINTS.md`
  - 当前 HTTP 接口面的验证版概览。
  - 不是完整字段字典。
- `DATABASE_SCHEMA.md`
  - 当前持久化形态与关键状态字段的验证版概览。
- `KNOWN_PITFALLS.md`
  - 已被代码或实现边界支撑的坑点。
- `TECH_DEBT.md`
  - 已确认、仍然存在的架构债务。
- `onboarding.md`
  - 业务仓接入与最小 smoke 流程。
  - 不是仓库架构总览。
- `CONTRIBUTING.md`
  - 主链贡献约束、ADR 触发条件、兼容性规则与契约变更 checklist。
  - 不替代仓库规则。
- `AGENT_STARTER_PROMPT.md`
  - 新 agent 会话的短启动提示。
  - 只做入口 shim，不重复定义规则。
  - 会提醒 agent 先确认 branch / commit / push / merge 边界，但完整权限规则仍以 `../AGENTS.md` 为准。
- `../prompts/dispatch-task-template.md`
  - 任务审查编排器 / dispatcher worker 的通用任务级 prompt 模板。
  - 固定要求先读取 `AGENTS.md`、本文件和 `AGENT_STARTER_PROMPT.md`，再补本次任务特有约束。
  - 不替代仓库规则，也不替代具体任务自己的 `allowedPaths`、验收命令和交付要求。
- `../skills/worker-review-orchestrator/references/dispatch-quality-checklist.md`
  - 发单前的质量门 checklist。
  - 用来卡住主题型任务、弱验收任务和没有 review-to-fix 映射的返工任务。
- `contracts/*.md`
  - 精确协议、字段与能力边界。
  - 只在对应协议范围内权威，不负责导航整个仓库。
- `runbooks/*.md`
  - 面向具体演练或操作流程的参考材料。
  - 只在对应 runbook 场景下有效。
- `plans/*.md`
  - 设计草案、实施计划、阶段性记录。
  - 默认不是当前主线权威。
- `research/*.md`
  - 研究或探索材料。
  - 明确非权威，不应被当成当前实现说明。

## Reading Flows

新 agent 进入仓库：

1. 先读 `../AGENTS.md`
2. 再读本文件
3. 再读 `../README.md`
4. 如果目标模块有本地 `README.md`，先读本地入口
5. 按任务类型进入下面的专用入口
6. 最后回到代码验证，不直接相信任何文档

当前项目使用入口：

1. `../README.md`
2. `../scripts/start-control-plane.sh`
3. `../packages/trae-beta-runtime/README.md`
4. 如果需要维护已延期的 control-layer 旧入口，再看 `archive/codex-control-usage.md`
5. 再回到 `../scripts/`、`../packages/` 和实际命令验证

业务仓接入或模板调整：

1. `onboarding.md`
2. `e2e-smoke-checklist.md`
3. `../templates/`
4. 收尾时检查 `DOC_SYNC_CHECKLIST.md`

阶段二主链运维 / 演练：

1. `STATE_MACHINE.md`
2. `runbooks/phase2-mainline-operations.md`
3. `runbooks/observability-and-alerting.md`
4. `API_ENDPOINTS.md`
5. `CONTRIBUTING.md`

阶段一恢复 / 故障 / 发布节奏：

1. `runbooks/single-machine-deployment.md`
2. `runbooks/auth-and-state-lock.md`
3. `runbooks/runtime-state-backup-restore-repair.md`
4. `runbooks/worktree-cleanup.md`
5. `runbooks/delivery-failed-recovery.md`
6. `runbooks/release-cadence.md`
7. `../.github/ISSUE_TEMPLATE/*`
8. `../.github/PULL_REQUEST_TEMPLATE.md`

dispatcher / worker / runtime 变更：

1. `ARCHITECTURE.md`
2. `STATE_MACHINE.md`
3. `API_ENDPOINTS.md`
4. `DATABASE_SCHEMA.md`
5. 相关契约：
   - `contracts/worker-prompt-layering-v1.md`
   - `contracts/review-memory-v1.md`
   - `contracts/provider-capabilities-v1.md`
5. 对应模块入口：
   - `../apps/dispatcher/README.md`
   - `../scripts/lib/README.md`
6. 对应 `scripts/`、`apps/dispatcher/`、`packages/`

Trae 无人值守链路：

1. `ARCHITECTURE.md`
2. `API_ENDPOINTS.md`
3. `KNOWN_PITFALLS.md`
4. `contracts/trae-automation-gateway-v1.md`
5. `../scripts/lib/README.md`
6. `scripts/lib/trae-automation-worker.js`
7. `scripts/lib/trae-automation-gateway.js`
8. `runbooks/trae-remote-beta.md`

For git SSH override (e.g., when port 22 is blocked), see `../README.md` → Git SSH Override section.

Trae MCP fallback 维护：

1. `../README.md` 中的 fallback 定位
2. `contracts/trae-worker-v1.md`
3. `packages/mcp-trae-worker/src/server.ts`
4. `scripts/run-trae-mcp-worker-server.js`

## Current Positioning

- `dispatcher` 是任务与状态真相源。
- Phase 1 运行时合并到 TypeScript 已完成；当前主链入口仍在 `scripts/*.js`，但 `worker-daemon`、`review-decision`、`dispatcher-state`、`dispatcher-server` 已桥接到 `apps/dispatcher/dist` 的 TypeScript foundation。
- Phase 2 持久化主线已切到 SQLite：dispatcher 默认写 `.forgeflow-dispatcher/runtime-state.db`，显式 `--persistence-backend json` 或 `RUNTIME_STATE_BACKEND=json` 才回退到 JSON。
- dispatcher HTTP 面支持三种认证模式（通过 `DISPATCHER_AUTH_MODE` 控制）：
  - `token`（默认）：强制认证模式，必须设置 `DISPATCHER_API_TOKEN`，除 `/health` 外所有接口需要认证
  - `legacy`：兼容模式，当 `DISPATCHER_API_TOKEN` 未设置时，只允许 loopback 地址（127.0.0.1、::1）访问；设置后需认证
  - `open`：完全开放模式，所有接口可匿名访问，适合本地开发
- dispatcher 状态型 HTTP 路径现在共享跨进程 `.runtime-state.lock`；锁竞争超时会返回 `503`，陈旧锁会按 `DISPATCHER_STATE_LOCK_*` 环境变量自动回收。
- dispatcher 默认 SQLite snapshot 现在按 revision 追加落盘，并携带 `checksum_sha256`；读取默认 fail-closed，只有显式设置 `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1` 时才允许从 JSON 救援。
- 控制中枢当前推荐入口是 `../scripts/start-control-plane.sh`，只负责拉起 Trae-first 的常驻 dispatcher 控制面。
- `codex` / `gemini` 的 `worker daemon` 链路仍可用，但当前迭代策略是 Trae-first，相关扩展暂缓投入（deferred），不属于推荐启动路径。
- `worker-daemon` / Trae runtime 现在只有在结果成功回写到 dispatcher 后才会对外呈现“完成”；`submitResult`、`git push`、自动 PR 创建失败都属于显式失败，而不是假完成。
- `dependsOn` 现在进入 dispatcher 调度门控：依赖未满足时任务保持 `planned`，满足后自动解锁为 `ready`。
- generic worker claim 已从副作用 GET 收口为显式 POST：
  - `GET /api/workers/:workerId/assigned-task` 只读
  - `POST /api/workers/:workerId/claim-task` 才会真正 claim / assign
- review decision 现在显式支持 `merge`、`block`、`rework`、`changes_requested`，其中后两者都会把任务落到 `blocked`，但保留原始 decision 供 redrive 和审计使用。
- dispatcher 现在会 canonicalize worker result 的 `workerId/pool/repo/defaultBranch/branchName`，worker 不能再覆盖这些 dispatcher-owned 字段。
- dashboard snapshot 现在附带最小控制面指标：`queueDepth`、`plannedTasks`、`reviewBacklog`、`avgAssignmentLagMs`、`maxAssignmentLagMs`。
- dispatcher 现在还会把 worker 侧关键失败信号回写成 runtime events，并在 `/api/metrics` 暴露 `submitResultRetryCount`、`deliveryFailedCount`、`cleanupFailureCount`、`sessionInterruptionCount`、`stateLockTimeoutCount`。
- worker 子进程不再继承完整环境变量；自动 PR 创建只有显式设置 `FORGEFLOW_WORKER_CREATE_PR=1` 才会启用。
- Trae 的首选无人值守路径是 `automation gateway` + `automation worker`。
- Trae MCP worker 已降级为 deprecated/fallback 接入。
- review memory 已进入主线的 dispatch 注入路径，但仍不是完整知识库系统。
- `blocked + rework -> continuation` 已进入主线协议与 Trae consumer 链路，并已完成远程 smoke 验证。
- Trae dispatch prompt 现在优先由 `worker-review-orchestrator-cli` 基于结构化任务字段自动渲染；dispatcher assignment 会保留最终 `workerPrompt`，并附带 `workerPromptMode/reportSchemaVersion` 元信息。
- follow-up / rework 分支只有在源任务已经交付过可验证的远端产物、且目标 worker 不变时才允许复用；否则控制层应新开 `-rN` 分支继续。
- Trae review-ready 的成功门槛现在包含远端 SHA 校验与短暂重试窗口；只有远端分支 HEAD 与最终回执 commit SHA 一致时，结果才会进入 review。
- `new_chat` 模式下的 Trae 采样现在会缩到最后一个可见 chat root，并在读取到上一个已完成任务的 `任务ID` 时提前报 stale-session 错误，而不是继续把旧对话当成本次任务基线。

## Supporting Docs

- `../.github/workflows/ci.yml`
  - GitHub Actions CI workflow 配置。
  - 定义 push/pull_request 触发条件与验证步骤。
- `../.github/workflows/release.yml`
  - GitHub Actions 发布入口。
  - 用 OIDC + provenance 执行 npm 发布，并在发布后跑 Scorecard。
  - 发布前会校验包元数据是否与当前仓库 `TingRuDeng/forgeflow-platform` 对齐，并要求 `NPM_TRUSTED_PUBLISHING_ENABLED=true` 作为自动发布显式门禁。
- `codex-session-bootstrap.md`
  - Codex-control 专用会话提示助手。
  - 不替代 `AGENTS.md` 或本文件。
- `../skills/worker-review-orchestrator/SKILL.md`
  - 当前对外发布的 control-layer skill。
  - 适合通过 `npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill worker-review-orchestrator -g -y` 安装。
  - 当前默认审查闭环是 PR-first：审查通过后先完成 PR 集成，再提交 `decision merge`。
- `../skills/package-release/SKILL.md`
  - 包发布助手 skill。
  - 提供 dry-run-by-default 的安全发布流程。
  - 适合通过 `npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill package-release -g -y` 安装，并用于发布 forgeflow-platform npm 包。
- `../packages/worker-review-orchestrator-cli/README.md`
  - 当前对外发布的 control-layer CLI 包入口。
  - 适合全局安装 `@tingrudeng/worker-review-orchestrator-cli` 后提供 `forgeflow-review-orchestrator` 命令。
- `../packages/trae-beta-runtime/README.md`
  - 当前对外发布的远程 Trae npm 包入口。
  - 适合远程机器用 `npm install -g @tingrudeng/trae-beta-runtime` 安装。
- `../packages/automation-gateway-core/README.md`
  - 远程 Trae runtime 依赖的共享协议 helper 包。
  - 不是远程机器直接安装入口，主要用于发布和复用报告解析/任务 ID 校验逻辑。
- `../packages/mcp-*/README.md`
  - MCP thin-wrapper 包入口（`mcp-scheduler`、`mcp-trae-worker`、`mcp-review-gate`、`mcp-github`、`mcp-repo-policy`）。
  - 都是 thin wrapper：工具定义和 deps 注入委托，实际逻辑在 dispatcher 层。
  - `mcp-scheduler` 现在已经切到 generic pool 表达，并为每个 tool 暴露输入 schema。
  - `mcp-trae-worker` 是 deprecated/fallback；推荐路径是 Trae automation gateway + automation worker。
- `../prompts/dispatch-task-template.md`
  - 给 worker 派发代码任务时的通用骨架模板。
  - 适合和 `AGENT_STARTER_PROMPT.md` 叠加使用，而不是重复粘贴 starter 全文。
- `../skills/worker-review-orchestrator/references/dispatch-quality-checklist.md`
  - 给控制层在 `dispatch-task` 前做任务质量自检使用。
- `github-operations.md`
  - GitHub 侧操作约束与命令参考。
- `runbooks/trae-remote-beta.md`
  - 远程 Trae beta 试运行顺序、观察点与问题记录入口。
- `runbooks/phase2-mainline-operations.md`
  - 阶段二主链操作入口。
  - 包含 `dependsOn`、claim POST、redrive / continuation、worker result canonicalization 和 `/api/metrics` 最小检查方式。
- `runbooks/observability-and-alerting.md`
  - 阶段二 metrics / runtime events / alert 说明入口。
- `runbooks/single-machine-deployment.md`
  - 阶段一单机控制面部署与恢复入口。
- `runbooks/auth-and-state-lock.md`
  - 阶段一认证与状态锁排障入口。
- `runbooks/runtime-state-backup-restore-repair.md`
  - SQLite 备份、恢复和显式救援入口。
- `runbooks/worktree-cleanup.md`
  - worktree 巡检与清理入口。
- `runbooks/delivery-failed-recovery.md`
  - `submitResult` / push / PR 失败后的排障与 redrive 入口。
- `runbooks/release-cadence.md`
  - patch / hotfix / minor 发布节奏说明。
- `runbooks/trae-issue-template.md`
  - 远程 Trae 试运行的结构化问题记录模板。
- `CONTRIBUTING.md`
  - 主链贡献与契约变更 checklist。
- `../.github/ISSUE_TEMPLATE/*`
  - 阶段一最小 Bug / P0-P1 回归模板。
- `../.github/PULL_REQUEST_TEMPLATE.md`
  - 主链 PR 风险、验证和文档同步检查项。

## Non-Authoritative Material

- `plans/*`
  - 可能准确描述过某一阶段的设计意图，但不保证与当前代码同步。
- `research/*`
  - 只保留为背景研究与外部对标材料。
  - 进入主线前，必须由 `README.md`、`onboarding.md` 或 `contracts/*` 明确吸收。
- `runbooks/*`
  - 只在对应操作或演练场景下有效，不自动提升为主线规则。
- `archive/*`
  - 历史材料保留区，不是当前开发入口。
  - 当前已归档的过期阶段文档包括：
    - `archive/codex-control-usage.md`
    - `archive/release-v1.md`
    - `archive/phase-2-openclaw.md`
    - `archive/multi-repo-validation.md`

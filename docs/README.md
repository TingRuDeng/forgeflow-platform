---
ai_summary:
  purpose: "定义 forgeflow-platform 的唯一文档导航入口、权威级别、阅读路径和旧格式详情文档边界。"
  read_when:
    - "进入仓库后需要判断读哪些文档。"
    - "新增、归档、重命名或升级文档体系前。"
    - "需要区分当前权威文档、legacy 详情文档和历史材料时。"
  source_of_truth:
    - "AGENTS.md"
    - "docs/AI_CONTEXT.md"
    - "docs/DOC_SYNC_CHECKLIST.md"
    - "scripts/validate_docs.py"
    - "package.json"
  verify_with:
    - "python3 scripts/validate_docs.py . --profile generic"
    - "pnpm docs:validate"
  stale_when:
    - "新增权威文档、调整阅读路径、归档旧文档或修改文档校验契约。"
---

# forgeflow-platform Docs Guide

这份文档是仓库唯一的文档导航入口。它负责说明哪些文件是权威来源，哪些只是补充、计划或研究材料。

## Purpose

提供人类和 AI 代理进入仓库时的唯一文档导航，明确哪些文档权威、哪些只是历史或参考材料。

## Source of truth

- `../AGENTS.md` 定义仓库级 agent 执行规则。
- `AI_CONTEXT.md` 定义 AI 快速上下文地图。
- `DOC_SYNC_CHECKLIST.md` 定义文档同步收尾门禁。
- `../package.json` 定义 `docs:validate`、`test`、`typecheck`、`verify:stage2`、`verify:stage3` 等验证命令。
- `../scripts/validate_docs.py` 定义上下文包校验规则。

## Key facts

- 规则入口只有 `../AGENTS.md`。
- 文档导航入口只有本文件。
- AI 快速上下文入口是 `AI_CONTEXT.md`。
- `plans/`、`research/`、`archive/`、`external/` 默认不是当前实现权威。
- 旧格式详情文档集中列在 `## Legacy detail docs`，内容可作任务上下文，但新契约 freshness 以本文件、`AI_CONTEXT.md` 和代码校验为准。

## How to verify

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
```

## Stale when

- 文档入口、权威级别、阅读路径或 legacy 详情文档边界变化。
- 上下文包校验规则或 `package.json` 文档命令变化。
- 新增稳定文档、模块 README 或归档旧文档。

## 适合读者

适合首次进入仓库的维护者、AI 代理、控制层调度者、worker 执行者、审查者和运维操作者。

## 权威边界

本文件只负责文档导航和阅读路径，不定义执行规则或接口字段。执行规则以 `../AGENTS.md` 为准；接口、状态、持久化事实以对应稳定文档和代码为准。

## 如何验证

- 运行 `pnpm docs:validate` 检查必备标题、`ai_summary`、AI_CONTEXT 顺序、本地链接和模板残留。
- 对支持材料路径，使用 `test -f <path>` 或 `rg --files` 确认文件真实存在。
- 文档事实变更时，对照 `../apps/dispatcher/src/`、`../scripts/` 和 `../packages/` 的真实入口。

## Legacy detail docs

以下文档仍是有用的项目详情入口，但尚未逐份迁移到 `project-context-bootstrap` 当前 authority doc contract。使用这些文档时必须回到对应代码、契约或命令验证；当文档内容与代码冲突时，以代码为准并在同一变更中修正文档。

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [API_ENDPOINTS.md](API_ENDPOINTS.md)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [STATE_MACHINE.md](STATE_MACHINE.md)
- [KNOWN_PITFALLS.md](KNOWN_PITFALLS.md)
- [TECH_DEBT.md](TECH_DEBT.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [onboarding.md](onboarding.md)
- [WORKER_PROTOCOL_V1.md](WORKER_PROTOCOL_V1.md)
- [TASK_ATTEMPT_MODEL.md](TASK_ATTEMPT_MODEL.md)
- [ARTIFACT_BUNDLE_V1.md](ARTIFACT_BUNDLE_V1.md)
- [codex-session-bootstrap.md](codex-session-bootstrap.md)
- [e2e-smoke-checklist.md](e2e-smoke-checklist.md)
- [github-operations.md](github-operations.md)

## Detailed Doc Map

以下文档是稳定详情入口，但仍按 legacy detail doc 处理；它们可以指导任务读取路径，不能单独替代代码、契约和验证命令。

- `../AGENTS.md`
  - 仓库唯一规则入口。
  - 定义修改边界、验证要求、文档同步要求。
- `DOC_SYNC_CHECKLIST.md`
  - 文档同步完成门禁。
  - 每个代码任务都要更新受影响文档，或明确写出 `no doc impact`。
- `AI_CONTEXT.md`
  - 面向 AI 的短上下文索引。
  - 只放权威地图、任务读取路径、证据入口和高风险误读点，不替代本文件的导航职责。
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
- `WORKER_PROTOCOL_V1.md`
  - vNext worker / dispatcher 目标协议。
  - 当前是目标契约和类型包说明，不代表现有 dispatcher routes 已强制接入。
- `TASK_ATTEMPT_MODEL.md`
  - vNext TaskAttempt 目标模型。
  - 用于后续拆分 task 目标和 worker 执行尝试。
- `ARTIFACT_BUNDLE_V1.md`
  - vNext ArtifactBundle 契约与当前 result 存储边界。
  - 覆盖 dispatcher bundle 存储、CLI 获取和 review / replay 证据包标准化方向。
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
3. 需要快速给 AI 会话喂上下文时读 `AI_CONTEXT.md`
4. 再读 `../README.md`
5. 如果目标模块有本地 `README.md`，先读本地入口
6. 按任务类型进入下面的专用入口
7. 最后回到代码验证，不直接相信任何文档

当前项目使用入口：

1. `../README.md`
2. 如果是源码仓运行，读 `../scripts/start-control-plane.sh`
3. 如果是 install-and-run 控制面，读 `../packages/forgeflow-dispatcher/README.md`
4. 远程 Codex worker 读 `../packages/codex-beta-runtime/README.md`
5. 远程 Gemini worker 读 `../packages/gemini-beta-runtime/README.md`
5. 远程 Trae worker 读 `../packages/trae-beta-runtime/README.md`
6. 如果需要维护已延期的 control-layer 或双 Codex 演练旧入口，再看 `archive/codex-control-usage.md` 和 `archive/two-machine-codex-drill.md`
7. 再回到 `../scripts/`、`../packages/` 和实际命令验证

业务仓接入或模板调整：

1. `onboarding.md`
2. `e2e-smoke-checklist.md`
3. `../templates/`
4. 收尾时检查 `DOC_SYNC_CHECKLIST.md`

阶段二主链运维 / 演练：

1. `STATE_MACHINE.md`
2. `runbooks/phase2-mainline-operations.md`
3. `runbooks/observability-and-alerting.md`
4. `runbooks/stage2-exit-validation.md`
5. `API_ENDPOINTS.md`
6. `CONTRIBUTING.md`

阶段三核心平台运维 / 演练：

1. `ARCHITECTURE.md`
2. `DATABASE_SCHEMA.md`
3. `contracts/runtime-state-query-v1.md`
4. `runbooks/stage3-core-platform-operations.md`
5. `runbooks/observability-and-alerting.md`
6. `runbooks/runtime-state-backup-restore-repair.md`
7. `API_ENDPOINTS.md`

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

vNext runtime reliability 推进：

1. `rfcs/0001-runtime-reliability-vnext.md`
2. `WORKER_PROTOCOL_V1.md`
3. `TASK_ATTEMPT_MODEL.md`
4. `ARTIFACT_BUNDLE_V1.md`
5. `../packages/worker-protocol/src/index.ts`
6. 当前实现仍要回到 `API_ENDPOINTS.md`、`STATE_MACHINE.md` 和代码验证

## Current Positioning

- `dispatcher` 是任务与状态真相源。
- Phase 1 运行时合并到 TypeScript 已完成；当前主链入口仍在 `scripts/*.js`，但 `worker-daemon`、`review-decision`、`dispatcher-state`、`dispatcher-server` 已桥接到 `apps/dispatcher/dist` 的 TypeScript foundation；`review-memory` 与 `task-worktree` 的权威实现也已下沉到 `apps/dispatcher`。
- `scripts/` 根目录当前保留主线入口、`codex/gemini` worker daemon 入口和少量兼容脚本；旧的本地 codex drill 脚本、staging shell wrapper、`trigger-ai-dispatch.*` 与未消费的 checked-in `.d.ts` 已清理或归档。
- Phase 2 持久化主线已切到 SQLite：dispatcher 默认写 `.forgeflow-dispatcher/runtime-state.db`，显式 `--persistence-backend json` 或 `RUNTIME_STATE_BACKEND=json` 才回退到 JSON。
- dispatcher HTTP 面支持三种认证模式（通过 `DISPATCHER_AUTH_MODE` 控制）：
  - `token`（默认）：强制认证模式，必须设置 `DISPATCHER_API_TOKEN`，除 `/health` 外所有接口需要认证
  - `legacy`：兼容模式，当 `DISPATCHER_API_TOKEN` 未设置时，只允许 loopback 地址（127.0.0.1、::1）访问；设置后需认证
  - `open`：完全开放模式，所有接口可匿名访问，适合本地开发
- dispatcher 状态型 HTTP 路径现在共享跨进程 `.runtime-state.lock`；锁竞争超时会返回 `503`，陈旧锁会按 `DISPATCHER_STATE_LOCK_*` 环境变量自动回收。
- dispatcher 默认 SQLite snapshot 现在按 revision 追加落盘，并携带 `checksum_sha256`；读取默认 fail-closed，只有显式设置 `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1` 时才允许从 JSON 救援。
- 控制中枢当前推荐入口有两条：
  - 源码仓运行：`../scripts/start-control-plane.sh`
  - install-and-run runtime 包：`../packages/forgeflow-dispatcher/README.md`
- `start-control-plane.sh` 现在默认把 dispatcher 绑定到 `127.0.0.1`；监听非 loopback 地址必须显式传 `FORGEFLOW_DISPATCHER_HOST` 或 `--host`。
- `codex` / `gemini` 的 `worker daemon` 链路是受支持的多机执行路径，与 Trae 并列；远程机器可用 `@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 接入。worker-daemon 源码构建收敛仍是后续债务（见 `TECH_DEBT.md`）。
- `worker-daemon` / Trae runtime 现在只有在结果成功回写到 dispatcher 后才会对外呈现“完成”；`submitResult`、`git push`、自动 PR 创建失败都属于显式失败，而不是假完成。
- `dependsOn` 现在进入 dispatcher 调度门控：依赖未满足时任务保持 `planned`，满足后自动解锁为 `ready`。
- generic worker claim 已从副作用 GET 收口为显式 POST：
  - `GET /api/workers/:workerId/assigned-task` 只读
  - `POST /api/workers/:workerId/claim-task` 才会真正 claim / assign
- review decision 现在显式支持 `merge`、`block`、`rework`、`changes_requested`，其中后两者都会把任务落到 `blocked`，但保留原始 decision 供 redrive 和审计使用；Console 任务详情可直接提交 `merge` / `rework` / `block` 决策并刷新 dashboard snapshot，并在任务处于 `review` 时展示确定性风险分级 badge（非 `low` 时在合并按钮上方给出人工确认提示）。
- `forgeflow-review-orchestrator decide` 现在支持 `--reason-code`、`--must-fix`、`--can-redrive`、`--redrive-strategy`，并会把这些字段归一化写入 `review.evidence`。
- `forgeflow-review-orchestrator` 的 `inspect --summary` / `watch --summary` 现在会带上 review 风险分级（`riskAssessment.level/reasons/changedFileCount/protectedPathHits`）；`decide --decision merge` 现在受该分级软门禁：风险非 `low` 时拒绝合并，需显式 `--acknowledge-risk` 覆盖（门禁 fail-open，无法读取风险时放行，只约束 merge）。dispatcher 另提供服务端权威门禁 `DISPATCHER_REVIEW_MERGE_GATE`（默认 `off`，`enforce` 时风险非 `low` 的 merge 返回 `409`，`warn` 放行并记 `review_merge_risk_acknowledged`），覆盖 Console / CLI / 直连 HTTP。
- dispatcher 现在会 canonicalize worker result 的 `workerId/pool/repo/defaultBranch/branchName`，worker 不能再覆盖这些 dispatcher-owned 字段。
- dispatcher 现在会给每个任务生成稳定 `traceId`，并在 snapshot、Trae fetch-task、worker events、CLI summary 与 console drill-down 暴露该关联键。
- dashboard snapshot 现在附带阶段二控制面指标：`queueDepth`、`plannedTasks`、`reviewBacklog`、`avgAssignmentLagMs`、`maxAssignmentLagMs`、`retryRatePct`、`branchProtectionHitCount`、`repoConcurrencySaturation`、`failureCodes`、`reviewReasonCodes`。
- dashboard snapshot 现在暴露 `taskAttempts` 与 `artifactBundles`，Console 任务详情可直接查看 attempt timeline、runtime events、artifact summary、refs 和 retained content；dispatcher 会把 retained diff / log / test result 写入本地 artifact store，并通过 artifact 文件 API 和 `artifact-get --file <name>` 按需读取。
- dispatcher reconcile 现在会扫描离线 worker 的过期 running attempt，按默认最多 2 次 attempt 的最小策略自动 redrive 或把任务显式置为 `failed`。
- dispatcher 现在还会把 worker 侧关键失败信号回写成 runtime events，并在 `/api/metrics` 暴露 `submitResultRetryCount`、`deliveryFailedCount`、`cleanupFailureCount`、`sessionInterruptionCount`、`stateLockTimeoutCount`、`branchProtectionHitCount`、`repoConcurrencySaturation`，同时输出 `retryRatePct`、失败码聚合和 review reason 聚合。
- vNext runtime reliability 的目标契约已落地到 `@forgeflow/worker-protocol`，当前 dispatcher worker start/result mutation 已强制完整 `TaskAttempt` / `LeaseToken` envelope；该包还提供 start/result payload helper 作为内部 Worker SDK 契约。
- dispatcher 任务状态机现在包含 `cancelled`，控制面和 console 都可以显式作废非终态任务。
- 阶段三核心底座现在已进入主线：runtime state 增加显式 `leases[]`，SQLite 真相源同步维护 query-first 结构化投影，dispatcher 可选启用 structured reads、read-only 降级、Postgres / queue shadow write、SLO / burn-rate 与 DR 状态检查；当前强约束 lease 只确认接入 assignment，read-only 也仍受 `isMutationRequest` 覆盖范围限制。
- worker 子进程不再继承完整环境变量；自动 PR 创建只有显式设置 `FORGEFLOW_WORKER_CREATE_PR=1` 才会启用。
- `codex` / `gemini` 多机执行主线是 `worker daemon`。
- Codex 远程机器优先入口是 `@tingrudeng/codex-beta-runtime`。
- Gemini 远程机器优先入口是 `@tingrudeng/gemini-beta-runtime`。
- Trae 的首选无人值守路径是 `automation gateway` + `automation worker`。
- Trae MCP worker 已降级为 deprecated/fallback 接入。
- review memory 已进入主线的 dispatch 注入路径，但仍不是完整知识库系统。
- `blocked + rework -> continuation` 已进入主线协议与 Trae consumer 链路，并已完成远程 smoke 验证。
- Trae dispatch prompt 现在优先由 `worker-review-orchestrator-cli` 基于结构化任务字段自动渲染；dispatcher assignment 会保留最终 `workerPrompt`，并附带 `workerPromptMode/reportSchemaVersion` 元信息。
- follow-up / rework 分支只有在源任务已经交付过可验证的远端产物、且目标 worker 不变时才允许复用；否则控制层应新开 `-rN` 分支继续。
- Trae review-ready 的成功门槛现在包含远端 SHA 校验与短暂重试窗口；只有远端分支 HEAD 与最终回执 commit SHA 一致时，结果才会进入 review。
- `new_chat` 模式下的 Trae 采样现在会缩到最后一个可见 chat root，并在读取到上一个已完成任务的 `任务ID` 时提前报 stale-session 错误，而不是继续把旧对话当成本次任务基线。
- control-layer CLI 现在补齐了 `dispatch/dispatch-task/watch/inspect/decide` 的 `--state-dir` 本地 dispatcher fallback，并统一了 `watch --summary` / `inspect --summary` 的 review/failure/redrive/progress/trace 摘要字段。
- Trae runtime 现在会把结构化 phase events 和 failure blocker codes 写回 dispatcher worker events；generic worker daemon 的 failed result 也会带 blocker code。控制层 redrive 会优先读 blocker `code`，再回退到旧的文本 pattern。

## Supporting Docs

- `../.github/workflows/ci.yml`
  - GitHub Actions CI workflow 配置。
  - 定义 push/pull_request 触发条件与验证步骤。
- `../.github/workflows/release.yml`
  - GitHub Actions 发布入口。
  - 用 OIDC + provenance 执行 npm 发布。
  - 发布前会校验包元数据是否与当前仓库 `TingRuDeng/forgeflow-platform` 对齐，并要求 `NPM_TRUSTED_PUBLISHING_ENABLED=true` 作为自动发布显式门禁。
- `../.github/workflows/release-scorecard.yml`
  - Release 成功后的独立 OpenSSF Scorecard workflow。
  - 避免把 Trusted Publishing 所需的 `id-token` 权限和 scorecard 的 workflow 限制混在同一个发布 workflow 里。
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
- `../packages/forgeflow-dispatcher/README.md`
  - 当前对外发布的 dispatcher/control-plane runtime 包入口。
  - 适合全局安装 `@tingrudeng/forgeflow-dispatcher` 后直接运行单机 SQLite dispatcher。
- `../packages/trae-beta-runtime/README.md`
  - 当前对外发布的远程 Trae npm 包入口。
  - 适合远程机器用 `npm install -g @tingrudeng/trae-beta-runtime` 安装。
- `../packages/codex-beta-runtime/README.md`
  - 当前对外发布的远程 Codex npm 包入口。
  - 适合远程机器用 `npm install -g @tingrudeng/codex-beta-runtime` 安装。
- `../packages/gemini-beta-runtime/README.md`
  - 当前对外发布的远程 Gemini npm 包入口。
  - 适合远程机器用 `npm install -g @tingrudeng/gemini-beta-runtime` 安装。
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
  - 包含 `dependsOn`、claim POST、redrive / continuation、worker result canonicalization、`traceId` 关联和 `/api/metrics` 最小检查方式。
- `runbooks/observability-and-alerting.md`
  - 阶段二 metrics / runtime events / trace correlation / alert 说明入口。
- `runbooks/stage2-exit-validation.md`
  - 阶段二出口验证入口。
  - 收口 `runtime ownership`、`metrics/trace`、failure taxonomy 与可重复回归命令。
- `contracts/runtime-state-query-v1.md`
  - 阶段三结构化查询、lease、shadow mode、read-only 契约入口。
- `runbooks/stage3-core-platform-operations.md`
  - 阶段三核心底座操作入口。
  - 收口 structured reads、shadow write、SLO、DR 与参考部署。
- `runbooks/single-machine-deployment.md`
  - 阶段一单机控制面部署与恢复入口。
- `runbooks/auth-and-state-lock.md`
  - 阶段一认证与状态锁排障入口。
- `runbooks/runtime-state-backup-restore-repair.md`
  - SQLite 备份、恢复、manifest 与显式救援入口。
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
- `CODE_REVIEW_REPORT.md`
  - 2026-04-05 的历史审查快照。
  - 可借鉴审查维度与部分工程观察，但不再代表当前阶段状态。
  - 当前阶段结论优先查看 `external/5、权威文档执行状态回写（2026-04-08）.md` 与 `superpowers/plans/2026-04-09-stage3-execution-status-backfill.md`。
- `archive/multi-agent-v1-handbook.md`
  - 根目录旧版 v1 操作手册的归档副本。
  - 只保留历史设计背景，不再作为 control-layer 或 worker 分派入口。

## Repo Maintenance Baseline

- 仓库根目录现在提供共享的 `pnpm lint` / `pnpm lint:fix`，用于检查 `apps/dispatcher`、`packages/*`、`scripts/`、`services/*` 的主源码路径。
- 仓库根目录同时提供 `pnpm coverage:critical`，用于为 `apps/dispatcher`、`packages/trae-beta-runtime`、`packages/worker-review-orchestrator-cli` 生成关键覆盖率产物，并与 CI artifact 对齐。
- `apps/console` 继续使用自己的本地 `eslint.config.js`，暂不并入这条根级 lint 基线。
- 根目录同时提供 `.editorconfig`，作为仓库级最小编辑器规范；这不是 Prettier 替代品，也不意味着当前仓库已经启用统一格式化门禁。

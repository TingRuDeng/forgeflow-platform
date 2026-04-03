# ForgeFlow Docs Guide

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
- `AGENT_STARTER_PROMPT.md`
  - 新 agent 会话的短启动提示。
  - 只做入口 shim，不重复定义规则。
  - 会提醒 agent 先确认 branch / commit / push / merge 边界，但完整权限规则仍以 `../AGENTS.md` 为准。
- `../prompts/dispatch-task-template.md`
  - 任务审查编排器 / dispatcher worker 的通用任务级 prompt 模板。
  - 固定要求先读取 `AGENTS.md`、本文件和 `AGENT_STARTER_PROMPT.md`，再补本次任务特有约束。
  - 不替代仓库规则，也不替代具体任务自己的 `allowedPaths`、验收命令和交付要求。
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
2. `codex-control-usage.md`
3. `../skills/worker-review-orchestrator/SKILL.md`
4. `../packages/trae-beta-runtime/README.md`
5. 再回到 `../scripts/`、`../packages/` 和实际命令验证

业务仓接入或模板调整：

1. `onboarding.md`
2. `e2e-smoke-checklist.md`
3. `../templates/`
4. 收尾时检查 `DOC_SYNC_CHECKLIST.md`

dispatcher / worker / runtime 变更：

1. `ARCHITECTURE.md`
2. `API_ENDPOINTS.md`
3. `DATABASE_SCHEMA.md`
4. 相关契约：
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
- dispatcher HTTP 面支持可选 token 认证：设置 `DISPATCHER_API_TOKEN` 后，除 `/health` 外接口需携带 `Authorization: Bearer <token>`。
- `codex` / `gemini` 的 `worker daemon` 链路仍可用，但当前迭代策略是 Trae-first，相关扩展暂缓投入（deferred）。
- Trae 的首选无人值守路径是 `automation gateway` + `automation worker`。
- Trae MCP worker 已降级为 deprecated/fallback 接入。
- review memory 已进入主线的 dispatch 注入路径，但仍不是完整知识库系统。
- `blocked + rework -> continuation` 已进入主线协议与 Trae consumer 链路，并已完成远程 smoke 验证。

## Supporting Docs

- `../.github/workflows/ci.yml`
  - GitHub Actions CI workflow 配置。
  - 定义 push/pull_request 触发条件与验证步骤。
- `codex-control-usage.md`
  - 说明如何把 Codex 当成控制层使用。
  - 包含当前推荐的中控启动命令。
- `codex-session-bootstrap.md`
  - Codex-control 专用会话提示助手。
  - 不替代 `AGENTS.md` 或本文件。
- `../skills/worker-review-orchestrator/SKILL.md`
  - 当前对外发布的 control-layer skill。
  - 适合通过 `npx skills add https://github.com/TingRuDeng/ForgeFlow/skills --skill worker-review-orchestrator` 安装。
  - 当前默认审查闭环是 PR-first：审查通过后先完成 PR 集成，再提交 `decision merge`。
- `../skills/package-release/SKILL.md`
  - 包发布助手 skill。
  - 提供 dry-run-by-default 的安全发布流程。
  - 适合发布 ForgeFlow npm 包时使用。
- `../packages/worker-review-orchestrator-cli/README.md`
  - 当前对外发布的 control-layer CLI 包入口。
  - 适合全局安装 `@tingrudeng/worker-review-orchestrator-cli` 后提供 `forgeflow-review-orchestrator` 命令。
- `../packages/trae-beta-runtime/README.md`
  - 当前对外发布的远程 Trae npm 包入口。
  - 适合远程机器用 `npm install -g @tingrudeng/trae-beta-runtime` 安装。
- `../prompts/dispatch-task-template.md`
  - 给 worker 派发代码任务时的通用骨架模板。
  - 适合和 `AGENT_STARTER_PROMPT.md` 叠加使用，而不是重复粘贴 starter 全文。
- `github-operations.md`
  - GitHub 侧操作约束与命令参考。
- `runbooks/trae-remote-beta.md`
  - 远程 Trae beta 试运行顺序、观察点与问题记录入口。
- `runbooks/trae-issue-template.md`
  - 远程 Trae 试运行的结构化问题记录模板。
- `release-v1.md`
  - 阶段性发布记录，不替代当前实现说明。
- `phase-2-openclaw.md`
  - 阶段性进展摘要，不替代当前实现说明。

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

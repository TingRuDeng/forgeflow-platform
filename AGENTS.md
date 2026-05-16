---
ai_summary:
  purpose: "定义 forgeflow-platform 内人类维护者、控制层 agent、worker 和审查者的执行规则。"
  read_when:
    - "开始任何仓库任务前。"
    - "判断能否提交、推送、合并、分派 worker 或执行验证前。"
  source_of_truth:
    - "docs/README.md"
    - "docs/AI_CONTEXT.md"
    - "docs/DOC_SYNC_CHECKLIST.md"
    - "package.json"
  verify_with:
    - "python3 scripts/validate_docs.py . --profile generic"
    - "pnpm docs:validate"
    - "git status --short --branch"
  stale_when:
    - "agent 角色、分支策略、提交权限、验证命令或文档入口发生变化。"
---

# ForgeFlow AGENTS

## Purpose

定义本仓库内人类维护者、交互式控制层 agent、执行型 worker 和审查者的协作规则。

## Source of truth

- `docs/README.md` 是唯一文档导航入口。
- `docs/AI_CONTEXT.md` 是 AI 快速上下文地图。
- `docs/DOC_SYNC_CHECKLIST.md` 是文档同步收尾门禁。
- `package.json` 定义当前可运行的验证命令。
- 代码事实最终以 `apps/`、`packages/`、`scripts/` 和对应测试为准。

## Key facts

- `dispatcher` 是任务、分配、状态流转和审计记录的真相源。
- 默认从最新 `origin/main` 创建 `codex/` 前缀分支，不直接在 `main` 上做较大开发。
- 产出代码的 agent 必须给出分支、commit、push 和验证命令证据。
- 文档与代码冲突时信任代码，并在同一变更里修正文档。

## How to verify

Quick:

```bash
git status --short --branch
python3 scripts/validate_docs.py . --profile generic
pnpm docs:validate
```

Full:

```bash
pnpm test
pnpm typecheck
git diff --check
```

## Stale when

- agent 角色、分支策略、提交权限或合并边界变化。
- 文档入口、验证命令、worker 定位或 dispatcher 真相源变化。

## 适合读者

适合所有进入 forgeflow-platform 仓库的维护者、AI 代理、worker 执行者和代码审查者。

## 一分钟摘要

- `dispatcher` 是任务、分配、状态流转和审计记录的真相源。
- 规则入口只有本文件，文档导航入口只有 `docs/README.md`。
- 默认从最新 `origin/main` 创建 `codex/` 前缀分支，不直接在 `main` 上开发。
- 产出代码的 agent 必须提供分支、commit、push 和验证命令证据。
- 文档与代码冲突时信任代码，并在同一变更里修正文档。

## 权威边界

本文件只定义执行规则和协作边界，不复述完整架构、接口或数据库事实。架构事实看 `docs/ARCHITECTURE.md`，接口事实看 `docs/API_ENDPOINTS.md`，持久化事实看 `docs/DATABASE_SCHEMA.md`。

## 项目定位

ForgeFlow 是一个面向多智能体协作开发的控制平面仓库。

- `dispatcher` 是任务、分配、状态流转和审计记录的真相源。
- `codex`、`gemini`、`Trae` 都是 worker 接入方式，不是总调度。
- `codex-control` 或其他控制层负责规划、分派、审查与合并决策。
- 新能力优先以最小增量方式接入，不要推翻已有主链路。

## 文档入口

- 仓库规则入口只有 `AGENTS.md`。
- 文档导航入口只有 `docs/README.md`。
- 文档同步完成门禁是 `docs/DOC_SYNC_CHECKLIST.md`。
- `README.md` 负责主线能力、当前定位与最小启动方式，不重复定义仓库规则。
- `docs/onboarding.md` 只负责业务仓接入，不扩写成主线架构总览。
- `docs/contracts/*` 只负责精确契约，不单独充当架构导航。
- `docs/research/*`、`docs/plans/*`、`docs/runbooks/*` 默认不是主线权威来源，除非活跃文档显式引用。

## 目录职责

- `apps/`
  - 面向运行时或应用层的代码与测试。
- `packages/`
  - 可复用模块、MCP server、领域能力封装。
- `scripts/`
  - 面向本地运行、调度、执行、回写、运维的脚本入口。
- `docs/`
  - 设计文档、接入说明、runbook、计划文档。
- `templates/`
  - 业务仓接入模板、workflow 模板、契约模板。
- `prompts/`
  - 总调度与 worker 相关提示词模板。

## 开发边界

- 不要在默认分支上直接做较大改动；优先使用 `codex/` 前缀分支开发。
- 默认从最新的 `origin/main` 作为开发基线开始；只有在任务明确要求时，才基于指定功能分支继续开发。
- 修改前先理解调用链，不要只在表层 patch。
- 修改文档、协议、状态机或 worker 提示词前，先检查 `main` 上该部分的最新语义，避免把旧分支里的过时文案重新带回来。
- 不要顺手大规模重构无关模块。
- 改 worker 接入时，不要破坏已有 `codex-worker` / `gemini-worker` 链路。
- 改 `Trae` 接入时，不要把 `Trae` 提升成总调度。
- 改 `dispatcher` 状态机时，优先保持已有状态语义稳定，再扩展新状态。

## Agent 执行边界

- 所有 agent 默认都不应直接在 `main` 上开发；应使用已有任务分支，或新建 `codex/` 前缀分支。
- 未被明确授权时，不要擅自 `merge` 到 `main`，也不要假定自己拥有合并权限。
- 产出代码的 agent 必须给出可核对的执行证据：
  - 当前分支
  - commit SHA
  - push 状态
  - 实际运行的验证命令

### 控制层 / 交互式 agent

- `codex-control` 或其他控制层 agent 默认负责规划、分派、审查、集成判断。
- 除非用户明确要求，否则控制层 agent 不应擅自 `commit`、`push`、创建 PR 或执行 merge。
- 控制层 agent 可以做代码审查、状态核验、cherry-pick、集成准备，但在进入提交动作前应明确说明。

### Worker / 执行型 agent

- worker agent 只能在分配给自己的任务分支上提交代码，不应直接向 `main` 提交。
- worker agent 可以在任务要求包含代码产出时执行 `commit` 与 `push`，但不应自行 merge。
- worker agent 的完成回执必须包含 branch / commit / push / 测试证据；没有这些证据的结果默认不视为可合并产物。

### 审查 / 合并边界

- 是否 `merge`、是否 `block`、是否需要 rework，由控制层统一判断。
- 多智能体并行时，各 agent 不应自行宣称“已经可以合并到主线”；只能说明自己完成了什么、没覆盖什么、有哪些风险。

## 运行时与本地状态

- `.forgeflow-dispatcher/` 属于本地运行时状态目录，不应提交。
- `.worktrees/` 属于本地执行上下文，不应提交。
- `.orchestrator/project.yaml` 作为业务仓项目契约应提交；`.orchestrator/` 下其他运行时产物默认视为本地执行上下文，不应混入仓库正式代码。
- 遇到运行时状态导致的脏工作区，优先清理或忽略运行时文件，不要把它们当业务改动提交。

## 验证要求

- 提交前默认至少运行：
  - `pnpm test`
  - `pnpm typecheck`
  - `git diff --check`
- 如果只改局部模块，可先跑对应子集测试，但在合并前仍应补全必要的全量验证。
- 不要在没有可见验证证据的情况下声称“已修复”或“可合并”。

## 文档要求

- 新增能力或改变接入方式时，同步更新：
  - `README.md`
  - `docs/README.md`
  - `docs/onboarding.md`
- 若只改协议语义，再补充对应 `docs/contracts/*`，不要把同一份协议解释复制到多个入口文档。
- 文档必须写清：
  - 当前支持的能力
  - 明确不支持的边界
  - 最小验证方式
- 代码任务收尾前必须检查 `docs/DOC_SYNC_CHECKLIST.md`。
- 如果本次改动不需要改文档，必须在收尾说明里明确写出 `no doc impact` 和原因。
- 不要让文档与真实实现脱节。

## 多智能体并行协作

- 并发开发时，优先按职责拆分任务，尽量减少共享文件冲突。
- 如果必须并发修改同一子系统，应事先明确：
  - 各自负责的边界
  - 预期冲突文件
  - 最终由谁做集成联调
- 集成人在合并并行分支前，必须重新对齐最新的 `origin/main`，不要只在旧分支快照上互相 merge。
- 并发分支只负责说明自己完成了什么、没覆盖什么、可能冲突哪些文件。
- 是否合并、是否联调、联调顺序如何，应由集成人或总调度统一判断，不应由并发分支各自下结论。

## 提交与收尾

- 运行时实验、协议验证、最小 POC 与正式主链能力要明确区分。
- 进入主线前，应确认：
  - 主链是否可收口
  - 失败是否可落账
  - 状态展示是否与真实执行一致
- 若仍有剩余问题，明确标记为后续优化项，不要混淆为已完全解决。

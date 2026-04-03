# 组织级多仓多智能体控制平面实施计划

> **致 AI 助手：** 必须具备子技能：使用 superpowers:executing-plans 逐项实施此计划。

**目标：** 建立一套面向同一 GitHub 组织下多个独立仓库的多智能体协作控制平面，并让新仓库能以薄配置方式接入。

**架构：** 用一个组织级 control-plane 仓库承载 dispatcher、任务分解器、worktree manager、MCP servers、观测面、通用 prompts 与模板；每个业务仓只暴露项目契约和少量 workflow，由 `codex-control` 读取契约后完成拆分、分发、交叉验证、审查和合并决策。

**技术栈：** Node.js 20、TypeScript、Fastify、SQLite、Octokit、Zod、simple-git、GitHub Actions、Codex CLI、Gemini CLI

---

### 任务 1: 初始化 control-plane 仓库骨架

**涉及文件：**
- 创建：`apps/dispatcher/package.json`
- 创建：`apps/dispatcher/tsconfig.json`
- 创建：`packages/task-schema/package.json`
- 创建：`packages/task-schema/src/index.ts`
- 创建：`packages/task-decomposer/package.json`
- 创建：`packages/task-decomposer/src/index.ts`
- 创建：`prompts/codex-control.md`
- 创建：`prompts/codex-worker.md`
- 创建：`prompts/gemini-worker.md`

**第 1 步：创建 monorepo 基础目录**

创建：
- `apps/dispatcher/`
- `packages/task-schema/src/`
- `packages/task-decomposer/src/`
- `prompts/`
- `templates/workflows/`

**第 2 步：初始化 dispatcher 包**

在 `apps/dispatcher/package.json` 写入最小脚手架，包含 `dev`、`build`、`test`、`typecheck` 脚本。

**第 3 步：初始化 task schema 包**

在 `packages/task-schema/src/index.ts` 定义 `Task`、`Worker`、`ProjectConfig`、`TaskEvent` 的 Zod schema 和 TypeScript 导出。

**第 4 步：创建三份角色提示词**

分别在：
- `prompts/codex-control.md`
- `prompts/codex-worker.md`
- `prompts/gemini-worker.md`

写入职责边界、允许行为、禁止行为和输出格式约束。

**第 5 步：初始化任务分解器包**

在 `packages/task-decomposer/src/index.ts` 中定义：
- 输入：需求摘要、项目契约、任务类型
- 输出：结构化任务数组

**第 6 步：运行类型检查**

运行：`pnpm -r typecheck`

预期结果：所有初始包通过类型检查。

### 任务 2: 定义统一 schema 与项目契约

**涉及文件：**
- 修改：`packages/task-schema/src/index.ts`
- 创建：`packages/result-contracts/src/index.ts`
- 创建：`docs/contracts/run-result-v1.md`
- 创建：`docs/contracts/review-findings-v1.md`
- 创建：`templates/project.yaml`
- 创建：`templates/AGENTS.md`
- 创建：`templates/GEMINI.md`
- 测试：`packages/task-schema/src/index.test.ts`

**第 1 步：为项目契约写失败测试**

在 `packages/task-schema/src/index.test.ts` 添加：
- 缺少 `project.repo` 时校验失败
- 缺少 `routing` 时校验失败
- 合法配置时校验通过
- 缺少 `worktree.root_dir` 时按默认值补齐
- 缺少 `observability.enabled` 时按默认值补齐
- `run` 结果缺少必需字段时校验失败
- `review` findings 缺少必需字段时校验失败

**第 2 步：运行测试确认失败**

运行：`pnpm --filter task-schema test`

预期结果：失败，提示 schema 未实现或断言不通过。

**第 3 步：实现项目契约 schema**

在 `packages/task-schema/src/index.ts` 增加：
- `ProjectConfigSchema`
- `RoutingSchema`
- `GovernanceSchema`
- `WorktreeSchema`
- `ObservabilitySchema`
- `ProviderConfigSchema`
- `RunResultSchema`
- `ReviewFindingSchema`

**第 4 步：编写接入模板**

在：
- `templates/project.yaml`
- `templates/AGENTS.md`
- `templates/GEMINI.md`

写入最小可用模板。

**第 5 步：冻结结果契约文档**

在：
- `docs/contracts/run-result-v1.md`
- `docs/contracts/review-findings-v1.md`

写清：
- 必需字段
- 兼容规则
- additive-only 约束

**第 6 步：重新运行测试**

运行：`pnpm --filter task-schema test`

预期结果：通过。

### 任务 3: 实现 worker 注册与任务状态机

**涉及文件：**
- 创建：`apps/dispatcher/src/db/schema.ts`
- 创建：`apps/dispatcher/src/modules/workers/service.ts`
- 创建：`apps/dispatcher/src/modules/tasks/service.ts`
- 创建：`apps/dispatcher/src/modules/events/service.ts`
- 测试：`apps/dispatcher/src/modules/tasks/service.test.ts`

**第 1 步：为任务状态流转写失败测试**

覆盖：
- `planned -> ready`
- `ready -> assigned`
- `assigned -> in_progress`
- `in_progress -> partial_success`
- `in_progress -> expired`
- 非法跳转被拒绝

**第 2 步：运行测试确认失败**

运行：`pnpm --filter dispatcher test tasks/service.test.ts`

预期结果：失败，提示 service 未实现。

**第 3 步：实现任务与 worker 存储层**

在 SQLite schema 中加入：
- `workers`
- `tasks`
- `task_events`

**第 4 步：实现状态机与 worker 注册**

在 service 中实现：
- 注册 worker
- heartbeat
- 分配任务
- 变更任务状态
- 记录任务事件

**第 5 步：重新运行测试**

运行：`pnpm --filter dispatcher test tasks/service.test.ts`

预期结果：通过。

### 任务 4: 实现任务分解器与 dispatcher 分发策略

**涉及文件：**
- 创建：`packages/task-decomposer/src/index.test.ts`
- 创建：`apps/dispatcher/src/modules/dispatch/service.ts`
- 测试：`apps/dispatcher/src/modules/dispatch/service.test.ts`

**第 1 步：为任务分解器写失败测试**

覆盖：
- 输入需求与项目契约后能输出多个结构化任务
- 前端任务落到 `gemini`
- 后端任务落到 `codex`
- 每个任务都带 `allowed_paths` 与 `verification`

**第 2 步：运行测试确认失败**

运行：`pnpm --filter task-decomposer test`

预期结果：失败。

**第 3 步：实现任务分解器**

在 `packages/task-decomposer/src/index.ts` 中实现最小规则驱动分解逻辑。

**第 4 步：为分发规则写失败测试**

覆盖：
- 按池过滤空闲 worker
- 选择空闲时间最长的 worker
- 并列时 round-robin

**第 5 步：运行测试确认失败**

运行：`pnpm --filter dispatcher test dispatch/service.test.ts`

预期结果：失败。

**第 6 步：实现分发逻辑**

在 `apps/dispatcher/src/modules/dispatch/service.ts` 实现：
- `selectWorkerForTask`
- `assignReadyTask`

**第 7 步：重新运行测试**

运行：`pnpm --filter dispatcher test dispatch/service.test.ts`

预期结果：通过。

### 任务 5: 实现 worktree manager

**涉及文件：**
- 创建：`services/worktree-manager/src/index.ts`
- 测试：`services/worktree-manager/src/index.test.ts`

**第 1 步：为 worktree 生命周期写失败测试**

覆盖：
- 创建任务 worktree
- 按模板生成 branch 名称
- 删除已完成 worktree
- 同步默认分支

**第 2 步：运行测试确认失败**

运行：`pnpm --filter worktree-manager test`

预期结果：失败。

**第 3 步：实现 worktree manager**

封装：
- `createTaskWorktree`
- `syncTaskWorktree`
- `removeTaskWorktree`

**第 4 步：重新运行测试**

运行：`pnpm --filter worktree-manager test`

预期结果：通过。

### 任务 6: 建立 provider capability registry 与 doctor 预检

**涉及文件：**
- 创建：`packages/provider-registry/src/index.ts`
- 创建：`apps/dispatcher/src/modules/doctor/service.ts`
- 创建：`docs/contracts/provider-capabilities-v1.md`
- 测试：`packages/provider-registry/src/index.test.ts`

**第 1 步：为 provider 能力矩阵写失败测试**

覆盖：
- `codex` 支持 `sandbox`
- `gemini` 不支持 `sandbox`
- 不支持的权限键在 `strict` 模式下 fail closed

**第 2 步：运行测试确认失败**

运行：`pnpm --filter provider-registry test`

预期结果：失败。

**第 3 步：实现 provider registry**

提供：
- provider 可用性声明
- 支持的权限键
- 默认运行参数
- 支持的任务模式

**第 4 步：实现 doctor service**

至少检查：
- CLI binary 是否存在
- provider 是否已认证
- 当前 provider 是否满足项目契约

**第 5 步：冻结能力矩阵文档**

在 `docs/contracts/provider-capabilities-v1.md` 写清 provider 权限键、默认值和执行语义。

**第 6 步：重新运行测试**

运行：`pnpm --filter provider-registry test`

预期结果：通过。

### 任务 7: 实现 4 个 MCP servers

**涉及文件：**
- 创建：`packages/mcp-scheduler/src/server.ts`
- 创建：`packages/mcp-github/src/server.ts`
- 创建：`packages/mcp-repo-policy/src/server.ts`
- 创建：`packages/mcp-review-gate/src/server.ts`
- 测试：`packages/mcp-scheduler/src/server.test.ts`

**第 1 步：先实现 scheduler server 的失败测试**

覆盖：
- `create_tasks`
- `assign_task`
- `get_assigned_task`

**第 2 步：运行测试确认失败**

运行：`pnpm --filter mcp-scheduler test`

预期结果：失败。

**第 3 步：实现 scheduler server**

暴露最小工具：
- `create_tasks`
- `list_ready_tasks`
- `assign_task`
- `heartbeat`
- `start_task`
- `complete_task`
- `fail_task`

**第 4 步：实现其余三个 server 的最小可用版本**

分别暴露：
- GitHub API 封装
- 路径校验与测试命令查询
- Review/merge gate

**第 5 步：运行 MCP 包测试**

运行：`pnpm --filter "mcp-*" test`

预期结果：核心 MCP 包测试通过。

### 任务 8: 接入 Codex 与 Gemini worker 运行时

**涉及文件：**
- 创建：`apps/dispatcher/src/modules/runtime/codex.ts`
- 创建：`apps/dispatcher/src/modules/runtime/gemini.ts`
- 创建：`.codex/config.toml`
- 创建：`.gemini/settings.json`

**第 1 步：定义 worker 执行接口**

抽象统一接口：
- `launchTask`
- `collectResult`
- `cancelTask`
- `runVerification`
- `supportsMode`

**第 2 步：实现 Codex 运行时适配**

固定：
- control 使用 `GPT-5.4`
- worker 使用 `GPT-5.2-Codex`

**第 3 步：实现 Gemini 运行时适配**

固定：
- worker 使用 `gemini-2.5-pro`

**第 4 步：执行一次本地干跑**

运行：`pnpm --filter dispatcher test runtime`

预期结果：适配层能生成正确命令行与任务参数。

### 任务 9: 实现 review gate 与交叉验证流

**涉及文件：**
- 修改：`packages/mcp-review-gate/src/server.ts`
- 创建：`apps/dispatcher/src/modules/review/service.ts`
- 测试：`apps/dispatcher/src/modules/review/service.test.ts`

**第 1 步：为交叉验证流写失败测试**

覆盖：
- worker 自测通过后才能进入 review
- review gate 可收集 PR 材料
- CI 未通过时拒绝 merge
- `review` 模式输出必须满足 findings contract
- 可生成 PR markdown 输出

**第 2 步：运行测试确认失败**

运行：`pnpm --filter dispatcher test review/service.test.ts`

预期结果：失败。

**第 3 步：实现 review service**

封装：
- `collectReviewMaterial`
- `requestStructuredReview`
- `isMergeReady`
- `renderMarkdownPr`

**第 4 步：重新运行测试**

运行：`pnpm --filter dispatcher test review/service.test.ts`

预期结果：通过。

### 任务 10: 实现最小观测面

**涉及文件：**
- 创建：`services/observability/src/store.ts`
- 创建：`services/observability/src/server.ts`
- 测试：`services/observability/src/server.test.ts`
- 创建：`docs/observability.md`

**第 1 步：为事件存储写失败测试**

覆盖：
- 记录 worker 状态事件
- 记录任务流转事件
- 读取最近事件

**第 2 步：运行测试确认失败**

运行：`pnpm --filter observability test`

预期结果：失败。

**第 3 步：实现最小事件存储与 HTTP 查询接口**

至少提供：
- 最近事件查询
- 当前 worker 状态查询
- 最近失败任务查询

**第 4 步：编写观测文档**

在 `docs/observability.md` 说明事件类型、保留规则和最小 UI 需求。

**第 5 步：重新运行测试**

运行：`pnpm --filter observability test`

预期结果：通过。

### 任务 11: 生成目标仓接入模板

**涉及文件：**
- 创建：`templates/workflows/ai-dispatch.yml`
- 创建：`templates/workflows/ai-ci.yml`
- 创建：`templates/workflows/ai-verify-merge.yml`
- 创建：`docs/onboarding.md`

**第 1 步：实现三个 workflow 模板**

模板至少覆盖：
- workflow_dispatch 入口
- CI 校验
- merge 前校验

**第 2 步：编写 onboarding 文档**

在 `docs/onboarding.md` 说明：
- 新仓如何放入 `.orchestrator/project.yaml`
- 如何启用 branch protection
- 如何配置 secrets 与 runner

**第 3 步：人工校对模板变量**

检查模板中的仓库占位符、命令字段和分支字段是否一致。

### 任务 12: 跑通单仓接入演练

**涉及文件：**
- 创建：`examples/repo-a/.orchestrator/project.yaml`
- 创建：`examples/repo-a/AGENTS.md`
- 创建：`examples/repo-a/GEMINI.md`
- 创建：`docs/e2e-smoke-checklist.md`

**第 1 步：准备一个示例仓配置**

在 `examples/repo-a/` 下放入最小接入文件。

**第 2 步：执行端到端演练**

模拟：
- 读取项目契约
- 运行 doctor 预检
- 创建任务
- 生成 worktree
- 选择 worker
- 生成分支与 PR 参数
- 记录事件

**第 3 步：记录 smoke checklist**

在 `docs/e2e-smoke-checklist.md` 写清手工验收项。

**第 4 步：运行总体验证**

运行：
- `pnpm -r test`
- `pnpm -r typecheck`

预期结果：全部通过。

### 任务 13: 接入第二个仓库并验证复用性

**涉及文件：**
- 创建：`examples/repo-b/.orchestrator/project.yaml`
- 创建：`docs/multi-repo-validation.md`

**第 1 步：创建第二个项目契约**

模拟另一个技术栈或目录结构略有不同的仓库。

**第 2 步：验证路由规则是否隔离**

确认不同仓库的路径、命令和治理规则互不污染。

**第 3 步：编写验证结论**

在 `docs/multi-repo-validation.md` 中记录：
- 哪些能力已组织级复用
- 哪些仍需仓库级覆盖

### 任务 14: 发布 v1 并准备 Phase 2 边界

**涉及文件：**
- 创建：`docs/release-v1.md`
- 创建：`docs/phase-2-openclaw.md`

**第 1 步：整理 v1 发布说明**

总结：
- 已支持的 worker
- 已支持的仓库接入能力
- 当前限制

**第 2 步：定义 Phase 2 边界**

在 `docs/phase-2-openclaw.md` 中只列：
- OpenClaw 的目标职责
- ACP 的接入边界
- 不进入 v1 主链路的原因
- MCO 风格的 multi-provider parallel review / synthesis / memory 何时启用

**第 3 步：最终验证**

运行：`pnpm -r test && pnpm -r typecheck`

预期结果：全部通过。

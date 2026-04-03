# 多机 Worker 注册与审查控制面实施计划

> **致 AI 助手：** 必须具备子技能：使用 superpowers:executing-plans 逐项实施此计划。

**目标：** 为 forgeflow-platform 增加常驻 dispatcher server、多机 worker daemon、PR/review 决策和最小 dashboard。

**架构：** 先保留现有 `ai-dispatch -> .orchestrator` 产物链路，再增加一个中心 dispatcher server 作为多机运行时；worker daemon 从 server 拉取任务并执行，审查决策再经 server 回写状态。

**技术栈：** Node.js、TypeScript 测试、原生 HTTP、JSON 文件状态、GitHub REST API

---

### 任务 1: 固化设计和状态模型

**涉及文件：**
- 创建：`docs/plans/2026-03-16-multi-machine-runtime-design.md`
- 创建：`docs/plans/2026-03-16-multi-machine-runtime.md`

**第 1 步：补充多机运行时设计文档**

写清：
- dispatcher server 的职责
- worker daemon 的职责
- review / merge 决策边界
- dashboard 范围

**第 2 步：核对目标状态机**

确保状态机覆盖：
- `ready -> assigned`
- `assigned -> in_progress`
- `in_progress -> review/failed`
- `review -> merged/blocked`

**第 3 步：提交**

```bash
git add docs/plans/2026-03-16-multi-machine-runtime-design.md docs/plans/2026-03-16-multi-machine-runtime.md
git commit -m "docs: add multi-machine runtime design"
```

### 任务 2: 实现 dispatcher server 状态层

**涉及文件：**
- 创建：`scripts/lib/dispatcher-state.mjs`
- 测试：`apps/dispatcher/tests/modules/server/dispatcher-state.test.ts`

**第 1 步：编写失败的测试**

覆盖：
- worker 注册 / heartbeat
- dispatch 导入和分配
- worker 结果回写
- review 决策

**第 2 步：实现 JSON 状态存储**

状态至少包含：
- `workers`
- `tasks`
- `events`
- `assignments`
- `reviews`
- `pullRequests`

**第 3 步：运行测试以验证通过**

运行：`pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-state.test.ts`

**第 4 步：提交**

```bash
git add scripts/lib/dispatcher-state.mjs apps/dispatcher/tests/modules/server/dispatcher-state.test.ts
git commit -m "feat: add dispatcher runtime state store"
```

### 任务 3: 实现 dispatcher server HTTP API

**涉及文件：**
- 创建：`scripts/lib/dispatcher-server.mjs`
- 创建：`scripts/run-dispatcher-server.mjs`
- 测试：`apps/dispatcher/tests/modules/server/dispatcher-server.test.ts`

**第 1 步：编写失败的 API 测试**

覆盖：
- `POST /api/workers/register`
- `POST /api/workers/:id/heartbeat`
- `POST /api/dispatches`
- `GET /api/workers/:id/assigned-task`
- `POST /api/workers/:id/result`
- `POST /api/reviews/:taskId/decision`
- `GET /api/dashboard/snapshot`

**第 2 步：实现原生 HTTP server**

使用 Node `http` 模块，不引入额外服务框架。

**第 3 步：运行测试**

运行：`pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-server.test.ts`

**第 4 步：提交**

```bash
git add scripts/lib/dispatcher-server.mjs scripts/run-dispatcher-server.mjs apps/dispatcher/tests/modules/server/dispatcher-server.test.ts
git commit -m "feat: add dispatcher server api"
```

### 任务 4: 实现 dispatch 产物发布脚本

**涉及文件：**
- 创建：`scripts/dispatch-orchestrator-to-server.mjs`
- 测试：`apps/dispatcher/tests/modules/server/dispatch-orchestrator-to-server.test.ts`

**第 1 步：编写失败的测试**

验证脚本会读取：
- `task-ledger.json`
- `assignment package`

并成功发布到 dispatcher server。

**第 2 步：实现脚本**

支持：
- `--dispatcher-url`
- `--orchestrator-dir`
- `--requested-by`

**第 3 步：运行测试**

运行：`pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatch-orchestrator-to-server.test.ts`

**第 4 步：提交**

```bash
git add scripts/dispatch-orchestrator-to-server.mjs apps/dispatcher/tests/modules/server/dispatch-orchestrator-to-server.test.ts
git commit -m "feat: add dispatch publish script"
```

### 任务 5: 实现 worker daemon

**涉及文件：**
- 创建：`scripts/run-worker-daemon.mjs`
- 测试：`apps/dispatcher/tests/modules/server/run-worker-daemon.test.ts`

**第 1 步：编写失败的测试**

覆盖：
- worker 注册
- 拉取 assigned task
- 物化 assignment package
- 回写执行结果

**第 2 步：实现 daemon**

支持：
- `--dispatcher-url`
- `--worker-id`
- `--pool`
- `--repo-dir`
- `--once`
- `--dry-run-execution`

**第 3 步：运行测试**

运行：`pnpm --filter @forgeflow/dispatcher test tests/modules/server/run-worker-daemon.test.ts`

**第 4 步：提交**

```bash
git add scripts/run-worker-daemon.mjs apps/dispatcher/tests/modules/server/run-worker-daemon.test.ts
git commit -m "feat: add worker daemon"
```

### 任务 6: 串上 review / merge 决策脚本

**涉及文件：**
- 创建：`scripts/submit-review-decision.mjs`
- 测试：`apps/dispatcher/tests/modules/server/submit-review-decision.test.ts`

**第 1 步：编写失败的测试**

覆盖：
- `merge`
- `rework`

**第 2 步：实现脚本**

支持：
- 提交 review 决策到 dispatcher
- 可选同步调用 GitHub merge API

**第 3 步：运行测试**

运行：`pnpm --filter @forgeflow/dispatcher test tests/modules/server/submit-review-decision.test.ts`

**第 4 步：提交**

```bash
git add scripts/submit-review-decision.mjs apps/dispatcher/tests/modules/server/submit-review-decision.test.ts
git commit -m "feat: add review decision script"
```

### 任务 7: 实现最小 dashboard

**涉及文件：**
- 创建：`scripts/lib/dashboard.html`
- 修改：`scripts/lib/dispatcher-server.mjs`
- 测试：`apps/dispatcher/tests/modules/server/dashboard.test.ts`

**第 1 步：实现 snapshot HTML 页面**

页面展示：
- worker 列表
- 任务列表
- review / PR 状态
- 最近事件

**第 2 步：提供 `/dashboard`**

直接由 dispatcher server 提供静态 HTML。

**第 3 步：运行测试**

运行：`pnpm --filter @forgeflow/dispatcher test tests/modules/server/dashboard.test.ts`

**第 4 步：提交**

```bash
git add scripts/lib/dashboard.html scripts/lib/dispatcher-server.mjs apps/dispatcher/tests/modules/server/dashboard.test.ts
git commit -m "feat: add dispatcher dashboard"
```

### 任务 8: 更新总调度链路和文档

**涉及文件：**
- 修改：`scripts/run-codex-control-flow.mjs`
- 修改：`README.md`
- 修改：`docs/onboarding.md`
- 修改：`prompts/codex-control.md`
- 修改：`prompts/codex-control-session-template.md`

**第 1 步：增加 `--dispatcher-url` 支持**

使总控可在下载 artifact 后直接发布到 dispatcher server，而不是只能本地执行。

**第 2 步：更新 README**

加入：
- 如何启动 dispatcher server
- 如何启动多机 worker
- 如何查看 dashboard
- 如何提交 review 决策

**第 3 步：运行完整回归**

运行：

```bash
pnpm test
pnpm typecheck
git diff --check
```

**第 4 步：提交**

```bash
git add scripts/run-codex-control-flow.mjs README.md docs/onboarding.md prompts/codex-control.md prompts/codex-control-session-template.md
git commit -m "feat: wire multi-machine control flow"
```

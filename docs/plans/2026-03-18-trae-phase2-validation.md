# Trae 第二阶段真机联调与任务拆分实施计划

> **致 AI 助手：** 必须具备子技能：使用 superpowers:executing-plans 逐项实施此计划。

**目标：** 将 Trae MCP worker 从“协议验证可用”推进到“真实项目内执行、状态可观测、结果可回写”的第二阶段真机联调闭环。

**架构：** Trae worker 固定绑定一个 `repo_dir`，dispatcher 只向该项目派发任务；任务 payload 只描述项目内执行内容，并通过 `register -> fetch_task -> start_task -> report_progress -> submit_result` 完成闭环。自动 heartbeat 由 Trae MCP runtime 托管，dispatcher 负责状态真相源与事件落账。

**技术栈：** Node.js、dispatcher HTTP API、stdio MCP server、Trae Agent、pnpm、git worktree

---

### 任务 1: 固化 repo_dir 绑定模型与任务协议

**涉及文件：**
- 修改：`README.md`
- 修改：`docs/onboarding.md`
- 参考：`packages/mcp-trae-worker/src/server.ts`
- 参考：`scripts/run-trae-mcp-worker-server.mjs`

**第 1 步：统一文档中的 worker 模型**

写清以下约束：
- 一台 Trae worker 绑定一个 `repo_dir`
- `register` / `fetch_task` 都必须显式传入 `repo_dir`
- task payload 不负责切项目，只描述项目内执行

**第 2 步：统一工具调用顺序**

文档中统一为：
- `register`
- `fetch_task`
- `start_task`
- `report_progress`
- `submit_result`

**第 3 步：校正文档中过时描述**

删除或修正：
- 旧的 MCP server 启动参数
- “第二阶段没有自动 heartbeat” 这类过时描述

**第 4 步：验证文档差异格式**

运行：`git diff --check`
预期结果：无格式错误

---

### 任务 2: 完成 Trae 第二阶段 smoke 联调

**涉及文件：**
- 运行：`scripts/run-dispatcher-server.mjs`
- 运行：`scripts/run-trae-mcp-worker-server.mjs`
- 观察：`scripts/lib/dispatcher-server.mjs`
- 业务仓：`/abs/path/to/target-repo`

**第 1 步：启动 dispatcher**

运行：
```bash
node scripts/run-dispatcher-server.mjs \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

预期结果：`/health` 返回 `{"status":"ok"}`

**第 2 步：启动 Trae MCP server**

运行：
```bash
node scripts/run-trae-mcp-worker-server.mjs \
  --dispatcher-url http://127.0.0.1:8787 \
  --worker-id trae-01
```

预期结果：Trae 可以加载 MCP tools

**第 3 步：创建一条 `pool=trae` 的文档任务**

要求：
- `allowedPaths = ["docs/**"]`
- `repo_dir = /abs/path/to/target-repo`
- acceptance 至少包含 `pnpm test` 和 `pnpm typecheck`

**第 4 步：让 Trae 运行完整工具链**

要求按顺序完成：
- `register`
- `fetch_task`
- `start_task`
- `report_progress`
- `submit_result`

预期结果：
- `worktree_dir` / `assignment_dir` 为真实存在目录
- worker 在执行期间保持 `busy`
- 任务最终进入 `review` 或 `failed`

---

### 任务 3: 验证真实结果回写与状态一致性

**涉及文件：**
- 观察：`scripts/lib/dispatcher-state.mjs`
- 观察：`scripts/lib/dispatcher-server.mjs`
- 观察：`packages/mcp-trae-worker/src/server.ts`

**第 1 步：验证 progress 事件落账**

检查：
- `report_progress` 是否写入事件流
- payload 是否至少包含 `task_id`、`message`、`worker_id`

**第 2 步：验证 worker 状态流转**

期望：
- `idle -> busy`：`start_task` 后
- `busy -> idle`：`submit_result` 后
- `busy/idle -> offline`：仅在 heartbeat 超时后

**第 3 步：验证 submit_result 内容真实性**

检查结果至少包含：
- `summary`
- `test_output`
- `risks`
- `files_changed`

不得接受：
- 虚构测试输出
- 超 scope 文件修改

---

### 任务 4: 第二阶段后续拆分

**涉及文件：**
- 修改：`docs/plans/2026-03-18-trae-phase2-validation.md`

**第 1 步：将剩余工作拆成独立后续项**

后续项至少拆成：
- 真实代码任务联调（不仅是文档任务）
- GitHub / review 证据链集成
- 多 Trae worker 并发与抢单治理
- Trae worker 失败重试与恢复策略

**第 2 步：明确不在第二阶段内的边界**

保留为后续项，不并入本次联调：
- 自动 merge
- 自动 PR 决策
- Trae 作为总调度
- 输入框自动填充 / 自动发送

**第 3 步：更新计划状态**

在本计划底部补一段执行备注：
- 哪些步骤已经完成
- 哪些步骤仍待联调

---

计划完成后，优先执行任务 2 的真机 smoke 联调，再根据结果决定是否推进任务 4 的后续拆分。

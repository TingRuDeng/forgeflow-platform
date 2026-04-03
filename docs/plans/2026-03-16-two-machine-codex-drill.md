# 真实两机 Codex 演练实施计划

> **致 AI 助手：** 必须具备子技能：使用 superpowers:executing-plans 逐项实施此计划。

**目标：** 让 ForgeFlow 能按方案 A 跑一次两台真实设备的 `codex-worker` 调度演练。

**架构：** 保留现有 dispatcher server / worker daemon 主链路，补上“晚到 worker 领取 ready 任务”的状态推进，再提供双 `codex` 演练专用 planner 和操作 runbook。

**技术栈：** Node.js、Vitest、原生 Git / GitHub Actions、JSON 状态文件

---

### 任务 1: 固化两机演练设计

**涉及文件：**
- 创建：`docs/plans/2026-03-16-two-machine-codex-drill-design.md`
- 创建：`docs/plans/2026-03-16-two-machine-codex-drill.md`

**第 1 步：写清演练拓扑与成功标准**

**第 2 步：提交**

```bash
git add docs/plans/2026-03-16-two-machine-codex-drill-design.md docs/plans/2026-03-16-two-machine-codex-drill.md
git commit -m "docs: add two-machine codex drill design"
```

### 任务 2: 让晚到 worker 能领取 ready 任务

**涉及文件：**
- 修改：`scripts/lib/dispatcher-state.mjs`
- 修改：`scripts/lib/dispatcher-server.mjs`
- 测试：`apps/dispatcher/tests/modules/server/dispatcher-state.test.ts`
- 测试：`apps/dispatcher/tests/modules/server/run-worker-daemon.test.ts`

**第 1 步：先写失败测试**

覆盖：
- dispatch 创建时无 worker，任务进入 `ready`
- worker 后注册并请求任务时，能自动 claim
- claim 后任务进入 `assigned`
- daemon 可继续执行并推进到 `review`

**第 2 步：补状态流转**

新增 `ready -> assigned` 领取逻辑。

**第 3 步：运行定向测试**

运行：
`pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-state.test.ts tests/modules/server/run-worker-daemon.test.ts`

### 任务 3: 增加双 codex 演练专用输入

**涉及文件：**
- 创建：`scripts/create-two-codex-drill-planner.mjs`
- 测试：`apps/dispatcher/tests/modules/server/create-two-codex-drill-planner-script.test.ts`
- 测试：`apps/dispatcher/tests/modules/server/two-machine-codex-drill.test.ts`

**第 1 步：写一个双 codex planner 生成脚本**

固定输出两个 `codex` 任务。

**第 2 步：补两机双任务测试**

验证两个 `codex` 任务会分配到两个不同 worker。

**第 3 步：运行测试**

运行：
`pnpm --filter @forgeflow/dispatcher test tests/modules/server/create-two-codex-drill-planner-script.test.ts tests/modules/server/two-machine-codex-drill.test.ts`

### 任务 4: 编写真实演练 runbook

**涉及文件：**
- 创建：`docs/runbooks/two-machine-codex-drill.md`
- 修改：`README.md`

**第 1 步：写出三端命令**

包含：
- 调度中心机器命令
- 第二台 worker 机器命令
- 总调度机器命令

**第 2 步：写 dashboard 观察点**

**第 3 步：写 review 决策命令**

### 任务 5: 运行全量验证并提交

**第 1 步：运行全量测试**

运行：
`pnpm test`
`pnpm typecheck`
`git diff --check`

**第 2 步：提交**

```bash
git add .
git commit -m "feat: add two-machine codex drill support"
```

# Worker 执行入口 实施计划

> **致 AI 助手：** 必须具备子技能：使用 superpowers:executing-plans 逐项实施此计划。

**目标：** 补充仓库 README，并让 `codex-worker` / `gemini-worker` 能从 assignment package 启动一次最小执行流程。

**架构：** 在 runtime 层增加“从 assignment package 构建 launch input”的辅助函数，再提供一个独立脚本读取 assignment 目录、调用对应 provider CLI、写回原始输出和标准化结果。README 同步补充 dispatch、planner、assignment package 和 worker 执行用法。

**技术栈：** Node.js、TypeScript、Vitest、Codex CLI、Gemini CLI

---

### 任务 1: 设计并测试 assignment package 到 runtime 输入的转换

**涉及文件：**
- 创建：`apps/dispatcher/src/modules/runtime/assignment.ts`
- 创建：`apps/dispatcher/tests/modules/runtime/assignment.test.ts`
- 修改：`apps/dispatcher/src/modules/runtime/types.ts`

**第 1 步：编写失败的测试**

在 `apps/dispatcher/tests/modules/runtime/assignment.test.ts` 中增加测试，覆盖：
- 从 `assignment.json` + `worker-prompt.md` 构建 `RuntimeLaunchInput`
- 从 assignment 包中提取验证命令
- 从 assignment 输出构建标准化结果结构

**第 2 步：运行测试以验证其失败**

运行：`pnpm test apps/dispatcher/tests/modules/runtime/assignment.test.ts`
预期结果：失败，提示模块或导出不存在。

**第 3 步：编写最简实现**

在 `apps/dispatcher/src/modules/runtime/assignment.ts` 中实现：
- `buildLaunchInputFromAssignmentPackage`
- `buildVerificationInputFromAssignmentPackage`
- `buildWorkerExecutionResult`

如有必要，在 `apps/dispatcher/src/modules/runtime/types.ts` 中补充 assignment 相关类型。

**第 4 步：运行测试以验证其通过**

运行：`pnpm test apps/dispatcher/tests/modules/runtime/assignment.test.ts`
预期结果：通过。

**第 5 步：提交**

```bash
git add apps/dispatcher/src/modules/runtime/assignment.ts apps/dispatcher/tests/modules/runtime/assignment.test.ts apps/dispatcher/src/modules/runtime/types.ts
git commit -m "feat: add assignment runtime helpers"
```

### 任务 2: 提供最小 worker 执行脚本

**涉及文件：**
- 创建：`scripts/run-worker-assignment.mjs`

**第 1 步：编写失败的测试**

优先通过现有 runtime 辅助层的测试覆盖脚本需要的输入输出契约，不为 CLI 脚本本身增加重型集成测试。

**第 2 步：运行测试以验证其失败**

运行：`node --check scripts/run-worker-assignment.mjs`
预期结果：脚本不存在或语法检查失败。

**第 3 步：编写最简实现**

实现一个 Node 脚本，支持：
- `--assignment-dir`
- `--worktree-dir`
- `--output-dir`（可选，默认写回 assignment 目录）
- `--dry-run`

脚本行为：
- 读取 `assignment.json`
- 读取 `worker-prompt.md`
- 根据 `pool` 选择 `codex` 或 `gemini`
- 调用对应 CLI
- 输出：
  - `worker-output.raw.txt`
  - `worker-result.json`
  - `worker-verification.json`

**第 4 步：运行测试以验证其通过**

运行：
- `node --check scripts/run-worker-assignment.mjs`
- 用 `--dry-run` 跑一次示例 assignment，确认 payload 正确

**第 5 步：提交**

```bash
git add scripts/run-worker-assignment.mjs
git commit -m "feat: add worker assignment runner"
```

### 任务 3: 更新 README 和使用说明

**涉及文件：**
- 创建：`README.md`
- 可能修改：`docs/codex-control-usage.md`

**第 1 步：编写失败的测试**

不为文档单独写测试，改用结构化检查：
- README 必须包含 forgeflow-platform 简介
- README 必须包含 `ai-dispatch`
- README 必须包含 `trigger-ai-dispatch.mjs`
- README 必须包含 `run-worker-assignment.mjs`

**第 2 步：运行检查以验证其失败**

运行：`test -f README.md`
预期结果：当前失败，因为仓库还没有 README。

**第 3 步：编写最简实现**

新增 `README.md`，至少写清：
- forgeflow-platform 是什么
- 当前主链路
- planner / dispatch / assignment package / worker execution
- 两个脚本的使用方式

**第 4 步：运行检查以验证其通过**

运行：
- `test -f README.md`
- `rg "ai-dispatch|trigger-ai-dispatch|run-worker-assignment" README.md`

预期结果：通过。

**第 5 步：提交**

```bash
git add README.md docs/codex-control-usage.md
git commit -m "docs: add forgeflow README"
```

### 任务 4: 全量验证

**涉及文件：**
- 修改：本次变更涉及的全部文件

**第 1 步：运行定向测试**

运行：
- `pnpm test apps/dispatcher/tests/modules/runtime/assignment.test.ts`

**第 2 步：运行仓库测试**

运行：
- `pnpm test`

**第 3 步：运行类型检查**

运行：
- `pnpm typecheck`

**第 4 步：运行补充校验**

运行：
- `git diff --check`
- `node --check scripts/run-worker-assignment.mjs`

**第 5 步：提交与推送**

```bash
git add .
git commit -m "feat: add worker execution entry"
git push
```

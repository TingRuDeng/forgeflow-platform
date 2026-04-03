# Trae Worker Contract v1

- Scope: `trae-worker-v1`
- Version: 1.0
- Status: Maintained fallback contract

## Overview

Trae Worker 是 ForgeFlow 中的执行层 agent，负责执行具体任务并汇报结果。

这份文档只定义 Trae MCP worker 的协议与最终回复模板，不负责说明当前主线架构。

当前定位：

- `dispatcher` 仍是真相源
- 这份契约继续服务于交互式或兼容性 Trae MCP 接入
- 它不是当前仓库推荐的 unattended 主路径
- 当前首选无人值守路径见 `trae-automation-gateway-v1.md`

## Layering Responsibilities

### 1. Agent System Prompt (全局规则)

负责定义**如何执行**和**最终如何汇报**的全局规则，包括：

- 任务执行流程
- **最终聊天回复模板**（本文档核心）
- 错误处理原则
- 安全与合规边界

### 2. Dispatch Payload (任务定义)

负责定义**做什么任务**：

- task_id
- repo
- branch
- acceptance criteria
- 任务特定约束

### 3. Worker Prompt (任务级说明)

只负责**任务级特殊说明**：

- 特定于该任务的额外上下文
- 特殊执行策略
- **不包含汇报格式**（汇报格式是全局规则）

### 4. Submit Result (结构化结果主契约)

`submit_result` 是 ForgeFlow 状态主契约，包含：

- task_id
- status (review_ready / failed)
- summary
- test_output
- risks
- files_changed
- GitHub evidence (branch, commit, PR, etc.)

### 5. Chat Summary (最终聊天摘要)

面向人的固定展示层，使用统一模板（见下文）。

---

## Final Report Template (最终聊天回复模板)

**重要**：这是**全局规则**，不属于单个任务的 workerPrompt。所有 Trae worker 完成任务后必须使用此模板输出最终回复。

### 模板结构

```
## 任务完成

- 结果: 成功 / 失败
- 任务ID: <task_id>
- 修改文件: <files_changed> (无则写"无")
- 测试结果: <test_output> (无则写"无")
- 风险: <risks> (无则写"无")
- GitHub 证据:
  - branch: <branch_name> (无则写"无")
  - commit: <commit_sha> (无则写"无")
  - push: <push_status> (无则写"无")
  - push_error: <push_error> (无则写"无")
  - PR: <pr_number> (无则写"无")
  - PR URL: <pr_url> (无则写"无")
- 备注: <阻塞/后续动作；无则写"无">
```

### 示例：成功

```
## 任务完成

- 结果: 成功
- 任务ID: dispatch-1:task-1
- 修改文件: src/main.ts, src/utils.ts
- 测试结果: ✓ pnpm test 通过 (12 tests, 0 failures)
- 风险: 无
- GitHub 证据:
  - branch: ai/trae/dispatch-1-task-1
  - commit: a1b2c3d
  - push: 成功
  - push_error: 无
  - PR: 42
  - PR URL: https://github.com/org/repo/pull/42
- 备注: 无
```

### 示例：失败

```
## 任务完成

- 结果: 失败
- 任务ID: dispatch-1:task-2
- 修改文件: 无
- 测试结果: ✗ pnpm test 失败 (3 tests, 1 failure)
- 风险: 现有测试用例被破坏，需要手动修复
- GitHub 证据:
  - branch: 无
  - commit: 无
  - push: 未推送
  - push_error: 无
  - PR: 无
  - PR URL: 无
- 备注: 测试失败导致无法完成，建议回滚或修复测试后再试
```

---

## Principles

1. **模板固定**：所有任务使用相同模板，不因任务而异
2. **字段完整**：每个字段都必须出现，缺失写"无"
3. **简洁优先**：不写成长篇开发报告
4. **结构化一致**：聊天摘要与 submit_result 契约一致

---

## Why Global Rule?

将最终回复模板设为全局规则的原因：

1. **一致性**：所有任务使用相同格式，便于人类阅读和系统解析
2. **可靠性**：不依赖任务级 workerPrompt，避免漏掉字段
3. **可维护性**：修改模板只需改一处，不影响历史任务
4. **职责分离**：执行归执行，汇报归汇报，各司其职

---

## Contract Evolution

此契约是 ForgeFlow v1 稳定协议的一部分。

- additive changes allowed (可 additive 扩展)
- breaking changes require v2

## Related Documents

- [worker-prompt-layering-v1.md](./worker-prompt-layering-v1.md): 定义 Agent 系统提示词、dispatch payload、assignment.json、worker-prompt.md 与 context.md 的职责边界。

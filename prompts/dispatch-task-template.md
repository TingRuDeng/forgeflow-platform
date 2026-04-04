# Dispatch Task 模板

给 ForgeFlow worker 派发代码任务时，优先使用这份模板作为任务级 prompt 骨架。

目标不是“把需求描述给 worker”，而是把任务收紧成一个可审、可验、可打回的变更单元，减少 worker 自由发挥空间，降低反复 rework。

适用场景：

- 通过 dispatcher / `worker-review-orchestrator` 给 `codex`、`gemini`、`Trae` worker 派发代码任务
- 需要稳定携带仓库级上下文
- 需要把 review finding 转成明确返工要求

不适用场景：

- 控制层会话开场
- 业务仓的 agent bootstrap
- 不涉及代码交付的纯讨论任务

## 发单质量门

派发前至少确认下面 7 项都已经写清：

1. `Goal`
   必须是 reviewer 能判定“完成 / 未完成”的一句话结果，而不是主题。
2. `Source of Truth`
   必须写清以哪个现有实现、契约文档或 commit 为准，避免 worker 自创 schema。
3. `Allowed Paths`
   尽量写精确文件路径，不要只给大目录通配。
4. `Non-Goals`
   必须写明这次不做什么，防止顺手扩 scope。
5. `Required Changes`
   必须拆成可检查的事项，不要只写“修这个问题”。
6. `Acceptance`
   必须包含可执行命令和必要的测试覆盖点，不要只写“功能正常”。
7. `Completion Receipt`
   必须要求 branch / commit / push / test evidence / residual risk。

如果是返工任务，再额外确认：

- 每条 review finding 都已经映射成一个 `Required Change`
- 明确列出必须修复的点，而不是写“按 review 修改”
- 如果依赖上游任务，必须写清基于哪个 branch / commit / merged behavior

如果使用 `forgeflow-review-orchestrator dispatch-task` 手工发单，优先打开 `--strict-task-spec`，并把下面这些段落对应到 CLI 字段：

- `Goal` -> `--goal`
- `Source of Truth` -> `--source-of-truth`
- `Disallowed Paths` -> `--disallowed-paths`
- `Required Changes` -> `--required-changes`
- `Non-Goals` -> `--non-goals`
- `Must Preserve` -> `--must-preserve`
- `Rework Mapping` -> `--rework-mapping`

## 推荐模板

```text
你在 ForgeFlow 仓库里执行一个明确范围的任务。

在开始之前，先阅读：
1. AGENTS.md
2. docs/README.md
3. docs/AGENT_STARTER_PROMPT.md
4. 如果目标模块有本地 README.md，也先阅读对应 README

# Goal
<用 1 到 3 句写清本次必须完成的结果。避免写成主题。>

# Source of Truth
- <现有实现文件 / 契约文档 / commit / PR>
- <如果是 follow-up / rework，写明必须对齐的上游结果>
- 不允许引入平行 schema / 平行状态语义 / 自定义字段名

# Task Context
<只写本次任务必需的背景，不复制仓库通用规则。>

# Allowed Paths
- <精确路径 1>
- <精确路径 2>

# Disallowed Paths
- <明确禁止修改的路径 1>
- <明确禁止修改的路径 2>

# Required Changes
1. <必须完成的变更 1，写成 reviewer 可核对的结果>
2. <必须完成的变更 2>
3. <必须完成的变更 3>

# Non-Goals
- <这次不做的事情 1>
- <这次不做的事情 2>

# Must Preserve
- <不能破坏的旧行为 / 兼容性边界 1>
- <不能破坏的旧行为 / 兼容性边界 2>

# Acceptance
- Run: <command 1>
- Run: <command 2>
- Run: git diff --check
- 测试必须覆盖：
  - <case 1>
  - <case 2>

# Rework Mapping
<仅在返工任务中填写；逐条列 review finding -> required change。>
- Finding 1: <问题>
  Required fix: <这次必须达到的状态>
  Proof: <如何证明修到了>
- Finding 2: <问题>
  Required fix: <这次必须达到的状态>
  Proof: <如何证明修到了>

# Hard Constraints
- 只在 assigned task branch 上工作
- 不要扩 scope
- 不要把“现有实现已经足够”当成完成结果，除非你能给出代码与验证证据
- 如果产出代码，必须提供 branch / commit / push / test evidence
- 如果本次不需要改文档，收尾时明确写出 `no doc impact` 和原因

完成后严格按下面模板回复：

## 任务完成
- 结果: 成功 / 失败
- 修改文件:
  - <file list>
- 测试结果:
  - <command + result>
- 风险:
  - <无则写 无>
- GitHub 证据:
  - branch: <branch>
  - commit: <commit>
  - push: <success/failed/not_attempted>
  - push_error: <无则写 无>
  - PR: <number / 无>
  - PR URL: <url / 无>
- 备注:
  - <简短说明>
```

## 使用约定

- 仓库级规则始终以 `AGENTS.md` 为准。
- 文档导航始终以 `docs/README.md` 为准。
- `docs/AGENT_STARTER_PROMPT.md` 只负责统一入口提醒，不替代本模板里的任务级约束。
- 本模板只放可复用骨架；每个具体任务仍需填写 `Goal`、`Source of Truth`、`Allowed Paths`、`Non-Goals`、`Acceptance` 和 `Completion Receipt`。
- 如果任务描述写不出 `Non-Goals` 或 `Must Preserve`，说明任务边界还不够清晰，不应该直接派发。

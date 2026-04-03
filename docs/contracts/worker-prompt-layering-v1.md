# Worker Prompt Layering v1

## 目标

定义 forgeflow-platform 中 worker 协议、任务定义、执行材料与背景信息的 5 层分层边界，避免将这些职责混在一起。

这份文档用于约束：

- Agent 系统提示词写什么
- `dispatches` 请求里放什么
- `assignment_dir` 下的执行材料分别负责什么

---

## 总原则

一句话概括：

- **Agent 系统提示词**：规定“怎么执行”
- **dispatch payload**：规定“做什么任务”
- **assignment.json**：规定“执行契约”
- **worker-prompt.md**：规定“这次任务的细化说明”
- **context.md**：提供“背景资料”

禁止把这 5 层内容混成一层，尤其不要：

- 把整段 worker 协议塞进 `dispatches`
- 把单次任务细节长期固化到 Agent 系统提示词
- 把背景资料当作执行规则

---

## 1. Agent 系统提示词

**职责：定义 worker 协议**

适合放：

- worker 身份
- MCP tools 调用顺序
- 不可违反的执行约束
- 错误处理规则
- 结果提交的必填字段

典型内容：

- `register -> fetch_task -> start_task -> report_progress -> submit_result`
- 不得越过 `scope`
- 不得伪造测试结果
- 必须使用 `worktree_dir`
- 若 `assignment_dir` 存在，先读取其中材料

特点：

- 稳定
- 跨任务复用
- 不应频繁因单个任务变化而修改

---

## 2. dispatch payload

**职责：定义这次任务本身**

适合放：

- `task_id`
- `title`
- `pool`
- `allowedPaths`
- `acceptance`
- `branchName`
- `verification`
- 简短且结构化的任务描述

典型语义：

- 这次要做什么
- 允许改哪里
- 需要跑哪些命令
- 应路由到哪个 worker pool

特点：

- 结构化
- 简洁
- 便于程序生成、校验和传输

不适合放：

- 完整的 worker 协议
- 大段通用错误处理说明
- 多轮执行策略说明

---

## 3. assignment.json

**职责：定义执行契约**

适合放：

- 任务在运行时的结构化执行信息
- worker、branch、commands、repo、defaultBranch
- 需要被 runtime 稳定读取的最小字段集

特点：

- 偏机器读
- 比 `dispatch payload` 更贴近执行层
- 不负责承载长篇自然语言说明

---

## 4. worker-prompt.md

**职责：补充任务级执行说明**

适合放：

- 本次任务更具体的自然语言要求
- 对 `scope` 的强调
- 对输出格式的提醒
- 本任务的特殊注意事项

适合示例：

- 只允许修改 `docs/**`
- 完成后必须回报 `summary`、`test_output`、`risks`、`files_changed`
- 如信息不足，优先报告阻塞点，不要扩展范围

特点：

- 面向单次任务
- 可以更具体
- 但不应重复整套 worker 协议

---

## 5. context.md

**职责：提供背景资料**

适合放：

- 当前仓库背景
- 模块说明
- 相关路径
- 本任务的上下游信息
- 先读哪些现有文档或代码

特点：

- 提供理解上下文
- 不承担执行协议职责
- 不承担结果格式定义职责

---

## 推荐组合方式

在 forgeflow-platform 中，Trae worker 的推荐组合是：

1. **Worker 启动层固定 `repo_dir`**
   - 一台 Trae worker 绑定一个项目目录
   - `register` 和 `fetch_task` 都显式传入 `repo_dir`

2. **dispatch payload 只描述项目内任务**
   - task 只说明“在当前项目内做什么”
   - 不依赖任务正文让 Trae 切换项目

3. **assignment_dir 提供执行材料**
   - `assignment.json`
   - `worker-prompt.md`
   - `context.md`

4. **Agent 系统提示词只负责协议**
   - 约束工具调用和执行顺序
   - 不固化具体业务任务

---

## 反模式

以下做法应避免：

### 反模式 1：把系统提示词整段塞进 dispatch payload

问题：

- 重复
- 难维护
- 容易漂移
- 难以程序化处理

### 反模式 2：把每次任务的业务要求写死在 Agent 系统提示词里

问题：

- 让系统提示词承担任务内容职责
- 导致 agent 绑定某个具体任务，而不是通用 worker 协议

### 反模式 3：把 context.md 当成执行契约

问题：

- 背景和规则混杂
- 运行时难以稳定解析

---

## 适用范围

这份分层约束适用于：

- Trae MCP worker
- 后续同类 IDE 内 agent worker

它也可作为 `codex` / `gemini` worker 任务负载设计的参考，但不强制要求完全一致。

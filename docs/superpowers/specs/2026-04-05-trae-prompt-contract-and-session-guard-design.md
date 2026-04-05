# Trae Prompt 契约与会话防串读设计

## 背景

最近几次 Trae follow-up / rework 任务暴露出两类稳定问题：

1. 控制层可以通过自定义 `workerPrompt` 绕过 Trae runtime 默认完成模板，导致最终回执缺少 `任务ID` 这类必需字段。
2. `new_chat` 之后，automation gateway 仍可能从 DOM 中读到上一条任务的旧对话内容，导致新任务实际上已发送，但 `/v1/chat` 长时间不收敛。

这两个问题叠加后，会出现如下现象：

- Trae 实际已经输出"任务完成"
- worker 已经正常 claim task 并发送 prompt
- gateway 仍然把结果判为 `canFinish: false`
- dispatcher 看起来像"任务没有完成"或"worker 没拿到任务"

本设计只解决这两类问题，不修改 dispatcher 主状态机，也不重做 Trae worker 架构。

## 目标

1. 让 Trae 任务的最终 worker prompt 默认由 `worker-review-orchestrator-cli` 根据结构化输入统一生成。
2. 为自定义 Trae prompt 增加最小完成协议门禁，至少保证最终回执可被 runtime 正确识别。
3. 将最终渲染后的 prompt 作为任务记录的一部分持久化，方便审计、review 和 redrive。
4. 收窄 `new_chat` 后的 DOM 采样范围，避免 gateway 误读旧任务内容。
5. 只增加轻量 stale guard：检测"是否仍在读取前一个任务的内容"，不去猜测新 chat 的完整 UI 形态。

## 非目标

- 不新增 dispatcher 状态
- 不修改 worker result / review decision 的结构化 evidence 契约
- 不重写 Trae DOM driver 的整体架构
- 不引入复杂的"新 chat 正常形态识别"逻辑
- 不禁止所有自定义 prompt

## 核心判断

### 1. Prompt 问题的本质

当前真正缺少的不是 prompt 文件，而是 prompt 契约门禁。

Trae runtime 默认模板本身已经要求最终回执包含：

- `任务完成`
- `结果`
- `任务ID`
- `GitHub 证据`

但控制层通过自定义 `workerPrompt` 或 `workerPromptFile` 可以绕过这层默认模板。现有 `strictTaskSpec` 只校验任务结构字段，不校验最终 prompt 是否满足 Trae 完成协议。

因此，应该把"prompt 如何生成"和"最终 prompt 是否满足最小完成协议"前移到 CLI，而不是等 gateway 在 `/v1/chat` 结束时才发现回执不可接受。

### 2. Session 问题的本质

当前问题也不只是 `new_chat` 之后切换慢，而是 DOM 采样边界过宽。

现有 `captureResponseSnapshot()` 和 activity snapshot 会在页面级选择器上做全局采样，可能读到仍残留在 DOM 里的旧对话内容。即使 UI 已经切到新 chat，只要旧内容仍在可见或可采样容器内，gateway 就可能继续把它当成当前会话文本。

因此，核心修复不应只是 `sleep`，而是：

- 缩窄采样范围
- 再加一个只针对"旧任务仍被读取"的轻量守卫

## 方案

### 1. CLI 自动渲染 Trae Prompt

在 `worker-review-orchestrator-cli` 中新增 Trae 专用 prompt 渲染逻辑。

建议行为：

- 当 `pool !== "trae"` 时，维持现有逻辑
- 当 `pool === "trae"` 且未提供 custom prompt 时，CLI 根据结构化输入统一生成最终 `workerPrompt`
- 生成后的 prompt 固定附带标准完成模板

推荐最小完成模板：

```md
## 任务完成
- 结果: 成功 / 失败
- 任务ID: <task_id>
- 修改文件:
  - <file list；无则写 无>
- 测试结果:
  - <command + result；无则写 无>
- 风险:
  - <无则写 无>
- GitHub 证据:
  - branch: <branch / 无>
  - commit: <commit / 无>
  - push: <success/failed/not_attempted>
  - push_error: <无则写 无>
  - PR: <number / 无>
  - PR URL: <url / 无>
```

这里的重点不是模板外观，而是保证 runtime 所需的最小字段稳定存在。

### 2. 自定义 Prompt 门禁

允许自定义 prompt 继续存在，但只对符合最小完成协议的 prompt 放行。

对 `pool === "trae"` 的任务，自定义 `workerPrompt` 或 `workerPromptFile` 必须至少包含：

- `任务完成`
- `结果`
- `任务ID`

缺少任一字段，CLI 在 dispatch 前直接失败，不进入 dispatcher。

这样可以把错误提前暴露在控制层，而不是等 `/v1/chat` 等待 30 分钟后才发现回执不可接受。

### 3. 渲染后的 Prompt 持久化

不要只依赖本地临时文件。最终渲染后的 prompt 应作为 dispatcher 任务记录的一部分被持久化。

当前 assignment 已经支持：

- `workerPrompt`
- `contextMarkdown`

本设计复用现有结构，不引入新的独立 prompt 表。

建议额外增加以下元信息：

- `workerPromptMode: "auto" | "custom"`
- `reportSchemaVersion: "trae-v1"`

用途：

- 审计时明确"当时发给 worker 的最终 prompt 是什么"
- 识别 prompt 是 CLI 自动生成还是控制层自定义
- 为 redrive / continuation 保留稳定输入

### 4. 收窄 DOM 采样边界

Trae runtime 不应再只依赖页面级全局选择器去读取响应。

建议对 `traeAutomationSnapshotResponses()` 增加一个可选 root 约束，在 `new_chat` 后优先只采样当前活动会话根节点下的内容。

原则：

- 优先修复读取边界，而不是增加更多 UI 猜测逻辑
- 不要求完全识别"新 chat 页面长什么样"
- 只要求不要继续把整个页面里残留的旧对话当成当前响应源

如果当前版本无法稳定定位精确会话根节点，也至少应做到：

- 比全局 `document.querySelectorAll(...)` 更窄
- 优先读取当前激活 pane / 当前消息流容器

### 5. 轻量 Stale Guard

本设计不尝试判断"新 chat 是否已经完整就绪"，只判断"是否仍在持续读取旧任务内容"。

建议做法：

1. `new_chat` 后保留短暂等待
2. 读取一轮 activity / response snapshot
3. 如果仍能解析出前一个任务的 `taskId`，则快速失败

推荐错误码：

- `AUTOMATION_PREPARE_STALE_SESSION`

推荐错误详情：

- `previousTaskId`
- `stalePreview`
- `attempts`

这个 guard 的特点是：

- 不依赖新 chat 节点数量
- 不依赖 UI 折叠状态
- 不依赖 DOM 具体层级
- 只依赖一个强负条件：不应该继续看到上一个任务的标识

## 数据面

### CLI 输入层

建议在 `DispatchTaskInputOptions` 增加：

- `workerPromptMode?: "auto" | "custom"`
- `reportSchemaVersion?: "trae-v1"`

### Dispatcher 持久化层

assignment 记录继续保存：

- `workerPrompt`
- `contextMarkdown`

并新增可选字段：

- `workerPromptMode`
- `reportSchemaVersion`

### Runtime 错误层

新增或明确使用：

- `AUTOMATION_PREPARE_STALE_SESSION`

该错误应比 `/v1/chat` 的长超时更早失败。

## 代码落点

### CLI

- `packages/worker-review-orchestrator-cli/src/types.ts`
- `packages/worker-review-orchestrator-cli/src/dispatch.ts`
- `packages/worker-review-orchestrator-cli/tests/dispatch.test.ts`

### Dispatcher

- `apps/dispatcher/src/modules/server/runtime-state.ts`
- `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- dispatcher 对应状态持久化测试

### Trae Runtime

- `packages/trae-beta-runtime/src/runtime/trae-dom-driver.ts`
- `packages/trae-beta-runtime/src/runtime/worker.ts`
- `packages/trae-beta-runtime/tests/runtime/trae-dom-driver.test.ts`
- `packages/trae-beta-runtime/tests/runtime/worker.test.ts`

## 实施顺序

### Phase 1: CLI Prompt 契约收口

1. 增加 Trae prompt 自动渲染
2. 增加自定义 prompt 最小完成协议校验
3. 补 CLI 测试

### Phase 2: Dispatcher Prompt 持久化增强

1. 继续持久化最终渲染 prompt
2. 增加 prompt mode / schema version 元信息
3. 补 dispatcher 状态测试

### Phase 3: Runtime 防串读

1. 收窄 DOM 采样范围
2. 增加旧 task id stale guard
3. 补 DOM driver / worker 测试

顺序上先堵住"再犯"，再修"当前会话误读"，避免一开始就扩大改动面。

## 测试建议

至少补以下场景：

### CLI

- `pool=trae` 且未提供 custom prompt 时，自动生成标准完成模板
- custom prompt 缺少 `任务ID` 时，dispatch 前失败
- custom prompt 满足最小完成协议时，允许 dispatch

### Dispatcher

- assignment 中保留最终渲染后的 `workerPrompt`
- assignment 中保留 `workerPromptMode`
- assignment 中保留 `reportSchemaVersion`

### Runtime

- root 受限 snapshot 不再读取 root 外旧内容
- `new_chat` 后如果仍解析出旧 task id，抛 `AUTOMATION_PREPARE_STALE_SESSION`
- 正常新任务场景不受影响，仍可完成 `review_ready` / `failed` 回写

## 风险与边界

- 如果当前 Trae DOM 结构变化过快，精确 root 定位可能需要跟进选择器维护。
- stale guard 只处理"旧任务污染"这类强信号，不覆盖所有 UI 异常。
- 自定义 prompt 仍然允许存在，因此门禁必须足够明确，否则会再次回到"控制层手写 prompt 破坏 runtime 契约"的问题。
- 本设计不解决"Trae 已完成但输出本身不符合业务要求"的 review 问题；它只解决 prompt 协议和会话串读问题。

## 最小验收

- Trae 任务默认由 CLI 生成最终 worker prompt
- 自定义 Trae prompt 缺 `任务ID` 时，dispatch 前直接失败
- dispatcher 能查看到任务的最终渲染 prompt
- `new_chat` 后不再持续读取前一个任务的旧内容
- 若仍读到旧 task id，runtime 早失败并给出明确错误，而不是挂长时间超时

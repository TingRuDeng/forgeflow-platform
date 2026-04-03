# 启动前预检失败回写设计

## 背景

forgeflow-platform 的 `Trae` worker 任务在实际运行中，已经多次出现以下问题：

- worker 实际离线，但任务仍被派发出去
- gateway 未 ready，但 worker 已经开始执行
- 当前 worktree / branch 与任务分配不一致

这些问题现在通常只表现为笼统的 `failed`，控制层很难区分：

- 是任务本身失败
- 还是执行前条件不满足
- 还是需要重新切换 worker / worktree 后重试

本设计只解决**启动前预检失败**的可观测性，不修改任务状态机本身。

## 目标

1. 在 worker 真正开始执行任务前，先做前置条件预检。
2. 如果预检失败，仍然提交现有的 `failed` 结果，但附带结构化失败原因。
3. 控制层可以据此自动分流：
   - 换 worker 重试
   - 重新切 worktree 后再派发
   - 等待 gateway ready 后再试

## 非目标

- 不新增任务状态，例如 `preflight_failed`
- 不处理执行中途的 worktree 漂移
- 不改 dispatcher 的基本状态机语义
- 不引入新的调度 API

## 方案

### 1. 预检阶段

worker 在开始执行任务前，执行以下检查：

- worker 是否在线
- 对应 gateway 是否 ready
- 当前 worktree 是否与任务要求一致
- 当前 branch 是否与任务要求一致

只要任一项失败，就立即终止本次执行，不进入正文任务流程。

### 2. 失败回写

预检失败时，worker 仍然提交一条 `failed` 结果，但增加结构化 `failure` 对象。

建议字段：

```json
{
  "kind": "preflight",
  "code": "worktree_mismatch",
  "message": "current worktree does not match assigned task",
  "expected": "task worktree",
  "actual": "previous task worktree",
  "details": {}
}
```

推荐错误码：

- `worker_offline`
- `gateway_not_ready`
- `worktree_mismatch`
- `branch_mismatch`

### 3. 控制层处理

`worker-review-orchestrator` 或 dispatcher dashboard 收到结构化失败原因后，可按规则处理：

- `worker_offline`：换 worker 或等待 worker 恢复
- `gateway_not_ready`：等待 gateway ready 后重试
- `worktree_mismatch` / `branch_mismatch`：重新 materialize task workspace，再派发

## 数据语义

### 保留现有状态

任务状态仍然保持：

- `failed`

不新增状态，避免打穿现有 review / merged / blocked 流程。

### 新增结构

建议在任务结果或 failure payload 中增加：

- `failure.kind`
- `failure.code`
- `failure.message`
- `failure.expected`
- `failure.actual`
- `failure.details`

## 预期行为

### 成功路径

如果所有预检都通过：

1. worker 正常进入任务执行
2. 任务结果按原有流程提交
3. 不改变现有 `review` / `merged` 语义

### 失败路径

如果预检失败：

1. worker 不进入正文任务执行
2. 立即提交 `failed`
3. `failed` 中带结构化失败原因
4. 控制层据此决定是否重试或换 worker

## 测试建议

至少覆盖以下场景：

- worker 在线、gateway ready、worktree 匹配：任务正常进入执行
- worker 离线：回写 `worker_offline`
- gateway 未 ready：回写 `gateway_not_ready`
- worktree 不匹配：回写 `worktree_mismatch`
- branch 不匹配：回写 `branch_mismatch`

## 风险与边界

- 这版只解决“没开始就失败”的问题，不解决执行中途漂移。
- 如果 `failure` 结构化字段过于分散，后续会影响统一展示，需要收敛到 dispatcher 的标准输出格式。
- 如果未来要把 `preflight_failed` 升级成独立状态，必须先评估 dashboard、review 流程和历史数据迁移成本。

## 最小验收

- 预检失败时，任务仍记为 `failed`
- 失败原因可区分：
  - worker 是否在线
  - gateway 是否 ready
  - worktree / branch 是否匹配
- 控制层能根据失败原因选择重试策略

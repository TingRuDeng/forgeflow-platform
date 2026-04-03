# 真实两机 Codex 演练设计

## 目标

在不引入 `gemini-worker` 的前提下，使用两台真实设备完成一次最小多机调度演练，验证：

- `codex-control` 可以把任务发布到中心 dispatcher
- 两台真实设备上的 `codex-worker` 能进入同一队列
- 两个 `codex` 任务会被分配到不同 worker
- worker 执行后状态能推进到 `review`
- dashboard 能看到 worker / task / review 变化

## 拓扑

- 调度中心 + worker-1：`192.168.1.78`
- worker-2：`192.168.1.xx`
- 业务仓：`TingRuDeng/openclaw-multi-agent-mvp`

## 关键边界

### 1. 只演练 `codex` 池

planner 输出固定为两个 `codex` 任务，避免把任务拆到 `gemini`。

### 2. worker 可以晚于 dispatch 上线

真实演练里第二台机器可能比 dispatcher 晚启动，所以 dispatcher 必须支持：

- 任务先进入 `ready`
- worker 后上线再 claim
- `ready -> assigned` 由 worker 领取时推进

### 3. 总调度仍是单点决策者

你只和 `codex-control` 交互。它负责：

- 触发 `ai-dispatch`
- 把 `.orchestrator` 发布到 dispatcher
- 观察 dashboard
- 审查后决定 `merge / rework`

## 演练流程

1. `192.168.1.78` 启动 dispatcher server
2. 两台机器分别启动 `codex-worker daemon`
3. 总调度生成双 `codex` planner JSON
4. 总调度触发 `run-codex-control-flow.mjs --dispatcher-url`
5. dispatcher 创建 dispatch，分配两个任务
6. 两台 worker 分别领取任务并执行
7. dashboard 展示两个 worker 都进入 `busy`
8. 执行完成后任务进入 `review`
9. 总调度提交 `merge` 或 `rework`

## 成功标准

- dashboard 中能同时看到两个在线 `codex-worker`
- 同一 dispatch 下至少两个任务，且分配到不同 worker
- 两个任务都推进到 `review` 或其中一个 `failed`
- review 决策可通过脚本提交

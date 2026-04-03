# Trae 远程试运行 Runbook

这份 runbook 用于当前 `Trae automation gateway` + `Trae automation worker` 主线的远程 beta 试运行。

它不是仓库规则文件，也不替代 `README.md`、`onboarding.md` 或 `contracts/*`。它只回答三类问题：

1. 现在适合拿哪些任务试运行
2. 每次试运行前后该检查什么
3. 出问题时如何记录，方便后续迭代

## 1. 试运行目标

当前阶段的目标不是证明系统已经生产就绪，而是：

- 让远程 Trae 真正开始接收 dispatcher 分发的真实任务
- 在真实任务中识别稳定故障模式
- 用结构化问题记录推动后续收敛

## 2. 当前推荐边界

优先选择：

- `docs/**`
- 小范围脚本改动
- 小范围配置改动
- 单功能闭环的小范围业务代码修改
- 有明确 `allowedPaths`
- 有明确 `acceptance`

暂时避免：

- 大范围跨模块重构
- 多 Trae 并发
- 高风险重写
- 没有明确范围或验收命令的模糊任务

### 2.1 什么算“单功能闭环”

当前建议只放开这类任务：

- 有一个明确 bug 或一个明确小功能点
- 改动集中服务于同一个功能闭环
- `allowedPaths` 明确覆盖业务代码、对应测试与必要文档
- 验收命令能直接证明这次改动是否成立

允许的典型范围：

- 业务代码
- 对应测试
- 必要的最小文档更新

暂时不属于“单功能闭环”的任务：

- 同时改多个高耦合子系统
- 顺手做大面积清理或重构
- 改 dispatcher 状态机、核心协议或调度语义
- 没有清晰验收标准的探索性修改

### 2.2 示例

允许：

- 修一个明确接口 bug，并补对应单测
- 补一个小功能点，并同步更新相关测试
- 修一个业务逻辑缺陷，同时更新最小文档说明

暂不允许：

- 顺手重构整个模块层级
- 同时改 worker runtime、dispatcher 状态机和业务代码
- 借修 bug 名义做跨目录大面积整理

## 3. 运行拓扑

推荐固定为两机模式：

- 控制平面机器
  - 启动 `dispatcher`
- 远程 Trae 机器
  - 启动 `Trae`
  - 启动 `automation gateway`
  - 启动 `automation worker`

## 4. 启动顺序

### 4.1 控制平面机器

1. 启动 `dispatcher`
2. 检查 `/health`
3. 确认 dashboard 可访问

### 4.2 远程 Trae 机器

1. 启动 Trae 并带 `remote-debugging-port`
2. 启动 `automation gateway`
3. 检查 `GET /ready`
4. 启动 `automation worker`
5. 确认 worker 已在 dispatcher 注册

## 5. 每次试运行前检查

### 5.1 控制平面机器

- dispatcher 正常
- 端口可访问
- 当前没有需要人工处理的脏任务卡在中间态

### 5.2 远程 Trae 机器

- Trae 已启动
- `http://127.0.0.1:9222/json/version` 可访问
- `http://127.0.0.1:8790/ready` 返回 `ready=true`
- `automation worker` 已注册且状态为 `idle`

### 5.3 任务本身

- `pool=trae`
- `allowedPaths` 明确
- `branchName` 明确
- `defaultBranch` 明确
- `acceptance` 明确
- `workerPrompt` 与 `contextMarkdown` 不为空

### 5.4 执行上下文预检（Execution Context Preflight）

Trae beta worker 在开始代码编辑前，预期会执行并记录以下上下文检查，以证明工作区状态正确：

- **当前仓库路径**：`pwd` 或等效命令，确认在预期的工作目录
- **当前分支**：`git branch --show-current` 或 `git symbolic-ref --short HEAD`，确认在正确的任务分支而非旧分支
- **Git 状态**：`git status --short`，确认工作区干净或状态符合预期（无未提交的跨任务残留）
- **预期 worktree**：`git worktree list`，确认任务对应的 worktree 存在且对应正确的 `allowedPaths` 范围

这些预检不是硬性运行时强制，而是 worker 的最佳实践检查点。审查者在 review 时应确认：

- worker 的执行日志中包含上述上下文证明
- 分支、commit 和 worktree 与 assignment 中声明的一致
- 没有跨任务混用分支或 worktree 的迹象

如果预检证据缺失，review 者应要求 worker 提供，或在问题记录中标记为"缺少执行上下文预检证据"。

## 6. 试运行期间重点观察

dispatcher / dashboard：

- worker 是否 `idle -> busy -> idle`
- task 是否进入 `review` 或 `failed`
- assignment 状态是否与 task 状态一致
- 本次任务是否落到独立 task worktree，而不是串用上一次任务分支

远程 worker：

- 是否完成 `register -> fetch_task -> start_task -> submit_result`
- 是否出现 `heartbeat failed`
- 是否出现 `request timeout`

automation gateway：

- `/ready` 是否稳定
- 是否出现 `CDP_DISCOVERY_FAILED`
- 是否出现 `Timed out waiting for a CDP command response`
- 是否出现 `/v1/chat` 超时

Trae 客户端：

- 是否真的开始执行任务
- 是否产出最终回复
- 是否出现明显卡死或高负载无响应

## 7. 已知高频故障类型

建议优先按下面几类归档：

- `Trae 未启动 / debug port 不可用`
- `gateway not ready`
- `CDP command timeout`
- `/v1/chat timeout`
- `response capture` 抓到 planning 卡片而不是最终回复
- `submit_result` 回写失败
- 远程机器高负载导致 Trae 与 worker 同时卡顿

## 8. 每次试运行后必须记录

不管成功还是失败，至少记录：

- 时间
- task id
- worker id
- repo
- branch
- 结果
- 失败阶段或成功阶段
- 关键日志摘要
- 是否可复现
- 后续动作

推荐直接复制：

- `docs/runbooks/trae-issue-template.md`

## 9. 通过标准

本阶段可以视为“可持续 beta 试运行”的最低标准：

- 连续多次真实任务能进入 `review` 或 `failed`
- 失败可落账，不静默丢失
- worker 不因一次瞬时错误永久退出
- 故障模式开始收敛为少数已知类别

## 10. 当前不承诺

当前 runbook 不代表下面这些已经完成：

- 多 Trae 并发治理
- 生产级监控与告警
- 完整自动恢复
- UI 结构变化下的长期 selector 稳定性
- 完整无人值守批量生产运行

## 11. 推荐节奏

建议每轮只推进一个小层级：

1. 先稳定 `docs/**`
2. 再放开小脚本或配置改动
3. 再放开单功能闭环的小范围业务代码修改
4. 再评估是否继续放宽更多任务类型

如果某轮新故障明显增加，先暂停扩范围，优先修掉最影响稳定性的 1 到 2 类问题。

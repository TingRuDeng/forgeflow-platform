# 多机 Worker 注册与审查控制面设计

## 目标

把当前“单机本地脚本闭环”升级成可支撑多设备 `codex` / `gemini` worker 的控制面，满足：

- 不同设备上的 worker 可加入同一队列
- `codex-control` 选择具体 worker 并下发任务
- worker 执行后提交 PR 信息和执行结果
- `codex-control` 审查后可决定 merge 或 rework
- 提供最小 dashboard 展示任务、worker、PR、审查状态

## 当前实现边界

当前 forgeflow-platform 已具备：

- planner 输出 `planner_output_json`
- `ai-dispatch` 生成 `.orchestrator` 调度产物
- assignment package
- 本地 worker 执行入口
- `assigned -> in_progress -> review/failed` 本地状态推进

当前缺失：

- 常驻 dispatcher server
- 多机 worker 注册 / 心跳 / 派工
- worker 远程领取任务
- PR 元数据统一回写
- 审查决策 API
- 可视化 dashboard

## 推荐方案

采用“中心 dispatcher server + 多机 worker daemon + GitHub 代码审查”的结构。

```text
你
  ↓
codex-control
  ├─ 产出 planner_output_json
  ├─ 触发 ai-dispatch
  ├─ 下载 dispatch artifact
  ├─ 把调度产物发布到 dispatcher server
  └─ 审查并决定 merge / rework

dispatcher server
  ├─ worker 注册 / 心跳
  ├─ 派工 / 分配
  ├─ assignment package 存储
  ├─ 执行结果回写
  ├─ PR / review 元数据
  └─ dashboard snapshot

worker daemon (多机)
  ├─ 注册自己
  ├─ 发送心跳
  ├─ 拉取 assigned 任务
  ├─ 创建 worktree / branch
  ├─ 执行 codex 或 gemini
  ├─ commit / push / create PR
  └─ 回写 worker-result 和 PR 信息

GitHub
  ├─ 仓库 / 分支 / PR
  ├─ CI
  └─ merge
```

## 核心设计

### 1. dispatcher server

使用一个轻量 HTTP 服务，持久化状态到本地 JSON 文件。

持久化内容：

- `workers`
- `tasks`
- `events`
- `assignments`
- `reviews`
- `pullRequests`
- `dispatches`

第一版不引入数据库，优先保证可读、可调试、可回放。

### 2. worker 注册与心跳

每个 worker daemon 启动时注册：

- `workerId`
- `pool`
- `hostname`
- `labels`
- `status`
- `repoDir`

之后定期发送 heartbeat。

dispatcher 负责：

- 维护在线状态
- 按 pool 选空闲 worker
- 在 dashboard 展示 `idle / busy / offline`

### 3. 调度产物发布

保留当前 `ai-dispatch` 生成 `.orchestrator` 的流程。

新增一步：

- `codex-control` 下载 artifact
- 将 `.orchestrator` 中的：
  - `task-ledger`
  - `task-events`
  - `assignment packages`
  发布到 dispatcher server

dispatcher 再根据在线 worker 进行真实分配，而不是继续使用静态 `codex-worker-1` 这类占位 worker。

### 4. worker 执行

worker daemon 获取被分配任务后：

- 在本机 repo 下创建独立 worktree
- materialize assignment package
- 调用当前已有的 `run-worker-assignment.mjs`
- 收集：
  - `worker-result.json`
  - changed files
- 自动 commit / push
- 有 `GITHUB_TOKEN` 时自动创建 PR
- 把结果和 PR 元数据回写给 dispatcher

### 5. 审查决策

dispatcher 存储 review 阶段材料：

- changed files
- self-test 状态
- PR number / URL
- worker 输出摘要

`codex-control` 审查后通过 API 提交决策：

- `merge`
- `rework`

若选择：

- `merge`：任务状态进入 `merged`，可选同步触发 GitHub merge
- `rework`：任务状态进入 `blocked`，等待重新派工

### 6. dashboard

第一版 dashboard 直接由 dispatcher server 提供静态 HTML + JSON API。

展示：

- 任务总览
- 每个任务当前状态
- 每个任务分配到哪个 worker
- 在线 / 离线 worker
- PR 状态
- 最近事件

不依赖前端框架，先用简单轮询把状态面跑起来。

## API 草案

### worker

- `POST /api/workers/register`
- `POST /api/workers/:id/heartbeat`
- `GET /api/workers`
- `GET /api/workers/:id/assigned-task`
- `POST /api/workers/:id/result`

### dispatch

- `POST /api/dispatches`
- `GET /api/dispatches/:id`

### review

- `POST /api/reviews/:taskId/decision`

### dashboard

- `GET /api/dashboard/snapshot`
- `GET /dashboard`

## 状态机

任务状态：

- `planned`
- `ready`
- `assigned`
- `in_progress`
- `review`
- `merged`
- `blocked`
- `failed`

关键流转：

- `ready -> assigned`
- `assigned -> in_progress`
- `in_progress -> review`
- `in_progress -> failed`
- `review -> merged`
- `review -> blocked`

## 与现有实现的关系

保留：

- `planner_output_json`
- `ai-dispatch`
- assignment package 结构
- 本地 worker 执行入口
- review material 结构

新增：

- 常驻 dispatcher server
- 发布调度产物到 server 的脚本
- worker daemon
- dashboard
- 审查决策脚本

## 不在本轮目标内

- OpenClaw / ACP
- 分布式锁数据库
- WebSocket 推送
- 多 provider 共识 review
- 自动 merge queue

## 成功标准

完成后应能跑通这条链：

1. `codex-control` 触发 `ai-dispatch`
2. `.orchestrator` 发布到 dispatcher server
3. 另一台机器上的 worker daemon 拉到任务
4. worker 执行、commit、push、创建 PR
5. dispatcher dashboard 显示任务和 worker 状态
6. `codex-control` 提交 `merge` 或 `rework` 决策

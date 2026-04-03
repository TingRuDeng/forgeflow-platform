# Trae Automation Gateway v1

这份文档定义 forgeflow-platform 中无人值守 Trae 自动化桥接层的最小契约。

- Scope: `trae-automation-gateway-v1`
- Status: Active contract for the preferred unattended Trae path

## 定位

Trae automation gateway 解决的是"如何程序化控制 Trae 客户端"问题，不是"如何定义任务协议"问题。

它与现有能力的关系是：

- `dispatcher`：继续作为任务、分配、状态流转的真相源
- `Trae automation gateway`：当前首选的无人值守控制层，用于在不依赖人工点击的前提下自动驱动 Trae 客户端
- `Trae automation worker`：建立在 gateway 之上的 dispatcher runtime，负责 `fetch_task -> start_task -> submit_result` 闭环
- `Trae MCP worker`：保留给交互式或兼容性 fallback 场景，不再是首选 unattended 路线

## 当前 v1 目标

这个 v1 契约只覆盖 gateway 本体，不重复定义 automation worker runtime。

当前最小能力：

1. 检测 Trae 是否处于可自动化状态
2. 发现 Trae 的 remote debugging target
3. 建立 CDP session
4. 自动准备会话
5. 自动提交 prompt
6. 自动抓取最终回复
7. 允许调用方传入 workspace 线索（例如 repo/worktree basename）来收窄 target 选择
8. **新增**：会话状态持久化与查询
9. **新增**：软超时恢复机制

## 分层

### 1. Discovery

文件：

- `scripts/lib/trae-cdp-discovery.js`

职责：

- 访问 `/json/version` 与 `/json/list`
- 发现 Trae 对应 target
- 选择最佳 page target

### 2. CDP Client

文件：

- `scripts/lib/trae-cdp-client.js`

职责：

- 建立 websocket 连接
- 发送 CDP command
- 执行 `Runtime.evaluate`
- 处理超时与关闭

### 3. DOM Driver

文件：

- `scripts/lib/trae-dom-driver.js`

职责：

- readiness 检查
- prepare session / new chat
- submit prompt
- capture response snapshot
- 等待最终回复稳定
- **新增**：进度回调 hooks

### 4. Gateway

文件：

- `scripts/lib/trae-automation-gateway.js`
- `scripts/lib/trae-launcher.js`
- `scripts/run-trae-automation-gateway.js`
- `scripts/run-trae-automation-launch.js`
- **新增**：`scripts/lib/trae-automation-session-store.js`

职责：

- 暴露本地 HTTP 控制入口
- 调用 automation driver
- 对外返回 readiness 与 chat 结果
- **新增**：会话状态管理

### 5. Artifact Checks

文件：

- **新增**：`scripts/lib/trae-automation-artifact-checks.js`

职责：

- 检查 worktree/branch/commit 是否存在
- 验证变更是否在允许范围内
- 返回可审查性判断

## 当前最小接口

### `GET /ready`

返回 Trae automation 是否 ready。

可选查询参数：

- `title_contains`
- `url_contains`

用于按 workspace 线索收窄 target 校验。

示例：

```json
{
  "success": true,
  "code": "OK",
  "data": {
    "ready": true,
    "mode": "cdp"
  }
}
```

### `POST /v1/sessions/prepare`

显式准备一个新会话。

**新增**：返回 `sessionId` 用于后续状态查询。

```json
{
  "success": true,
  "code": "OK",
  "data": {
    "sessionId": "session-123",
    "status": "ok",
    "preparation": { "clicked": true }
  }
}
```

### `GET /v1/sessions/:id`

**新增**：查询会话状态。

Gateway 默认启用会话状态持久化（脚本链路默认目录：`.forgeflow-trae-gateway/sessions.json`）；如果调用方显式禁用 session store，则该接口不可用。

返回示例：

```json
{
  "success": true,
  "code": "OK",
  "data": {
    "sessionId": "session-123",
    "status": "running",
    "startedAt": "2026-03-30T10:00:00Z",
    "lastActivityAt": "2026-03-30T10:05:00Z",
    "responseDetected": true,
    "error": null
  }
}
```

状态枚举：

- `prepared`：会话已创建
- `running`：正在执行
- `completed`：已完成
- `failed`：执行失败
- `interrupted`：Gateway 重启导致中断

### `POST /v1/sessions/:id/release`

**新增**：释放一个会话对应的运行时占用。

这个接口用于 worker 完成一次任务后清理当前 task session。它会从 session store 中移除该会话记录，避免旧会话继续占用同一运行上下文。

返回示例：

```json
{
  "success": true,
  "code": "OK",
  "data": {
    "sessionId": "session-123",
    "released": true
  }
}
```

如果会话不存在，`released` 为 `false`。该接口是幂等的，调用方可以把它当作 best-effort cleanup。

### `POST /v1/chat`

请求示例：

```json
{
  "content": "请总结当前仓库结构",
  "sessionId": "session-123"
}
```

**新增**：支持 `sessionId` 参数。

- 如果 `sessionId` 对应的会话已完成，返回缓存的响应
- 如果 `sessionId` 正在运行，返回 409 冲突
- 如果 `sessionId` 不存在，创建新会话

响应示例：

```json
{
  "success": true,
  "code": "OK",
  "data": {
    "status": "ok",
    "response": {
      "text": "..."
    },
    "cached": false
  }
}
```

## 软超时恢复机制

**新增**：Worker 支持软超时恢复。

### 超时常量

- `DEFAULT_SOFT_CHAT_TIMEOUT_MS`: 30 分钟
- `DEFAULT_HARD_CHAT_TIMEOUT_MS`: 45 分钟
- `MAX_HARD_CHAT_TIMEOUT_MS`: 60 分钟
- `DEFAULT_SESSION_POLL_INTERVAL_MS`: 10 秒

### 恢复流程

1. Worker 发送 chat 请求，使用软超时
2. 如果软超时触发且拿到了 `sessionId`，Worker 轮询 gateway 会话状态
3. 如果软超时触发但缺少 `sessionId`，Worker 直接失败并返回显式错误（`missing sessionId`），提示修复会话恢复前置条件
4. 如果会话状态为 `completed`，重放缓存响应
5. 如果会话状态为 `failed` 或 `interrupted`，检查 git 产物
6. 如果会话状态为 `running`，继续轮询至硬超时
7. 硬超时后，检查 git 产物决定是否提交 review

### Git 产物兜底检查

当会话超时或失败时，Worker 会检查 git 产物：

1. 检查 worktree 是否存在
2. 检查分支是否匹配
3. 检查是否有变更
4. 检查变更是否在允许范围内
5. 检查任务分支上的提交是否已被远端验证
6. 只有远端可验证的产物才提交为 `review_ready`
7. 如果不可审查，提交为 `failed`

## 当前边界

Trae automation gateway 本体 v1 还没有直接负责：

- 多任务并发调度
- mode switch
- 流式增量回传
- 自动 PR / merge

但当前主线已经通过最小串行 runtime 打通了：

- `register / fetch_task / start_task`
- 调用 automation gateway 自动驱动 Trae
- 解析最终聊天回复模板
- 回写 `submit_result`
- **新增**：会话状态持久化
- **新增**：软超时恢复
- **新增**：Git 产物兜底检查

也就是说：

- "gateway 本体" 解决的是程序化控制 Trae 客户端
- "automation worker runtime" 解决的是 forgeflow-platform 串行无人值守执行闭环

## 当前实现范围

主线当前已经新增一版最小串行 runtime 入口：

- `scripts/lib/trae-automation-worker.js`
- `scripts/run-trae-automation-worker.js`
- **新增**：`scripts/lib/trae-automation-session-store.js`
- **新增**：`scripts/lib/trae-automation-artifact-checks.js`

这层负责：

- register / fetch_task / start_task
- 调用 automation gateway 自动发送 prompt
- 解析最终聊天回复模板
- 回写 `submit_result`
- **新增**：会话状态管理
- **新增**：软超时恢复
- **新增**：Git 产物兜底检查

当前仍然只支持：

- 单任务串行执行
- 单 worker
- 非流式最终回复回写
- 最小错误恢复/backoff，不包含更复杂的多实例协调

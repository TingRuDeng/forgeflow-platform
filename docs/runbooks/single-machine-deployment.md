# Single-Machine Control Plane Deployment

这份 runbook 面向阶段一单机部署：`dispatcher + SQLite` 同机，worker 可同机也可在内网其他机器接入。

它不替代仓库规则。规则看 `../AGENTS.md`，文档导航看 `../README.md`，接口字段看 `../API_ENDPOINTS.md`。

## 1. 适用范围

适合以下形态：

- 单机单写控制面
- `dispatcher` 使用默认 SQLite 持久化
- 远端 Trae worker 通过 HTTP 接入
- 不要求多实例 lease / 外部 DB / 外部 queue

不适合：

- 多实例 dispatcher
- 外部 DB/queue
- 高可用或跨地域容灾

## 2. 前置条件

- 机器能运行 Node.js 与 `pnpm`
- 仓库已完整 checkout
- 已执行 `pnpm install`
- 已准备 dispatcher 认证 token
- 对外暴露的 `8787` 端口已放进内网访问策略

推荐环境变量：

```bash
export DISPATCHER_AUTH_MODE=token
export DISPATCHER_API_TOKEN="replace-with-long-random-token"
export FORGEFLOW_STATE_DIR="/abs/path/to/.forgeflow-dispatcher"
```

## 3. 启动方式

推荐入口：

```bash
cd /abs/path/to/forgeflow-platform
pnpm install
./scripts/start-control-plane.sh
```

如需显式指定 host / port / state-dir：

```bash
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir "${FORGEFLOW_STATE_DIR}"
```

当前主线路径默认：

- runtime state: `${FORGEFLOW_STATE_DIR}/runtime-state.db`
- JSON rescue/import source: `${FORGEFLOW_STATE_DIR}/runtime-state.json`
- state lock: `${FORGEFLOW_STATE_DIR}/.runtime-state.lock`
- review memory: `${FORGEFLOW_STATE_DIR}/memory.json`

## 4. 最小上线检查

健康检查：

```bash
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/metrics
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/dashboard/snapshot
```

最小验收点：

- `/health` 返回可用
- `/api/metrics` 可返回 `queueDepth`、`reviewBacklog`、`deliveryFailedCount`
- `/api/dashboard/snapshot` 能看到 workers / tasks / events
- 未带 token 访问受保护接口时返回 `401`

## 5. 推荐运维基线

认证：

- 默认保持 `DISPATCHER_AUTH_MODE=token`
- 不要把 `open` 用在对外可达环境
- `legacy` 只用于临时兼容，不应作为长期生产模式

状态锁：

- 保持默认 `DISPATCHER_STATE_LOCK_TIMEOUT_MS=2000`
- 如果机器较慢或磁盘压力大，可适度上调超时，但不要直接关闭锁
- `503 state lock timeout` 视为竞争或阻塞，优先排查写入冲突

持久化：

- 默认使用 SQLite
- 不要把 JSON fallback 当长期主后端
- 只有在显式救援时才设置 `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1`

## 6. 备份与恢复

日常动作：

- 定期备份 `${FORGEFLOW_STATE_DIR}/runtime-state.db`
- 发布前做一次额外备份
- 保留最近成功恢复演练记录

恢复入口：

- 备份 / restore / repair 看 `runtime-state-backup-restore-repair.md`
- 鉴权 / 锁问题看 `auth-and-state-lock.md`
- 交付失败重试看 `delivery-failed-recovery.md`
- worktree 清理看 `worktree-cleanup.md`

## 7. 远端 worker 接入

远端 Trae worker 最小接入：

```bash
forgeflow-trae-beta init \
  --project-path /abs/path/to/business-repo \
  --dispatcher-url http://<dispatcher-host>:8787 \
  --worker-id trae-remote-01
forgeflow-trae-beta start all
```

注意：

- worker 侧自动 draft PR 仍然是显式 opt-in
- worker 结果只有在 dispatcher 接收成功后才算真正交付
- `submitResult` / push / draft PR 失败要按显式失败态处理，不要把本地完成当平台完成

## 8. 单机部署边界

当前单机部署已满足阶段一目标：

- 默认认证收紧
- 状态写串行化
- SQLite fail-closed
- `completed` 不再代表假成功

当前单机部署仍不提供：

- 多实例 lease / lock
- 外部 DB / queue
- 生产级 HA
- 自动 OTel trace 全链路


# Auth And State Lock Runbook

适用范围：

- dispatcher 认证失败
- `.runtime-state.lock` 竞争、超时、陈旧锁回收

## 1. 快速诊断

```bash
curl -i http://127.0.0.1:8787/health
curl -i http://127.0.0.1:8787/api/dashboard/snapshot
```

检查点：

- `401 unauthorized`：优先看 `DISPATCHER_AUTH_MODE` / `DISPATCHER_API_TOKEN` / `DISPATCHER_WORKER_TOKEN`
- `403 forbidden`：worker token 有效，但访问了其他 worker 或控制层路由
- `503 state lock timeout`：优先看锁竞争或陈旧锁

## 2. 认证模式确认

```bash
echo "${DISPATCHER_AUTH_MODE:-token}"
test -n "${DISPATCHER_API_TOKEN}" && echo "token set" || echo "token missing"
test -n "${DISPATCHER_WORKER_TOKENS}" && echo "worker token map set" || echo "worker token map missing"
```

规则：

- `token`：必须保留控制层 `DISPATCHER_API_TOKEN`；worker 自有路由可使用与 workerId 匹配的 scoped bearer token
- `legacy`：无控制层 token 时只允许 loopback 匿名访问，但已配置的 worker token 仍可远程访问自身路由
- `open`：仅用于本地开发
- 控制层保留 `DISPATCHER_API_TOKEN`；远程 worker 使用各自的 `DISPATCHER_WORKER_TOKEN`
- dispatcher 通过 `DISPATCHER_WORKER_TOKENS='{"worker-id":"worker-token"}'` 校验 worker scope
- worker token 必须逐 worker 唯一、无首尾空白，并且不能与 `DISPATCHER_API_TOKEN` 相同；配置冲突会拒绝加载，避免 worker token 退化为控制层凭据
- worker token 不能访问 dashboard、dispatch/review 管理接口或其他 worker 路由
- `forgeflow-dispatcher init` 与源码侧 config CLI 在 Unix 上会把配置文件创建或修正为 `0600`；如果手工迁移配置，保持只有 owner 可读写，否则服务端会拒绝加载

## 3. 锁文件检查

```bash
STATE_DIR=.forgeflow-dispatcher
LOCK_FILE="${STATE_DIR}/.runtime-state.lock"
ls -l "${LOCK_FILE}"
```

如果锁长时间不释放：

1. 读取锁文件中的 `pid`、`ownerToken`、`createdAt`，确认 owner PID 是否仍存活
2. 检查是否存在高频并发写或长事务
3. 存活 PID 持有的锁不会仅因超过 `DISPATCHER_STATE_LOCK_STALE_MS` 被自动回收
4. 只有确认 owner 进程已退出且没有替换锁时，才手动移除

```bash
rm -f .forgeflow-dispatcher/.runtime-state.lock
```

只在确认没有存活 dispatcher 进程时执行。

锁释放会同时核对原始 inode 和 `ownerToken`；旧请求的 release callback 不会删除后来创建的替换锁。

## 4. 调整锁参数

```bash
export DISPATCHER_STATE_LOCK_TIMEOUT_MS=5000
export DISPATCHER_STATE_LOCK_RETRY_MS=50
export DISPATCHER_STATE_LOCK_STALE_MS=30000
```

适用场景：

- 高频本地集成测试
- 慢磁盘或高负载机器

## 5. 观察指标

```bash
curl -s http://127.0.0.1:8787/api/metrics
```

重点看：

- `stateLockTimeoutCount`
- `queueDepth`
- `reviewBacklog`

## 6. 回滚策略

- 临时恢复本地联调：切 `DISPATCHER_AUTH_MODE=open`
- 只用于本地短时排障，不得作为生产默认

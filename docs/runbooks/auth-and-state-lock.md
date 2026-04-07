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

- `401 unauthorized`：优先看 `DISPATCHER_AUTH_MODE` / `DISPATCHER_API_TOKEN`
- `503 state lock timeout`：优先看锁竞争或陈旧锁

## 2. 认证模式确认

```bash
echo "${DISPATCHER_AUTH_MODE:-token}"
test -n "${DISPATCHER_API_TOKEN}" && echo "token set" || echo "token missing"
```

规则：

- `token`：除 `/health` 外都要 Bearer token
- `legacy`：无 token 时只允许 loopback
- `open`：仅用于本地开发

## 3. 锁文件检查

```bash
STATE_DIR=.forgeflow-dispatcher
LOCK_FILE="${STATE_DIR}/.runtime-state.lock"
ls -l "${LOCK_FILE}"
```

如果锁长时间不释放：

1. 确认 dispatcher 是否仍在运行
2. 检查是否存在高频并发写
3. 如果进程已退出、锁文件陈旧，再手动移除

```bash
rm -f .forgeflow-dispatcher/.runtime-state.lock
```

只在确认没有存活 dispatcher 进程时执行。

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


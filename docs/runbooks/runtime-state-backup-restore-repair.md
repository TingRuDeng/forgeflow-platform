# Runtime State Backup Restore Repair

适用范围：

- SQLite snapshot 备份
- restore / repair 演练
- fail-closed 后的人工救援
- 阶段三 DR drill

## 1. 关键文件

- `.forgeflow-dispatcher/runtime-state.db`
- 可选：
  - `.forgeflow-dispatcher/runtime-state.db-wal`
  - `.forgeflow-dispatcher/runtime-state.db-shm`
- 可选救援源：`.forgeflow-dispatcher/runtime-state.json`

## 2. 备份

推荐入口：

```bash
node scripts/backup-runtime-state.mjs --state-dir .forgeflow-dispatcher
```

该脚本当前会：

- 复制 `runtime-state.db`
- 如果存在，也会复制 `runtime-state.db-wal` / `runtime-state.db-shm`
- 生成 manifest，写出备份时间和复制文件列表

手工最小备份仍然可以继续使用：

```bash
mkdir -p .forgeflow-dispatcher/backups
cp .forgeflow-dispatcher/runtime-state.db \
  ".forgeflow-dispatcher/backups/runtime-state.$(date +%Y%m%d-%H%M%S).db"
```

发布前至少做一次备份。

## 3. 恢复

推荐入口：

```bash
node scripts/restore-runtime-state.mjs \
  --state-dir .forgeflow-dispatcher \
  --backup-dir .forgeflow-dispatcher/backups/<timestamp>
```

手工最小恢复：

```bash
cp .forgeflow-dispatcher/backups/runtime-state.20260407-120000.db \
  .forgeflow-dispatcher/runtime-state.db
```

恢复后重启 dispatcher，再检查：

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot
curl -s http://127.0.0.1:8787/api/query/projection-health
curl -s http://127.0.0.1:8787/api/dr/status
```

## 4. 救援模式

仅当明确需要从 JSON 救援时启用：

```bash
export FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1
```

这是显式救援，不是常态运行配置。

## 5. 排障顺序

1. 先保留当前 `.db`
2. 再做副本或走脚本备份
3. 如有必要，先切 `DISPATCHER_READ_ONLY_MODE=1`
4. 再尝试 restore
5. 最后才考虑 JSON 救援

## 6. 演练要求

- 每次大版本前至少做一次 restore 演练
- 演练后记录使用的备份文件、恢复时间、是否成功
- 每季度至少执行一次：

```bash
node scripts/verify-stage3-dr.mjs
```

# Runtime State Backup Restore Repair

适用范围：

- SQLite snapshot 备份
- restore / repair 演练
- fail-closed 后的人工救援
- 阶段三 DR drill

## 1. 关键文件

- `.forgeflow-dispatcher/runtime-state.db`
- `.forgeflow-dispatcher/runtime-state-shadow-status.json`
- 可选：
  - `.forgeflow-dispatcher/runtime-state.db-wal`
  - `.forgeflow-dispatcher/runtime-state.db-shm`
- 可选救援源：`.forgeflow-dispatcher/runtime-state.json`

## 2. 备份

推荐入口：

```bash
node scripts/backup-runtime-state.mjs \
  .forgeflow-dispatcher \
  .forgeflow-dispatcher/backups/<timestamp>
```

该脚本当前会：

- 复制 `runtime-state.db`
- 如果存在，也会复制 `runtime-state-shadow-status.json`
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
  .forgeflow-dispatcher/backups/<timestamp> \
  .forgeflow-dispatcher
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
node scripts/verify-live-dispatcher-dr.mjs
```

当前边界：

- `scripts/backup-runtime-state.mjs` 和 `scripts/restore-runtime-state.mjs` 是源码仓脚本，当前使用位置参数。
- `forgeflow-dispatcher backup --backup-dir ...` / `restore --backup-dir ...` 是打包 runtime CLI 的参数形态，不要混用。
- `scripts/verify-stage3-dr.mjs` 会创建真实 SQLite `runtime-state.db`，在打开的 WAL 连接上写入多条 snapshot，确认备份包含 `runtime-state.db-wal`，恢复后执行 `PRAGMA integrity_check` 和 snapshot checksum 校验。
- `scripts/verify-live-dispatcher-dr.mjs` 会启动本地 live dispatcher，通过 HTTP 写入 worker / dispatch / events，在 server 仍运行时备份，然后恢复并校验 SQLite integrity 和关键 runtime state。
- live drill 还会启动一个子进程 dispatcher，在写入和备份后用 `SIGKILL` 模拟进程 / host 丢失，再把备份恢复到替换 stateDir 并重新拉起 dispatcher 查询任务和事件。
- live drill 会在恢复前主动破坏当前 SQLite runtime 文件，确认备份能从磁盘损坏场景恢复出 `PRAGMA integrity_check=ok` 的状态。
- live drill 会把同一份备份恢复到两个独立 stateDir，分别启动 dispatcher 并校验 task / event 计数一致，作为本地多节点恢复验收。
- live drill 仍不是物理断电实验，也不替代真实生产 quorum / fencing / DNS 切流演练。

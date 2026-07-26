# Runtime State Backup Restore Repair

适用范围：

- SQLite snapshot 备份
- restore / repair 演练
- fail-closed 后的人工救援
- 阶段三 DR drill

## 1. 关键文件

- `.forgeflow-dispatcher/runtime-state.db`
- `.forgeflow-dispatcher/runtime-state-shadow-status.json`
- `.forgeflow-dispatcher/shadow-reconciler-status.json`
- `.forgeflow-dispatcher/shadow-cutover-drill.json`
- `.forgeflow-dispatcher/shadow-cutover-approval.json`
- `.forgeflow-dispatcher/shadow-cutover-ready.json`
- `.forgeflow-dispatcher/shadow-cutover-complete.json`
- `.forgeflow-dispatcher/shadow-cutover-revocation.json`
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

省略第二个位置参数时，脚本也会在 `.forgeflow-dispatcher/backups/` 下创建独立的时间戳子目录，不会把多轮快照写进同一个目录。

该脚本当前会：

- 与 dispatcher mutation 共用 `.runtime-state.lock`，避免在一次 dispatcher 状态写入中间复制文件
- 复制 `runtime-state.db`
- 如果存在，也会复制 `runtime-state-shadow-status.json` 和 `shadow-reconciler-status.json`
- 如果存在，也会复制 `shadow-cutover-drill.json` / `shadow-cutover-approval.json` / `shadow-cutover-ready.json` / `shadow-cutover-complete.json` / `shadow-cutover-revocation.json`
- 如果存在，也会复制 `runtime-state.db-wal` / `runtime-state.db-shm`
- 生成 `forgeflow-runtime-state-backup/v1` manifest，记录每个文件的字节数和 SHA-256
- 对 SQLite 备份副本执行 `PRAGMA integrity_check`，校验最新 snapshot checksum，并把 snapshot count、revision、state sequence 和 checksum 写入 manifest
- 只有文件复制与 SQLite watermark 校验都成功后才原子发布 manifest；空 stateDir 不会生成伪成功备份

SQLite snapshot 默认只保留最近 128 个 revision，可用 `DISPATCHER_SQLITE_SNAPSHOT_RETENTION` 调整到 2 至 10000。manifest 的 snapshot count 表示备份当时的保留窗口，不是实例启动以来的累计写入次数；旧 revision 被清理后出现最小 revision 大于 1 或 revision 缺口是正常现象。完整事件历史应通过 `runtime_audit_events` / `/api/query/events` 核对。

手工最小备份只适合作为额外的紧急副本：

```bash
mkdir -p .forgeflow-dispatcher/backups
cp .forgeflow-dispatcher/runtime-state.db \
  ".forgeflow-dispatcher/backups/runtime-state.$(date +%Y%m%d-%H%M%S).db"
```

它没有 v1 manifest、文件哈希或 SQLite watermark，不能替代脚本备份。发布前至少做一次脚本备份。

## 3. 恢复

推荐入口：

```bash
node scripts/restore-runtime-state.mjs \
  .forgeflow-dispatcher/backups/<timestamp> \
  .forgeflow-dispatcher
```

正式恢复前必须先停止 dispatcher 和任何直接 SQLite / 文件写入者。restore 会获取与 dispatcher mutation 相同的状态锁，但无锁只读请求、外部数据库写入和绕过 dispatcher 的直接文件访问不在该保护范围内。

restore 会：

- 读取备份目录里最新的 manifest，并在修改目标目录前校验所有 v1 文件的字节数和 SHA-256
- 先把全部文件复制到目标目录内的 staging 文件，校验 staging 副本后再替换正式文件
- 失败时恢复原目标文件；成功时删除备份中不存在的旧 runtime 文件，避免旧 WAL / SHM 与新数据库混用
- 对旧格式 manifest 保留兼容恢复，但返回 `manifestVerified=false`；这类恢复没有哈希证据，应在恢复后立刻重新生成 v1 备份

手工最小恢复：

```bash
cp .forgeflow-dispatcher/backups/runtime-state.20260407-120000.db \
  .forgeflow-dispatcher/runtime-state.db
```

手工 `cp` 不执行 manifest 校验、staging 或旧 sidecar 清理，只用于脚本不可用时的人工救援。恢复后重启 dispatcher，再检查：

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot
curl -s http://127.0.0.1:8787/api/query/projection-health
curl -s http://127.0.0.1:8787/api/dr/status
```

结构化 projection 会在下一次状态保存时比较 source hash、metadata row count 与实际 row count；缺行或多行会触发该表重建。若实际内容被人工修改但行数未变化，先保留备份并停止写入者，再清空 `projection_table_hashes` 后触发一次正常 dispatcher 状态保存，使全部 projection 从最新 snapshot 重建。

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
- 两个 drill 都会要求 v1 manifest 完整校验通过，并核对 manifest SQLite watermark 与恢复后的 snapshot。
- `scripts/verify-live-dispatcher-dr.mjs` 会启动本地 live dispatcher，通过 HTTP 写入 worker / dispatch / events；它先确认一组事件，再在剩余写入并发时备份，恢复后要求所有备份开始前已确认的事件仍存在，作为本地 RPO 下界。
- live drill 还会启动一个子进程 dispatcher，在写入和备份后用 `SIGKILL` 模拟进程 / host 丢失，再把备份恢复到替换 stateDir 并重新拉起 dispatcher 查询任务和事件；它记录本地恢复耗时，并验证恢复后的新写入经过第二次重启仍然存在。
- live drill 会在恢复前主动破坏当前 SQLite runtime 文件，确认备份能从磁盘损坏场景恢复出 `PRAGMA integrity_check=ok` 的状态。
- live drill 会把同一份备份恢复到两个独立 stateDir，分别启动 dispatcher，并校验 task / event 计数和完整 runtime-state SHA-256 一致，作为本地多节点恢复验收。
- live drill 仍不是物理断电实验，也不替代真实生产 quorum / fencing / DNS 切流演练。

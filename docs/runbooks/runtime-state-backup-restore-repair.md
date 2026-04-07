# Runtime State Backup Restore Repair

适用范围：

- SQLite snapshot 备份
- restore / repair 演练
- fail-closed 后的人工救援

## 1. 关键文件

- `.forgeflow-dispatcher/runtime-state.db`
- 可选救援源：`.forgeflow-dispatcher/runtime-state.json`

## 2. 备份

```bash
mkdir -p .forgeflow-dispatcher/backups
cp .forgeflow-dispatcher/runtime-state.db \
  ".forgeflow-dispatcher/backups/runtime-state.$(date +%Y%m%d-%H%M%S).db"
```

发布前至少做一次备份。

## 3. 恢复

```bash
cp .forgeflow-dispatcher/backups/runtime-state.20260407-120000.db \
  .forgeflow-dispatcher/runtime-state.db
```

恢复后重启 dispatcher，再检查：

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot
```

## 4. 救援模式

仅当明确需要从 JSON 救援时启用：

```bash
export FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1
```

这是显式救援，不是常态运行配置。

## 5. 排障顺序

1. 先保留当前 `.db`
2. 再做副本
3. 再尝试 restore
4. 最后才考虑 JSON 救援

## 6. 演练要求

- 每次大版本前至少做一次 restore 演练
- 演练后记录使用的备份文件、恢复时间、是否成功


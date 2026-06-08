# Live dispatcher DR 演练

## 目标

补齐 Stage 3 DR 的 live dispatcher 演练入口：启动真实 dispatcher HTTP server，执行真实写请求，在 server 仍运行时备份 SQLite/WAL，再恢复并校验快照可查询。

## 非目标

- 不模拟操作系统级进程崩溃或断电。
- 不把该演练并入每次快速 `verify:stage3`。
- 不调整 Postgres / queue shadow 的 primary-store 语义。

## 当前事实

- `scripts/verify-stage3-dr.mjs` 已覆盖源码级 SQLite/WAL 备份恢复。
- 技术债文档仍标记缺少 live dispatcher 并发写入 / 锁竞争 / 崩溃恢复演练。
- `startDispatcherServer()` 已能用临时 stateDir 启动真实 HTTP server。

## 决策日志

- 新增 `scripts/verify-live-dispatcher-dr.mjs`，避免拖慢现有快速 `verify:stage3`。
- 脚本只在临时进程内设置 `DISPATCHER_AUTH_MODE=open`，退出时恢复环境变量。
- 演练用 HTTP 注册 worker、创建 dispatch、并发写 worker events，再执行 backup/restore/integrity 校验。

## 执行计划

- [x] 新增 live dispatcher DR drill 脚本。
- [x] 新增脚本级 Vitest 测试。
- [x] 增加 `verify:stage3:live` 命令入口。
- [x] 同步 README、Stage 3 runbook、backup/restore runbook 和技术债文档。
- [x] 运行验证并补充 Review 小结。

## 验证结果

- `node scripts/verify-live-dispatcher-dr.mjs`：通过；输出 `ok=true`、`liveWriteSuccessCount=16`、`copiedFiles` / `restoredFiles` 均包含 `runtime-state.db-wal`，恢复后 `integrityCheck=ok`。
- `pnpm verify:stage3:live`：通过；同样完成 live dispatcher HTTP 写入、备份、恢复和 integrity 校验。
- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/execution/stage3-live-dr.test.ts`：通过；实际执行 dispatcher 测试 37 个文件、396 个测试。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm docs:validate`：通过。
- `git diff --check`：通过。
- `pnpm verify:stage3`：通过。
- `pnpm test`：首次暴露新增 Vitest 用例默认 5 秒超时；补充用例级 30 秒超时后通过，全量 workspace 测试通过。

## Review 小结

已新增 live dispatcher DR drill：脚本会启动真实本地 dispatcher HTTP server，注册 worker、创建 dispatch、发起 16 次 worker event 写入，在 server 仍运行且 WAL keeper 连接打开时备份 `runtime-state.db` / WAL / SHM，随后恢复并校验 SQLite `PRAGMA integrity_check`、snapshot 数和关键 task/event。

剩余风险：该演练覆盖 live HTTP 写入和 WAL 恢复，但仍不是进程崩溃、断电或多节点故障恢复演练。

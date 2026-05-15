# 成熟产品验收：Stage 3 DR WAL 演练

## 目标

- 将 `scripts/verify-stage3-dr.mjs` 从单 snapshot 恢复证明升级为 WAL-backed 备份恢复演练。
- 备份时保持 SQLite 连接打开，确认备份包含 `runtime-state.db-wal`，并恢复最新 snapshot。

## 非目标

- 不模拟真实并发写入、锁竞争或进程崩溃。
- 不替代生产环境 live dispatcher DR 演练。
- 不引入外部数据库或长耗时压力测试。

## 修复前现状

- `verify-stage3-dr` 会创建真实 SQLite `runtime-state.db`。
- 脚本只写入一条 snapshot，并在数据库关闭后执行 backup/restore。
- 实际验证通常只覆盖 `runtime-state.db` 文件，不证明 WAL 文件恢复链路。

## 执行计划

- [x] 补 RED 测试，要求 DR 脚本输出 `walIncluded: true` 且恢复多条 snapshot。
- [x] 调整 DR 脚本，在打开的 WAL 连接上写入多轮 snapshot 后执行备份。
- [x] 同步 runbook 和技术债边界。
- [x] 运行受影响测试、文档校验和 diff 检查。
- [x] 补充 review 小结。

## 验收方式

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/execution/stage3-dr.test.ts`
- `node scripts/verify-stage3-dr.mjs`
- `pnpm docs:validate`
- `git diff --check`

## Review 小结

已完成 Stage 3 DR WAL 演练升级：`verify-stage3-dr` 会在打开的 WAL 连接上写入 4 条 snapshot，备份时确认包含 `runtime-state.db-wal`，恢复后校验 integrity、snapshot count、latest sequence 和 checksum。

验证已通过：RED 测试先失败于缺少 `walIncluded`；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/execution/stage3-dr.test.ts`、`node scripts/verify-stage3-dr.mjs`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：该脚本仍不是 live dispatcher 并发写入、锁竞争或崩溃恢复演练；生产级 DR drill 仍需单独设计。

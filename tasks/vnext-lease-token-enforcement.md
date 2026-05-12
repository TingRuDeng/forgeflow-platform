# vNext 第六批：LeaseToken Enforcement

## 目标

在 dispatcher 状态层为 vNext start/result 写入补上 `attemptId` / `leaseToken` 校验能力，同时保留 v0 worker 不传字段时的兼容路径。

## 计划

- [x] 写失败测试，覆盖 start/result 携带错误 `attemptId` 或 `leaseToken` 时被拒绝。
- [x] 扩展 `BeginTaskInput` 和 `RecordWorkerResultInput`，支持可选 `attemptId` / `leaseToken`。
- [x] 在 active attempt 存在时校验 worker、attemptId 和 leaseToken。
- [x] 更新协议 / TaskAttempt 文档，明确当前是 opt-in enforcement。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts` 通过。
- `pnpm --filter @forgeflow/dispatcher typecheck` 通过。
- `pnpm typecheck` 通过。
- `pnpm docs:validate` 通过。
- `git diff --check` 通过。

## Review 小结

已完成状态层和 HTTP worker start/result 写入口的可选 LeaseToken 校验。当前仍保留 v0 worker 不传 `attemptId` / `leaseToken` 的兼容路径；完整 v1 envelope 强制校验留给后续批次。

验证已通过：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm --filter @forgeflow/dispatcher typecheck`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`、`pnpm lint`、`pnpm test`。

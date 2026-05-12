# vNext 第十一批：Stale Result Rejection MVP

## 目标

在 Retry Scheduler 之后补齐 stale result 拒绝闭环：过期 attempt 被 redrive 或失败后，旧 worker 携带旧 `attemptId` / `leaseToken` 回写 result 时必须明确失败，并保留可诊断错误。

## 非目标

- 不强制所有 v0 worker 立即携带完整 v1 envelope。
- 不实现可配置 retry policy。
- 不扩展 repo / branch / session lease。

## 当前事实

- `recordWorkerResult` 当前只允许 `assigned` / `in_progress` 任务写 result。
- `assertActiveAttemptLease` 当前只在传入 `attemptId` 或 `leaseToken` 时校验 active attempt。
- Retry Scheduler 已能把过期 running attempt 标记为 `expired` 并 redrive 或 failed。

## 决策日志

- 选择最小收紧：只拒绝携带 stale attempt lease 信息的晚到写入，保持无 envelope 的 v0 兼容路径。
- 错误通过异常向 HTTP 层映射为 `409`，不做静默降级。

## 执行计划

- [x] 增加 runtime stale result 失败测试。
- [x] 增加 HTTP stale result 409 测试。
- [x] 收紧 stale attempt / lease 判断。
- [x] 同步协议、状态机和 attempt 模型文档。
- [x] 运行最小充分验证。

## 验证结果

- RED：新增 runtime / HTTP stale result 用例先失败，错误为泛化的 `task not assigned to worker`。
- GREEN：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts` 通过，34 个测试文件、389 个用例通过。
- 静态验证：`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。
- 全量验证：`pnpm test` 通过，`apps/dispatcher` 34 个测试文件、389 个用例通过。

## Review 小结

- 显式携带历史终态 `attemptId` 的 late result 会优先被识别为 stale attempt result，并在 HTTP 层返回 `409`。
- 无 `attemptId` / `leaseToken` 的 v0 兼容路径未强制收紧，完整 v1 envelope 仍保留为后续任务。
- 文档已同步当前实现边界，不再把 stale result 拒绝列为未实现项。

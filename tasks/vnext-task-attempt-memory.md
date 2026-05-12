# vNext 第四批：TaskAttempt In-memory

## 目标

在 dispatcher runtime state 中加入内存态 `taskAttempts[]`，让 v0 worker claim/start/result 路径可以先绑定 synthetic attempt，为后续 SQLite attempts、LeaseToken enforcement 和 ArtifactBundle 绑定打基础。

## 计划

- [x] 写失败测试，覆盖 claim 创建 attempt、start 标记 running、result 标记 succeeded / failed。
- [x] 在 runtime state 中加入 `TaskAttempt` 内存模型和 helper。
- [x] 将 claim/start/result/cancel 的现有 v0 路径绑定当前 active attempt。
- [x] 更新 TaskAttempt 文档和技术债记录。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts` 通过。
- `pnpm --filter @forgeflow/dispatcher typecheck` 通过。
- `pnpm typecheck` 通过。
- `pnpm docs:validate` 通过。
- `git diff --check` 通过。

## Review 小结

- `RuntimeState` 已新增 `taskAttempts[]`，空状态、JSON backend、SQLite snapshot coerce 均会保留该字段。
- v0 claim 会创建或复用 active synthetic attempt，并写入 `attemptId`、`attemptNo`、`workerRuntime`、`leaseToken`、`traceId` 和 `idempotencyKey`。
- v0 start 会把 active attempt 标记为 `running`，v0 result 会标记为 `succeeded` 或 `failed`，cancel 会标记为 `cancelled`。
- 本批没有新增 SQLite `task_attempts` projection 表，也没有启用 `attemptId` / `leaseToken` 强校验。
- 已运行：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts`、`pnpm --filter @forgeflow/dispatcher typecheck`、`pnpm lint`、`pnpm test`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`。

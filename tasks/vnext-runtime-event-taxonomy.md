# vNext 第三批：Runtime Event Taxonomy

## 目标

在协议层建立当前 dispatcher 事件名到 vNext runtime event taxonomy 的可执行映射，先解决“事件分类没有统一入口”的问题，后续再接入 TaskAttempt 和 SQLite 事件落库。

## 计划

- [x] 写失败测试，覆盖现有 dispatcher / worker 事件名到规范事件名的映射。
- [x] 在 `@forgeflow/worker-protocol` 中补充 taxonomy normalize helper 和必要的事件枚举。
- [x] 更新 vNext 协议文档，说明当前批次只提供映射，不改变 dispatcher 既有事件存储格式。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/worker-protocol test` 通过。
- `pnpm --filter @forgeflow/worker-protocol typecheck` 通过。
- `pnpm typecheck` 通过。
- `pnpm docs:validate` 通过。
- `git diff --check` 通过。

## Review 小结

- `RuntimeEventTypeSchema` 已补入当前 dispatcher 运维事件需要的 `worker_disabled`、`worker_enabled`、`worker_offline` 和 `lease_conflict`。
- `normalizeRuntimeEventType()` 已覆盖 `created`、`assignment_claimed`、`progress_reported`、`session_interrupted`、`submit_result_retry_failed`、`delivery_failed`、`worktree_cleanup_failed` 等当前事件名。
- 未知事件返回 `null`，避免把未识别事件静默归类为通用状态。
- 本批不修改 dispatcher `Event.type` 存储格式，不新增 SQLite 列；这是后续 TaskAttempt / SQLite 批次的接入点。
- 已运行：`pnpm --filter @forgeflow/worker-protocol test`、`pnpm --filter @forgeflow/worker-protocol typecheck`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`。

# 成熟产品验收：v1 worker envelope 最小闭环

## 目标

- 让 Trae 主链从只携带 `attempt_id` / `lease_token`，推进到同时携带 `protocol_version`、`trace_id` 和 `idempotency_key`。
- dispatcher 对声明 v1 envelope 的 start/result 写入做完整匹配校验。
- 保留完全不携带 envelope 的 v0 worker 兼容路径，避免一次性打断 codex/gemini 既有 worker。

## 非目标

- 不新增正式 `/api/tasks/:taskId/attempts/:attemptId/*` v1 路由。
- 不移除 v0 `/api/workers/*` 和 `/api/trae/*` 兼容路径。
- 不实现跨请求 idempotency 存储或 payload 冲突检测。
- 不实现 artifact retention 正文存储。

## 当前事实

- `packages/worker-protocol/src/index.ts` 已定义 `WorkerProtocolEnvelopeSchema`，要求 `protocolVersion`、`taskId`、`attemptId`、`workerId`、`leaseToken`、`traceId` 和 `idempotencyKey`。
- `apps/dispatcher/src/modules/server/runtime-state.ts` 的 `TaskAttempt` 已保存 `protocolVersion`、`traceId` 和 `idempotencyKey`。
- `apps/dispatcher/src/modules/server/runtime-dispatcher-server.ts` 的 Trae `fetch-task` 当前只返回 `attempt_id`、`lease_token` 和 `trace_id`。
- `packages/trae-beta-runtime/src/runtime/clients.ts` 当前 `startTask` / `submitResult` 只发送 `attempt_id` / `lease_token`。

## 决策日志

- 采用渐进式收紧：v0 空 envelope 继续兼容；只要请求声明 v1 envelope 字段，就必须完整并与 active attempt 匹配。
- 本批先复用现有 `TaskAttempt.idempotencyKey` 做请求回显校验，不把它升级为跨请求幂等表。

## 执行计划

- [x] 在 Trae runtime client/worker 测试中写 RED，要求 start/result 带完整 envelope。
- [x] 在 dispatcher Trae 路由测试中写 RED，要求 fetch-task 返回完整 envelope，并拒绝 trace/idempotency mismatch。
- [x] 扩展 `WorkerRuntimeTask`、Trae client 请求体和 dispatcher glue types。
- [x] 扩展 runtime-state 输入结构并校验 v1 envelope 与 active attempt 一致。
- [x] 同步 `docs/WORKER_PROTOCOL_V1.md`、`docs/TASK_ATTEMPT_MODEL.md`、`docs/TECH_DEBT.md` 和 `tasks/todo.md`。

## 验证矩阵

- `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`
- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm docs:validate`
- `git diff --check`

## Review 小结

已完成 Trae 主链 v1 envelope 最小闭环：`fetch-task` 回显 `protocol_version`、`trace_id`、`idempotency_key`，Trae runtime 在 start/result 回写时携带这些字段，dispatcher 在声明 v1 envelope 时校验它们必须与 active attempt 一致。v0 空 envelope 兼容路径保留，避免影响尚未迁移的通用 worker route。

验证已通过：RED 测试先失败于缺失完整 envelope 字段；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：通用 `/api/workers/:workerId/start-task` 和 `/api/workers/:workerId/result` 仍允许 v0 空 envelope；本批不实现跨请求 idempotency payload 冲突检测。

# 成熟产品验收：通用 worker v1 envelope 校验

## 目标

- 让通用 `/api/workers/:id/start-task` 和 `/api/workers/:id/result` 在收到 v1 envelope 字段时，完整校验 `protocolVersion`、`traceId` 和 `idempotencyKey`。
- 保留空 envelope 的 v0 worker 兼容路径。

## 非目标

- 不强制所有通用 worker 立即升级到 v1 envelope。
- 不实现跨请求 idempotency payload 指纹存储。
- 不修改 Trae 专用路由行为。

## 修复前现状

- `dispatcher-server.ts:readWorkerLeaseFields` 已读取 v1 envelope 字段。
- `runtime-state.ts:assertActiveAttemptLease` 已支持完整 envelope 校验。
- 通用 worker start/result 路由当前只把 `attemptId` 和 `leaseToken` 传入状态机，导致声明 v1 envelope 时 trace/idempotency mismatch 没有进入状态机校验。

## 执行计划

- [x] 补 RED 测试，证明通用 worker start/result 声明 v1 envelope 时会校验 trace/idempotency mismatch。
- [x] 将通用 worker start/result 路由补齐 `protocolVersion`、`traceId`、`idempotencyKey` 传参。
- [x] 同步技术债和任务记录中该缺口状态。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## 验收方式

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm docs:validate`
- `git diff --check`

## Review 小结

已完成通用 worker v1 envelope 校验补齐：`/api/workers/:workerId/start-task` 和 `/api/workers/:workerId/result` 会把 `protocolVersion`、`traceId`、`idempotencyKey` 传入状态机，声明 v1 envelope 时必须与 active attempt 一致。空 envelope 的 v0 worker 兼容路径保持不变。

验证已通过：RED 测试先失败于错误 `traceId` 仍返回 200；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：跨请求 idempotency payload 指纹冲突检测尚未实现；空 envelope v0 worker 兼容路径仍保留，后续是否强制升级需要单独评估。

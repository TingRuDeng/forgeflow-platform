# Worker Protocol v1

## 目的

定义 vNext worker 与 dispatcher 之间的长期演进协议，统一 register、claim、start、progress、result、review 和 redrive 的基础 envelope。

## 适合读者

适合维护 dispatcher HTTP API、Trae runtime、未来 worker adapter、CLI 和协议测试的开发者与 AI 代理。

## 一分钟摘要

- 协议版本固定为 `2026-05-v1`。
- 每个写入 envelope 都必须包含 `taskId`、`attemptId`、`workerId`、`leaseToken`、`traceId` 和 `idempotencyKey`。
- 当前 Trae 主链和通用 worker start/result 都必须携带并校验完整 v1 envelope；空 envelope 写入会被拒绝。
- `@forgeflow/worker-protocol` 提供 `buildWorkerStartPayload` 和 `buildWorkerResultPayload`，作为内部 worker adapter / 第三方准入的最小 SDK helper。
- ArtifactBundle schema 以 `@forgeflow/result-contracts` 为唯一实现，worker-protocol 只重导出，避免协议包之间字段漂移。
- 具体 schema 以 `../packages/worker-protocol/src/index.ts` 为可执行契约。

```yaml
ai_summary:
  authority: "Worker Protocol v1 目标契约、基础 envelope、主要请求语义和错误码"
  scope: "vNext worker/dispatcher 协议，以及当前 dispatcher worker mutation 已接入的 v1 envelope 边界"
  read_when:
    - "实现 worker-protocol schema 或 worker adapter 前"
    - "改造 dispatcher claim/start/progress/result 写入前"
    - "判断 worker mutation 是否缺少完整 v1 envelope 时"
  verify_with:
    - "../packages/worker-protocol/src/index.ts"
    - "../packages/worker-protocol/tests/index.test.ts"
    - "API_ENDPOINTS.md"
  stale_when:
    - "protocolVersion、envelope 字段、错误码或 worker mutation 路径变化"
```

## 权威边界

本文描述 vNext 目标协议。当前已上线 HTTP 接口仍以 `API_ENDPOINTS.md` 和 `apps/dispatcher/src/modules/server/dispatcher-server.ts` 为准。

## 如何验证

- 运行 `pnpm --filter @forgeflow/worker-protocol test`。
- 运行 `pnpm --filter @forgeflow/worker-protocol typecheck`。
- 对照 `../packages/worker-protocol/src/index.ts` 的 Zod schema。

## 协议 Envelope

每个 worker mutation 都必须携带：

```ts
{
  protocolVersion: "2026-05-v1",
  taskId: "task-1",
  attemptId: "attempt-1",
  workerId: "worker-1",
  leaseToken: "lease-token",
  traceId: "trace-1",
  idempotencyKey: "result-attempt-1"
}
```

## Worker SDK Helper

内部 worker adapter 和被白名单放行的第三方 provider 应复用 `@forgeflow/worker-protocol` 的 helper 生成 mutation payload：

- `buildWorkerStartPayload({ envelope, at })` 生成 `/api/workers/:workerId/start-task` 所需 payload，并复用完整 v1 envelope。
- `buildWorkerResultPayload({ envelope, result, changedFiles, pullRequest })` 生成 `/api/workers/:workerId/result` 所需 payload，并把 dispatcher canonical 的 `taskId` / `workerId` 从 envelope 写入 result。
- `WorkerSdkStartPayloadSchema` 和 `WorkerSdkResultPayloadSchema` 是 helper 的可执行校验入口。

这些 helper 是仓库内部 SDK 契约，不等于已经承诺公网 npm SDK 的长期兼容窗口。

## Worker 注册

目标路径：

```http
POST /api/workers/register
```

请求语义：

- `protocolVersion`：worker 支持的协议版本。
- `workerId`：稳定 worker 标识。
- `runtime`：`codex`、`gemini`、`trae` 或 `custom`。
- `workerClass`：用于 queue / policy 路由的 worker 类型。
- `capabilities`：worker 声明的能力集合。
- `capacity`：可并行 attempt 数量，第一阶段默认 `1`。

响应语义：

- `acceptedProtocolVersion`：dispatcher 接受的协议版本。
- `heartbeatIntervalMs`：推荐心跳间隔。
- `leaseDurationMs`：lease 有效期。

## Claim Task

目标路径：

```http
POST /api/tasks/claim
```

v1 claim 成功时必须返回 `task` 与 `attempt`。`attempt` 至少包含 `attemptId`、`attemptNo`、`leaseToken`、`leaseExpiresAt` 和 `traceId`。

## Start / Progress / Result

目标路径：

```http
POST /api/tasks/:taskId/attempts/:attemptId/start
POST /api/tasks/:taskId/attempts/:attemptId/progress
POST /api/tasks/:taskId/attempts/:attemptId/result
```

这些写入必须校验 envelope。`result` 必须绑定 `ArtifactBundle`，否则后续 review 不能稳定引用执行证据。

当前已接入路径：

- `/api/workers/:workerId/start-task` 和 `/api/workers/:workerId/result` 在 claim 已创建 active attempt 后必须携带完整 v1 envelope。
- 通用 worker start/result 会对照当前 active attempt 校验 worker、attemptId、leaseToken、protocolVersion、traceId 和 idempotencyKey。
- 通用 worker result 可携带 `waitingForInput`，用于主动请求 dispatcher 进入 HITL 暂停；其中 `resumePayloadSchema` 可声明 `string` / `number` / `integer` / `boolean` / `array` 字段、枚举、textarea、范围、数组数量和必填项，供 Console 渲染结构化恢复表单并展示校验错误；dispatcher 会 checkpoint active attempt、释放 worker / leases，并在后续 `/api/tasks/:taskId/resume` 时按保存的 schema 校验 `resumePayload`。
- failed result 的终态失败语义由 `@forgeflow/result-contracts` 的共享选择规则归一：首个非空 blocker 保留 provider-specific code；没有 blocker 时依次回退到 evidence summary/type 和 result output。dispatcher 将同一 `failureType/failureCode/failureSummary` 写入终态事件，并将 code/message 写入 active attempt，generic 与 Trae 路径不再各自推断。
- `/api/trae/fetch-task` 会返回 `attempt_id`、`lease_token`、`protocol_version`、`trace_id` 和 `idempotency_key`，Trae runtime 会在 `/api/trae/start-task` 和 `/api/trae/submit-result` 回写时携带它们。
- Trae start/result 会对照当前 active attempt 校验 worker、attemptId、leaseToken、protocolVersion、traceId 和 idempotencyKey。
- `succeeded` / `failed` attempt 的完整 result 可在网络响应丢失后按同一 envelope 重放；只有 canonical result、成功结果的 `changedFiles`、PR metadata 与 ArtifactBundle 和已落账内容全部一致时才返回幂等成功，内容变化或 bundle 证据已被 retention 移除而无法核对时都会以 idempotency conflict 拒绝。
- 其他终态 attempt（或不是已落账 result 的重放）仍会作为 stale 写入拒绝。
- 如果没有 active attempt，worker result 会被拒绝为 `active attempt not found`；缺少任一 envelope 字段会被拒绝为 `worker protocol v1 envelope incomplete`。

## 错误语义

| HTTP | code | 含义 |
|---|---|---|
| 409 | `STALE_LEASE` | leaseToken 过期或已被 reclaim |
| 409 | `ATTEMPT_SUPERSEDED` | attempt 已被新 attempt 取代 |
| 400 | `PROTOCOL_VERSION_UNSUPPORTED` | 协议版本不支持 |
| 400 | `INVALID_TRANSITION` | 状态转移非法 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一 idempotencyKey 重放了不同 canonical result、成功结果 changedFiles、PR metadata 或 ArtifactBundle |
| 403 | `WORKER_NOT_AUTHORIZED` | worker 无权限处理该队列或 runtime class |
| 422 | `RESULT_SCHEMA_INVALID` | result 或 artifact 不符合 schema |

`WorkerEvidence.blockers[].code` 仍是开放字符串，不因共享选择规则改为闭集；控制层只能把明确列入恢复策略的 code 视为可自动 redrive，其余失败默认需要人工判断。

## Runtime Event Taxonomy

`../packages/worker-protocol/src/index.ts` 暴露 `RuntimeEventTypeSchema` 和 `normalizeRuntimeEventType()`。

当前批次的边界：

- vNext 规范事件名继续使用 `task_created`、`attempt_started`、`attempt_failed`、`review_decided` 等稳定枚举。
- 当前 dispatcher / worker 已存在的事件名通过 `normalizeRuntimeEventType()` 映射到规范枚举，例如 `created -> task_created`、`progress_reported -> attempt_progress`、`delivery_failed -> attempt_failed`。
- helper 对未知事件返回 `null`，不做静默 fallback。
- dispatcher 既有 `Event.type` 存储格式保持不变；runtime event 现在另有稳定 `eventId`，SQLite/PostgreSQL append-only audit 表提供持久化 sequence 和分页读取。

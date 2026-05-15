# Worker Protocol v1

## 目的

定义 vNext worker 与 dispatcher 之间的长期演进协议，统一 register、claim、start、progress、result、review 和 redrive 的基础 envelope。

## 适合读者

适合维护 dispatcher HTTP API、Trae runtime、未来 worker adapter、CLI 和协议测试的开发者与 AI 代理。

## 一分钟摘要

- 协议版本固定为 `2026-05-v1`。
- 每个写入 envelope 都必须包含 `taskId`、`attemptId`、`workerId`、`leaseToken`、`traceId` 和 `idempotencyKey`。
- 当前 Trae 兼容主链已回显并校验完整 v1 envelope；其他 v0 worker routes 仍保留渐进兼容。
- 具体 schema 以 `../packages/worker-protocol/src/index.ts` 为可执行契约。

```yaml
ai_summary:
  authority: "Worker Protocol v1 目标契约、基础 envelope、主要请求语义和错误码"
  scope: "vNext worker/dispatcher 协议，不覆盖当前 v0 dispatcher routes 的已实现字段"
  read_when:
    - "实现 worker-protocol schema 或 worker adapter 前"
    - "改造 dispatcher claim/start/progress/result 写入前"
    - "判断 v1 与当前 v0 API 是否混淆时"
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

当前兼容路径：

- `/api/workers/:workerId/start-task` 和 `/api/workers/:workerId/result` 接受可选 `attemptId` / `leaseToken`。
- `/api/trae/fetch-task` 会返回 `attempt_id`、`lease_token`、`protocol_version`、`trace_id` 和 `idempotency_key`，Trae runtime 会在 `/api/trae/start-task` 和 `/api/trae/submit-result` 回写时携带它们。
- 当 Trae 写入声明 v1 envelope 时，dispatcher 会对照当前 active attempt 校验 worker、attemptId、leaseToken、protocolVersion、traceId 和 idempotencyKey。
- 如果 worker 携带的 `attemptId` 已进入 `expired` / `failed` / `succeeded` / `cancelled` / `superseded` 等终态，dispatcher 会拒绝这次 stale 写入。
- v0 worker 不传 envelope 时仍按既有路径执行，后续批次再收紧通用 worker routes。

## 错误语义

| HTTP | code | 含义 |
|---|---|---|
| 409 | `STALE_LEASE` | leaseToken 过期或已被 reclaim |
| 409 | `ATTEMPT_SUPERSEDED` | attempt 已被新 attempt 取代 |
| 400 | `PROTOCOL_VERSION_UNSUPPORTED` | 协议版本不支持 |
| 400 | `INVALID_TRANSITION` | 状态转移非法 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一 idempotencyKey 对应不同 payload |
| 403 | `WORKER_NOT_AUTHORIZED` | worker 无权限处理该队列或 runtime class |
| 422 | `RESULT_SCHEMA_INVALID` | result 或 artifact 不符合 schema |

## Runtime Event Taxonomy

`../packages/worker-protocol/src/index.ts` 暴露 `RuntimeEventTypeSchema` 和 `normalizeRuntimeEventType()`。

当前批次的边界：

- vNext 规范事件名继续使用 `task_created`、`attempt_started`、`attempt_failed`、`review_decided` 等稳定枚举。
- 当前 dispatcher / worker 已存在的事件名通过 `normalizeRuntimeEventType()` 映射到规范枚举，例如 `created -> task_created`、`progress_reported -> attempt_progress`、`delivery_failed -> attempt_failed`。
- helper 对未知事件返回 `null`，不做静默 fallback。
- 本批次不改变 dispatcher 既有 `Event.type` 存储格式，也不新增 SQLite 事件列。

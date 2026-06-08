# Shadow failure 一等事件化

## 目标

让 Postgres / queue shadow 写失败进入 `RuntimeState.events[]`、`/api/metrics`、`/api/slo` 和 Console 指标展示，避免故障只停留在 durable health record。

## 非目标

- 不把 Postgres / queue shadow 切成 primary store。
- 不实现 shadow drift 自动对账。
- 不调整 live dispatcher DR drill、branch lease 或 entrypoint drift。

## 当前事实

- `saveRuntimeState()` 先写 SQLite snapshot / projection，再异步执行 shadow sync。
- shadow 写失败已持久化到 `runtime-state-shadow-status.json`，并通过 `/api/dr/status` 暴露。
- shadow 写失败尚未进入 `RuntimeState.events[]` 和 `/api/metrics`。

## 决策日志

- 选择在 shadow sync 异步失败后追加 `shadow_write_failed` system event。
- 事件写入复用 SQLite snapshot / projection 写入 helper，但不再次触发 shadow sync，避免递归失败。
- SLO 增加 `DISPATCHER_SLO_MAX_SHADOW_WRITE_FAILED` 阈值，默认 0。

## 执行计划

- [x] 在 shadow sync 失败后追加 `shadow_write_failed` runtime event。
- [x] 将 shadow failure 计数接入 dashboard snapshot、`/api/metrics` 和 `/api/slo`。
- [x] 将 shadow failure 计数接入 Console 指标卡。
- [x] 同步观测 runbook、Stage 3 runbook 和技术债文档。
- [x] 运行受影响测试、文档校验、类型检查和 diff 检查。
- [x] 补充 Review 小结。

## 进度记录

- 2026-06-08：开始执行 M2。
- 2026-06-08：完成 `shadow_write_failed` runtime event、metrics、SLO 和 Console 指标接入。
- 2026-06-08：同步 README、观测 runbook、Stage 3 runbook 和技术债说明。

## 验证结果

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`：通过；实际执行 dispatcher 测试 35 个文件、394 个测试。
- `pnpm --filter console exec vitest run src/components/__tests__/MetricsGrid.test.tsx`：通过。
- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/slo.test.ts`：通过；实际执行 dispatcher 测试 36 个文件、395 个测试。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm docs:validate`：通过。
- `git diff --check`：通过。
- `pnpm test`：通过；全量 workspace 测试通过。

## Review 小结

已让 shadow 写失败进入 `RuntimeState.events[]`：异步 shadow sync 失败后会追加 `shadow_write_failed` system event，并写入 SQLite snapshot / structured projection，但不会再次触发 shadow sync。该事件同时驱动 `shadowWriteFailureCount` 指标、`/api/slo` burn-rate 原因和 Console 指标卡展示。

剩余风险：shadow drift 自动对账仍未实现；Postgres / queue shadow 仍是 best-effort，不是 primary store。

# vNext 第二批：Schema Runtime Convergence

## 目标

让 `@forgeflow/task-schema` 对齐 dispatcher 当前运行时真实任务、worker、assignment 结构，并显式纳入 `trae` worker pool，减少 schema、runtime、provider registry 之间的漂移。

## 计划

- [x] 写失败测试，覆盖 `trae` pool、运行时 Task/Worker 字段、AssignmentPayload 字段和废弃状态拒绝。
- [x] 更新 `packages/task-schema` 的 schema 与导出类型，保持最小兼容边界。
- [x] 如类型放宽影响下游编译，按真实能力最小修正下游类型。
- [x] 更新与本批事实相关的文档或技术债记录。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/task-schema test` 通过。
- `pnpm --filter @forgeflow/task-schema typecheck` 通过。
- `pnpm typecheck` 通过。
- `pnpm docs:validate` 通过。
- `git diff --check` 通过。

## Review 小结

- `WorkerPoolSchema` 已从 `codex` / `gemini` 扩展为 `codex` / `gemini` / `trae`，但仍拒绝 provider registry 中不属于活跃 worker pool 的 `claude`。
- `TaskStatusSchema` 已对齐当前 dispatcher runtime 状态机，拒绝旧 schema 中的 `partial_success` / `expired`，接纳 `cancelled`。
- `TaskSchema`、`WorkerSchema`、`AssignmentPayloadSchema` 已覆盖 `apps/dispatcher/src/modules/server/runtime-state.ts` 中的主链字段。
- 为避免破坏仍直接构造 `Worker` 对象的旧 dispatcher service，`hostname`、`labels`、`repoDir` 在 schema 中保持可选。
- 已运行：`pnpm --filter @forgeflow/task-schema test`、`pnpm --filter @forgeflow/task-schema typecheck`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`。

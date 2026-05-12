# vNext 第五批：SQLite Attempts

## 目标

把 `taskAttempts[]` 从仅 snapshot 保存推进到 SQLite 结构化 projection，让 DR / query health 能校验 attempts 数量，为后续 LeaseToken enforcement 和 Console timeline 提供查询基础。

## 计划

- [x] 写失败测试，覆盖 `task_attempts` projection 写入、读取和 projection health 计数。
- [x] 在 SQLite 初始化中新增 `task_attempts` 表。
- [x] 在 structured projection rewrite/read/compare 中接入 attempts。
- [x] 更新数据库与 TaskAttempt 文档。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts` 通过。
- `pnpm --filter @forgeflow/dispatcher typecheck` 通过。
- `pnpm typecheck` 通过。
- `pnpm docs:validate` 通过。
- `git diff --check` 通过。

## Review 小结

- SQLite 初始化已新增 `task_attempts` projection 表。
- structured projection rewrite 会清空并重写 `task_attempts`。
- `readStructuredRuntimeState()` 会读取 attempts，`compareStructuredProjection()` 会把 `taskAttempts` 纳入 expected / actual 计数。
- 本批仍不改变 authoritative truth：snapshot 的 `taskAttempts[]` 仍是权威来源。
- 已运行：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts`、`pnpm --filter @forgeflow/dispatcher typecheck`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`、`pnpm lint`、`pnpm test`。

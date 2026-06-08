# Shadow drift operator check

## 目标

提供可由 operator 手动执行的 shadow drift 检查入口，比较 SQLite truth source 期望计数与 Postgres projection / queue shadow 实际计数，避免 shadow rollout 前只能看最后一次写入状态。

## 非目标

- 不把 Postgres / queue shadow 切换为 primary store。
- 不把 drift 检查接入同步 `/api/dr/status`，避免把 dispatcher 同步 handler 改造成 async。
- 不实现自动告警或自动回滚。

## 当前事实

- `runtime-state-shadow.ts:readRuntimeStateShadowHealth` 已能读取 Postgres projection / queue counts。
- `/api/dr/status` 当前同步返回 lightweight DR posture，不适合直接等待 Postgres 读。
- `docs/DATABASE_SCHEMA.md` 明确记录当前 `/api/dr/status` 尚未暴露 shadow counts。

## 决策日志

- 新增 `scripts/check-shadow-drift.mjs <stateDir>` 作为 operator check。
- 抽出 `summarizeRuntimeStateShadowDrift()` 纯函数，单测覆盖 matched / drifted / not_configured。
- `verify:shadow-drift` 默认检查 `.forgeflow-dispatcher`，实际环境可直接传入目标 stateDir 调脚本。

## 执行计划

- [x] 新增 shadow drift summary 纯函数。
- [x] 新增 operator CLI 和脚本级测试。
- [x] 同步 runbook、API / DB 文档、技术债和任务记录。
- [x] 运行验证并补充 Review 小结。

## 验证结果

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/execution/shadow-drift.test.ts`：通过；实际执行 dispatcher 测试 38 个文件、399 个测试。
- `pnpm verify:shadow-drift`：初次失败于本地 `.forgeflow-dispatcher/runtime-state.db` 旧 schema；修复为 shadow 未配置时不读取 runtime state 后通过，输出 `drift.status=not_configured`。
- `pnpm verify:stage3`：通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm docs:validate`：通过。
- `git diff --check`：通过。
- `pnpm test`：通过，全量 workspace 测试通过。

## Review 小结

已新增 shadow drift operator check：`summarizeRuntimeStateShadowDrift()` 会比较 SQLite truth source 期望 counts 与 Postgres projection / queue shadow 实际 counts，`scripts/check-shadow-drift.mjs <stateDir>` 输出 `ok`、`drift` 和 `health`。当 shadow 未配置时，脚本不会读取本地 runtime DB，避免旧 schema 或本地残留状态阻断 `not_configured` 巡检。

剩余风险：drift check 仍是手动 CLI，尚未接入告警、release gate 或自动 reconciliation。

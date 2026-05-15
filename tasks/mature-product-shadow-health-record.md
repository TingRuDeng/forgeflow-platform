# 成熟产品验收：shadow 写失败 durable health record

## 目标

- 将 Postgres / queue shadow 写入的最后一次状态持久化到 stateDir 下的独立 health record。
- `/api/dr/status` 读取该 health record，使 dispatcher 重启后仍能看到最后一次 shadow 失败或成功。
- 保持 SQLite snapshot 仍为真相源，shadow 写失败不改变任务状态机写入结果。

## 非目标

- 不把 shadow 失败写回 `RuntimeState.events[]`，避免 shadow catch 里递归保存 runtime snapshot。
- 不把 shadow 写失败升级为任务失败。
- 不实现 Postgres primary cutover 或自动漂移修复。
- 不把 shadow health record 作为安全审计日志。

## 当前事实

- `runtime-state-shadow.ts:syncRuntimeStateShadow` 只更新进程内 `shadowWriteStatus`。
- `runtime-state-sqlite.ts:saveRuntimeState` 在 SQLite snapshot/projection 成功后异步调用 shadow sync，并通过空 catch 避免影响主链写入。
- `/api/dr/status` 当前通过 `readRuntimeStateShadowWriteStatus()` 读取进程内状态。

## 决策日志

- 采用独立 `runtime-state-shadow-status.json` 文件持久化 health record，避免递归触发 `saveRuntimeState()`。
- health record 只保存状态、时间戳、mode、queueMode、configured 和错误摘要，不保存连接串或 secret。
- `/api/dr/status` 优先合并 stateDir 中的持久化记录，再叠加当前环境下的 mode/configured 判断。

## 执行计划

- [x] 在 SQLite runtime state 测试中写 RED，证明 shadow 失败会生成 health record 文件。
- [x] 为 `readRuntimeStateShadowWriteStatus(stateDir)` 增加从 health record 读取最后状态的能力。
- [x] 将 `saveRuntimeState()` 的异步 shadow sync 改为 sync 后持久化 status。
- [x] 更新 DR / Stage 3 runbook 与技术债文档。

## 验证矩阵

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/server/dispatcher-server.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm docs:validate`
- `git diff --check`
- `pnpm verify:stage3`

## Review 小结

已完成 shadow 写状态 durable health record：shadow sync 成功、跳过或失败后会把当前状态写入 `runtime-state-shadow-status.json`，`/api/dr/status.shadowWrite` 会读取该文件，备份恢复脚本也会复制该文件。

验证已通过：RED 测试先失败于未生成 `runtime-state-shadow-status.json`、`/api/dr/status` 未读取持久化记录，以及缺少 shadow health 选择逻辑；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/forgeflow-dispatcher test -- tests/backup.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：shadow failure 仍不是 `RuntimeState.events[]` 中的一等审计事件；本批不实现 shadow drift 自动对账或 primary cutover。

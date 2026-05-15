# 当前项目审查修复任务

- [x] 修复 dispatcher read-only 写冻结缺口，补齐真实写路由拦截，并避免只读 GET 在 read-only 下落盘。
- [x] 将 dispatcher POST 鉴权前置到 body 解析之前，并补充 worker register 结构化输入校验。
- [x] 让 shadow 写失败可观测，并把 shadow health 接入 DR 状态。
- [x] 将 DR drill 升级为真实 SQLite/WAL 备份恢复验证。
- [x] 将文档校验接入 CI，并修正手动发布版本不可追踪问题。
- [x] 运行最小充分验证并补充 review 小结。

## Review 小结

已修复 read-only 写冻结、POST 鉴权前置、worker register 输入校验、shadow 写失败可观测、真实 SQLite DR 演练、CI 文档门禁和手动发布版本落账问题。

验证已通过：`pnpm docs:validate`、`git diff --check`、受影响 dispatcher 测试、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm -r --if-present build`、`pnpm coverage:critical`。

剩余风险：非 assignment lease 仍只是结构与指标层能力，repo/branch/session 强约束需要后续单独设计；手动发布现在先 commit/tag/push 再 publish，若 npm publish 失败，git 历史中会保留未发布版本，需要按发布 runbook 人工处置。

# Goal 2：收窄 lease 为 assignment-only

- [x] 新增测试，锁定 dashboard active lease 指标只暴露 assignment 资源类型。
- [x] 将 lease 类型、聚合指标和 SQLite session 投影收窄到 assignment-only。
- [x] 同步更新 runtime-state query 契约、指标 runbook 和已知坑文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已将 dispatcher lease 模型收窄为 assignment-only：`LeaseResourceType` 只允许 `assignment`，dashboard `activeLeases.byResourceType` 只输出 assignment 计数，SQLite 结构化投影不再从 `session` lease 写入 `sessions` 表。已同步权威文档，明确 repo/branch/session 不是当前 lease 强约束能力。

验证已通过：新增测试先失败后通过，`pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm docs:validate`、`pnpm typecheck`、`pnpm lint`、`git diff --check`、`pnpm verify:stage3`。

剩余风险：历史 runtime snapshot 如果人工写入过非 assignment lease，当前变更不会为它们提供迁移语义；repo/branch/session 的真实强约束仍需后续按独立 Goal 设计。

# 成熟产品验收：read-only 硬冻结

- [x] 补充 RED 测试，证明 read-only 模式会拒绝未来新增或遗漏登记的 `/api` 写请求。
- [x] 将 read-only mutation 判断从手写路由列表收敛为默认拒绝 `/api` 写方法。
- [x] 同步 `API_ENDPOINTS`、Stage 3 runbook 和技术债文档，移除 read-only matcher 漂移风险。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已将 read-only 模式从手写写路由列表收敛为默认冻结 `/api` 下 `POST` / `PUT` / `PATCH` / `DELETE`，并新增未登记 `/api/future-write` 的回归测试，避免后续新增写路由遗漏 matcher 后绕过冻结。

验证已通过：RED 测试先返回 `404` 后修复为 `503 read_only_mode`；`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 全部通过。

剩余风险：read-only 只冻结 dispatcher HTTP API 写方法；直接修改运行时文件、外部数据库或操作系统层面的写入仍需由运维流程单独管控。

# 成熟产品验收：技术债事实同步

- [x] 对照真实代码核对 shadow status、Stage 3 DR drill 和 release workflow 的技术债描述。
- [x] 修正 `docs/TECH_DEBT.md` 中已过期或过度表述的债务项。
- [x] 修正 DR runbook 中对 `verify-stage3-dr` 的过期边界说明。
- [x] 运行文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已按真实代码修正技术债事实：shadow 写失败已经通过 `/api/dr/status` 暴露 in-memory 状态，但尚未持久化为运行时事件；`verify-stage3-dr` 已经创建真实 SQLite 并校验 integrity/checksum，但仍不是 live dispatcher WAL 压力演练；手动 release 已先 commit/tag/push 再 publish，剩余风险是 publish 失败后 git 版本领先 npm。

验证已通过：`pnpm docs:validate`、`git diff --check`。

剩余风险：本批只同步文档事实，不实现持久化 shadow failure event、live DR 压力演练或 release 失败自动恢复。

# 成熟产品验收：Trae attempt lease envelope

- [x] 补充 RED 测试，证明 Trae runtime start/result 会携带 dispatcher 返回的 `attempt_id` / `lease_token`。
- [x] 补充 RED 测试，证明 Trae dispatcher 路由会把 `attempt_id` / `lease_token` 传入状态机校验。
- [x] 修改 Trae runtime client 与 worker，传递 `attemptId` / `leaseToken`。
- [x] 修改 dispatcher Trae start/result 路由，透传 attempt lease 字段。
- [x] 同步 Worker Protocol / TaskAttempt / 技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已把 Trae 主链从“fetch 返回 attempt lease 但 runtime 不使用”推进到 start/result 回写携带并校验 `attempt_id` / `lease_token`。同时修复 `runtime-dispatcher-server.ts:overwriteRuntimeState` 漏复制 `taskAttempts` / `artifactBundles` 的状态覆盖缺口，以及 SQLite projection 重写时未清空 `artifact_bundles` 导致重复插入的缺口。

验证已通过：Trae runtime RED 测试先失败，dispatcher RED 测试先暴露 attempt 缺失与 stale lease 未校验；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 全部通过。

剩余风险：Trae 仍使用 v0 兼容路由，尚未强制完整 v1 envelope 的 `protocolVersion`、`traceId` 和 `idempotencyKey`。

# 成熟产品验收：v1 worker envelope 最小闭环

- [x] 补充 RED 测试，证明 Trae runtime start/result 会携带 `protocol_version`、`trace_id` 和 `idempotency_key`。
- [x] 补充 RED 测试，证明 dispatcher Trae fetch-task 会返回完整 envelope，并拒绝 v1 envelope mismatch。
- [x] 实现 Trae runtime 与 dispatcher 之间的完整 envelope 透传和 active attempt 校验。
- [x] 同步 Worker Protocol / TaskAttempt / 技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 Trae 主链 v1 envelope 最小闭环：`fetch-task` 返回 `protocol_version`、`trace_id`、`idempotency_key`，Trae runtime 在 start/result 回写时携带这些字段，dispatcher 对声明 v1 envelope 的 start/result 写入校验 active attempt 的协议版本、traceId 和 idempotencyKey。

验证已通过：RED 测试先失败于缺失完整 envelope 字段；修复后 `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check` 通过。

剩余风险：通用 v0 worker routes 仍保留空 envelope 兼容；跨请求 idempotency payload 冲突检测尚未实现。

# 成熟产品验收：shadow 写失败 durable health record

- [x] 补充 RED 测试，证明 shadow 写失败会落 `runtime-state-shadow-status.json`。
- [x] 实现 shadow 写状态文件持久化，并让 `/api/dr/status` 读取 stateDir 下的 durable record。
- [x] 保持 shadow 写失败不影响 SQLite 主链写入结果。
- [x] 同步 Stage 3 / DR runbook 和技术债文档。
- [x] 运行受影响测试、类型检查、文档校验和 diff 检查。
- [x] 补充 review 小结。

## Review 小结

已完成 shadow 写状态 durable health record：shadow sync 成功、跳过或失败后写入 `runtime-state-shadow-status.json`，`/api/dr/status.shadowWrite` 合并读取 stateDir 下的记录，源码脚本与打包 dispatcher runtime 的 backup/restore 都会复制该文件。

验证已通过：RED 测试先失败于未生成 health record、DR status 未读取持久化记录，以及缺少 shadow health 选择逻辑；修复后 `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state-shadow-health.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/forgeflow-dispatcher test -- tests/backup.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm docs:validate`、`git diff --check`、`pnpm verify:stage3` 通过。

剩余风险：shadow failure 仍不是 `RuntimeState.events[]` 中的一等审计事件；shadow drift 自动对账和 primary cutover 仍需单独设计。

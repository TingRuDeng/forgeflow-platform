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

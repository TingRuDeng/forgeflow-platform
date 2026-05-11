# 文档上下文迁移任务

- [x] 审计现有规则入口、文档导航、稳定知识层和归档区。
- [x] 对照代码验证 dispatcher、lease、read-only、shadow、DR 脚本和发布 workflow 事实。
- [x] 补齐新版人机双友好文档结构和 `docs/AI_CONTEXT.md`。
- [x] 补充文档校验脚本并接入根目录命令。
- [x] 归档旧版重复文档并修正引用。
- [x] 运行文档校验、相关测试和 diff 检查。

## Review 小结

已完成增量迁移，没有从零重写旧文档。新增 `docs/AI_CONTEXT.md` 和 `scripts/validate_docs.py`，权威文档补齐目的、读者、摘要、`ai_summary`、边界和验证入口；根目录旧版 v1 手册已移入 `docs/archive/`。已运行 `pnpm docs:validate`、`python3 -m py_compile scripts/validate_docs.py`、`pnpm typecheck`、`pnpm test`、`git diff --check`。

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

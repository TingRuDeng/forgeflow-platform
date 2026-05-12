# vNext 第七批：ArtifactBundle v1

## 目标

把 worker result 的证据从零散字段推进到可引用的 minimal ArtifactBundle，同时保持 runtime state 只保存摘要和 refs，不保存大体积 diff / 日志正文。

## 计划

- [x] 扩展 `@forgeflow/result-contracts`，提供 `ArtifactBundleSchema` 和类型。
- [x] 在 dispatcher runtime state 增加 `artifactBundles[]`，result 成功或失败时可保存并绑定 active attempt。
- [x] 在 SQLite structured projection 增加 artifact bundle 投影和读取。
- [x] 让 Trae worker submitResult 产出 minimal ArtifactBundle。
- [x] 增加 CLI `artifact-get`，支持 dispatcher URL 和本地 state-dir 查询。
- [x] 更新 ArtifactBundle / 数据库 / API 文档。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/result-contracts test` 通过。
- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts` 通过。
- `pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts` 通过。
- `pnpm --filter @tingrudeng/worker-review-orchestrator-cli test -- tests/cli.test.ts` 通过。
- `pnpm typecheck`、`pnpm docs:validate`、`git diff --check` 通过。

## Review 小结

已完成 minimal ArtifactBundle v1 接入。当前 runtime 只保存 bundle 摘要和 refs，不保存 diff / log 正文；artifact retention、Console artifact tabs 和完整 v1 envelope 强制校验仍留给后续批次。

验证已通过：`pnpm --filter @forgeflow/result-contracts test`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/dispatcher-server.test.ts`、`pnpm --filter @tingrudeng/trae-beta-runtime test -- tests/runtime/worker.test.ts tests/runtime/clients.test.ts`、`pnpm --filter @tingrudeng/worker-review-orchestrator-cli test -- tests/cli.test.ts`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`、`pnpm lint`、`pnpm test`。

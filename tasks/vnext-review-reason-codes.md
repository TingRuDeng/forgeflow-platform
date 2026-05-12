# vNext 第八批：Review Reason Codes

## 目标

让 review decision 可以稳定携带结构化原因码，并让 CLI 能直接提交 reasonCode / mustFix / canRedrive，而不是要求调用方手写完整 evidence JSON。

## 计划

- [x] 为 dispatcher review decision API 增加顶层 `reasonCode` / `mustFix` / `canRedrive` / `redriveStrategy` 归一逻辑。
- [x] 扩展 decide CLI flags，并在 dispatcher URL 与本地 state-dir 两条路径都写入 evidence。
- [x] 补充 result-contracts 中的标准 ReviewReasonCode schema，保持旧字符串 reasonCode 兼容。
- [x] 更新 API / 文档导航 / 技术债边界。
- [x] 运行最小充分验证并记录结果。

## 验收

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-server.test.ts tests/modules/server/runtime-state.test.ts` 通过。
- `pnpm --filter @tingrudeng/worker-review-orchestrator-cli test -- tests/decide.test.ts tests/cli.test.ts` 通过。
- `pnpm --filter @forgeflow/result-contracts test` 通过。
- `pnpm typecheck`、`pnpm docs:validate`、`git diff --check` 通过。

## Review 小结

- dispatcher API 已支持把顶层 reason 字段归一化写入 `review.evidence`，并保留嵌套 `evidence` 兼容路径。
- decide CLI 已支持 `--reason-code`、`--must-fix`、`--can-redrive`、`--redrive-strategy`，HTTP 与本地 state-dir 路径都覆盖测试。
- result-contracts 新增标准 `ReviewReasonCodeSchema`，但 `ReviewDecisionEvidenceSchema` 仍允许旧版自定义字符串，避免破坏既有数据。
- 已运行验证：`pnpm --filter @forgeflow/result-contracts test`、`pnpm --filter @tingrudeng/worker-review-orchestrator-cli test -- tests/decide.test.ts tests/cli.test.ts`、`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/submit-review-decision.test.ts`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`、`pnpm lint`、`pnpm test`。

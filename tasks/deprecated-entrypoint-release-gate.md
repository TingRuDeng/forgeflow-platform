# Deprecated entrypoints release gate

## 目标

- 让 release workflow 的手动发布和自动发布路径都运行 deprecated entrypoints 门禁。
- 统一使用 root script：`pnpm verify:deprecated-entrypoints`。
- 删除 release workflow 内直接调用脚本的分叉写法。

## 非目标

- 不调整 deprecated entrypoints 清单。
- 不改变发布包检测、npm preflight、publish、git record 或 recovery issue 语义。
- 不移动 runtime package readiness、shadow drift 或 published smoke 门禁。

## 当前事实

- `package.json` 已提供 `verify:deprecated-entrypoints`。
- `.github/workflows/ci.yml` 已使用 `pnpm verify:deprecated-entrypoints`。
- `.github/workflows/release.yml` 自动发布路径仍直接调用 `node scripts/check-deprecated-entrypoints.mjs`，手动发布路径没有同名门禁。

## 执行计划

- [x] RED：更新 workflow 测试，要求 release workflow 中出现两处 `pnpm verify:deprecated-entrypoints`，且不再直接调用 node 脚本。
- [x] GREEN：在手动发布和自动发布路径中统一运行 root script。
- [x] 验证定向测试、脚本自身、typecheck、lint、docs 和 diff。

## 验证矩阵

- `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1`
- `CI=true pnpm verify:deprecated-entrypoints`
- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- `CI=true pnpm docs:validate`
- `python3 scripts/validate_docs.py . --profile generic`
- `git diff --check`

## 验证结果

- RED：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1` 失败于 release workflow 没有两处 `pnpm verify:deprecated-entrypoints`，证明测试能捕捉入口不一致。
- GREEN：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，1 个测试文件 / 7 个测试。
- `CI=true pnpm verify:deprecated-entrypoints`：通过，确认旧 staging / control-flow 入口未回流。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `python3 scripts/validate_docs.py . --profile generic`：通过。
- `git diff --check`：通过。

## Review 小结

终态：finished。

Spec 符合度：通过。release workflow 的手动发布和自动发布路径都已统一使用 `pnpm verify:deprecated-entrypoints`，并删除直接 `node scripts/check-deprecated-entrypoints.mjs` 的分叉写法。

安全检查：通过。未新增 secret、外部输入、发布动作、fallback 或 mock 成功路径。

测试与验证：通过。已覆盖 workflow 断言、脚本自身执行、typecheck、lint、docs validator 和 diff check。

复杂度检查：通过。未新增运行时代码；workflow 仅增加一个发布前检查 step，测试只扩展已有 workflow quality gate。

Document-refresh: not-needed
原因：本轮只统一 CI / release 门禁入口，不改变用户文档或运行时能力说明。

剩余风险：门禁覆盖范围仍由 `scripts/check-deprecated-entrypoints.mjs` 清单决定。

潜在技术债：如 deprecated 入口清单继续扩张，可后续抽出共享清单模块，避免脚本和测试维护分叉。

结论：通过。

# Deprecated entrypoints CI gate

## 目标

- 将已有 `scripts/check-deprecated-entrypoints.mjs` 暴露为本地可运行的 root script。
- 在 CI 中运行同一门禁，避免已移除的 staging / control-flow 旧入口回流。
- 保持 release workflow 现有检查不变。

## 非目标

- 不删除新的业务入口。
- 不修改 release 发布语义。
- 不调整 deprecated 路径清单。

## 当前事实

- `scripts/check-deprecated-entrypoints.mjs` 已存在，并会在发现旧入口文件时失败。
- `.github/workflows/release.yml` 已运行该脚本。
- `package.json` 尚未提供统一的 `pnpm verify:deprecated-entrypoints` 入口，`.github/workflows/ci.yml` 也未运行该门禁。

## 执行计划

- [x] RED：补充 workflow 测试，要求 root script 和 CI step 存在。
- [x] GREEN：新增 `verify:deprecated-entrypoints` script，并接入 CI。
- [x] 验证定向测试、脚本本身、typecheck、lint、docs 和 diff。

## 验证矩阵

- `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1`
- `CI=true pnpm verify:deprecated-entrypoints`
- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- `CI=true pnpm docs:validate`
- `python3 scripts/validate_docs.py . --profile generic`
- `git diff --check`

## 验证结果

- RED：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1` 失败于 `verify:deprecated-entrypoints` 不存在，证明测试能捕捉缺口。
- GREEN：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts --maxWorkers=1` 通过，1 个测试文件 / 7 个测试。
- `CI=true pnpm verify:deprecated-entrypoints`：通过，确认旧 staging / control-flow 入口未回流。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `python3 scripts/validate_docs.py . --profile generic`：通过。
- `git diff --check`：通过。

## Review 小结

终态：finished。

Spec 符合度：通过。本轮只新增 root script 和 CI step，release workflow 现有检查保持不变。

安全检查：通过。未新增 secret、网络调用、发布动作、fallback 或 mock 成功路径。

测试与验证：通过。已覆盖 workflow 断言、脚本自身执行、typecheck、lint、docs validator 和 diff check。

复杂度检查：通过。未新增运行时代码；workflow 测试只增加一个小断言。

Document-refresh: not-needed
原因：本轮是 CI 门禁和任务记录变更，不改变用户文档或运行时能力说明。

剩余风险：CI 只能阻止清单内 deprecated entrypoints 回流；新增 deprecated 路径仍需要维护清单。

潜在技术债：如 deprecated 入口清单继续增长，可后续把清单抽成可复用模块供脚本和测试共享。

结论：通过。

# Deprecated entrypoints script tests

## 目标

- 为 `scripts/check-deprecated-entrypoints.mjs` 增加直接单测。
- 验证脚本按仓库根目录相对路径发现 deprecated entrypoints。
- 保持现有 CLI JSON 输出和退出码语义不变。

## 非目标

- 不调整 deprecated entrypoints 清单。
- 不改变 CI / release workflow 的调用位置。
- 不新增发布、网络或依赖安装行为。

## 当前事实

- workflow 测试已经验证 CI / release 会调用 `pnpm verify:deprecated-entrypoints`。
- 脚本自身此前只作为 CLI 运行，没有导出可测试的查找函数。
- `scripts/check-deprecated-entrypoints.mjs` 当前根据 `process.cwd()` 下的固定相对路径清单判断旧入口是否存在。

## 执行计划

- [x] RED：新增脚本语义测试，要求导出 `findDeprecatedEntryPoints()` 并按传入 `cwd` 检查路径。
- [x] GREEN：导出 `DEPRECATED_PATHS`、`findDeprecatedEntryPoints()` 和 `runDeprecatedEntryPointCheck()`，并用 `import.meta.url` guard 保持 CLI 行为。
- [x] 验证定向测试、脚本入口、语法检查、typecheck、lint、docs 和 diff。

## 验证矩阵

- `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/deprecated-entrypoints.test.ts --maxWorkers=1`
- `CI=true pnpm verify:deprecated-entrypoints`
- `node --check scripts/check-deprecated-entrypoints.mjs`
- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- `CI=true pnpm docs:validate`
- `python3 scripts/validate_docs.py . --profile generic`
- `git diff --check`
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm test`

## 验证结果

- RED：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/deprecated-entrypoints.test.ts --maxWorkers=1` 失败于 `findDeprecatedEntryPoints is not a function`，证明测试能捕捉脚本不可直接验证的问题。
- GREEN：`CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/deprecated-entrypoints.test.ts --maxWorkers=1` 通过，1 个测试文件 / 2 个测试。
- `CI=true pnpm verify:deprecated-entrypoints`：通过。
- `node --check scripts/check-deprecated-entrypoints.mjs`：通过。
- `CI=true pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/deprecated-entrypoints.test.ts tests/modules/execution/workflows.test.ts --maxWorkers=1`：通过，2 个测试文件 / 9 个测试。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `python3 scripts/validate_docs.py . --profile generic`：通过。
- `git diff --check`：通过。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm test`：默认沙箱首次失败于 `packages/automation-gateway-core/tests/gateway-http-server.test.ts` 监听 `127.0.0.1` 的 `listen EPERM`；按同一命令在非沙箱环境复跑通过，dispatcher 61 个测试文件 / 551 个测试通过。

## Review 小结

终态：finished。

Spec 符合度：通过。脚本已导出可测试函数，CLI 执行仍通过 `import.meta.url` guard 保持原有输出和退出码语义。

安全检查：未新增 secret、网络调用、发布动作、fallback 或 mock 成功路径。

测试与验证：通过。已覆盖 RED/GREEN、脚本入口、语法检查、workflow 关联测试、typecheck、lint、docs validator、diff check 和非沙箱全量测试。

复杂度检查：新增脚本 helper 均低于 50 行；脚本文件仍低于 300 行。

Document-refresh: not-needed
原因：本轮只增加脚本测试和可测试导出，不改变用户文档或运行时能力说明。

剩余风险：门禁覆盖范围仍由清单维护质量决定；默认沙箱仍不能运行需要监听 `127.0.0.1` 的 HTTP server 测试。

潜在技术债：如清单继续扩张，可后续把清单迁移成独立 JSON 或共享配置。

结论：通过。

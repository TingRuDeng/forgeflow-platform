# Dispatcher 测试预构建计划

## 目标

- 让本地 `@forgeflow/dispatcher` 测试和 CI 一样先预构建 `apps/dispatcher/dist`。
- 测试进程默认设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`，减少多个测试进程重复触发 dispatcher dist build。
- 保留 `dispatcher-state.test.ts` 中验证 stale dist 自动修复的专门测试路径。

## 非目标

- 不移除 `scripts/lib/dispatcher-state.ts` 的兼容 wrapper。
- 不改变 dispatcher 运行时入口和发布包结构。
- 不改业务状态机、HTTP API 或持久化语义。

## 当前事实

- `scripts/lib/dispatcher-state.ts` 会在 `FORGEFLOW_DISPATCHER_DIST_PREBUILT !== "1"` 时自行执行 `pnpm --filter @forgeflow/dispatcher build`。
- CI workflow 已在 dispatcher 测试步骤设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`。
- 本地 `apps/dispatcher/package.json` 的 `test` 仍直接运行 `vitest run --config vitest.config.ts`，没有先构建，也没有设置该环境变量。
- `dispatcher-state.test.ts` 已显式清除 `FORGEFLOW_DISPATCHER_DIST_PREBUILT` 来覆盖 stale dist 自愈路径。

## 方案对比

- 方案 A：新增专用 Node 测试 runner，先执行 dispatcher build，再以 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1` 启动 Vitest。
  - 优点：跨平台，不依赖 shell 环境变量语法；能集中保留 CLI 参数透传。
  - 缺点：新增一个小脚本。
- 方案 B：直接把 package script 改成 `pnpm run build && FORGEFLOW_DISPATCHER_DIST_PREBUILT=1 vitest run ...`。
  - 优点：改动最少。
  - 缺点：依赖 POSIX shell 环境变量写法，不适合跨平台。
- 方案 C：用 Vitest globalSetup 预构建并设置 env。
  - 优点：保留 package script 简洁。
  - 缺点：worker 进程 env 传播和构建时机更隐式，后续排障不如显式 runner。

## 推荐方案

采用方案 A。它是最显式、跨平台且可测试的方式，能直接解决本地全量测试重复构建噪音，同时不碰 runtime 行为。

## 执行计划

- [x] 新增 `apps/dispatcher/scripts/run-tests.mjs`。
- [x] 修改 `apps/dispatcher/package.json` 的 `test` script 调用该 runner。
- [x] runner 先执行 `pnpm --filter @forgeflow/dispatcher build`，再用当前 Node 启动 workspace 内 Vitest CLI，并设置 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1`。
- [x] 保留额外 CLI 参数透传，保证 `pnpm --filter @forgeflow/dispatcher test -- tests/...` 仍可用。
- [x] 运行受影响 dispatcher 测试和仓库级静态门禁。

## 验证矩阵

- `CI=true pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-state.test.ts --maxWorkers=1`
- `CI=true pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/run-dispatcher-server.test.ts --maxWorkers=1`
- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- `CI=true pnpm docs:validate`
- `git diff --check`

## HARD-GATE

用户确认前不进行代码修改。

## 进度记录

- 2026-07-06：用户确认后执行计划，新增 `apps/dispatcher/scripts/run-tests.mjs`，并将 `apps/dispatcher/package.json` 的 `test` script 切到该 runner。
- 2026-07-06：首次运行指定 dispatcher 测试失败，根因是 pnpm 透传参数中首个 `--` 被原样传给 Vitest，导致 Vitest 跑全量 dispatcher 测试，并在沙箱内触发 Trae session store 写用户 HOME 的权限失败。
- 2026-07-06：修复 runner 参数归一化，去掉首个透传分隔符但保留测试路径和 Vitest 选项；指定测试复跑通过。

## 验证结果

- `CI=true pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/dispatcher-state.test.ts --maxWorkers=1`：通过，1 个测试文件 / 28 个测试。
- `CI=true pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/run-dispatcher-server.test.ts --maxWorkers=1`：通过，1 个测试文件 / 9 个测试。
- `CI=true HOME=/private/tmp/forgeflow-test-home pnpm --filter @forgeflow/dispatcher test`：通过，60 个测试文件 / 548 个测试。
- `node --check apps/dispatcher/scripts/run-tests.mjs`：通过。
- `CI=true pnpm typecheck`：通过。
- `CI=true pnpm lint`：通过。
- `CI=true pnpm docs:validate`：通过。
- `git diff --check`：通过。

## Review 小结

终态：finished。

Spec 符合度：通过。dispatcher 本地测试入口现在会先构建 `apps/dispatcher/dist`，再以 `FORGEFLOW_DISPATCHER_DIST_PREBUILT=1` 启动 Vitest；`dispatcher-state.test.ts` 仍可显式清除该环境变量，覆盖 stale dist 自愈路径。

安全检查：通过。未新增 secret、外部输入拼接、网络调用或静默 fallback；runner 只调用仓库内既有 build 与 Vitest 命令。

测试与验证：通过。指定测试、dispatcher 包全量测试、Node 语法检查、typecheck、lint、文档校验和 diff 检查均已通过。

复杂度检查：通过。新增 runner 低于 50 行，函数职责单一，未改业务模块。

Document-refresh: not-needed
原因：本轮只调整测试入口和任务记录，不改变公开架构、接口或运行契约。

剩余风险：dispatcher 包全量测试在沙箱内若使用真实 HOME 仍可能因 Trae session store 写用户目录失败；验证时已用临时 HOME 规避权限问题。

潜在技术债：`scripts/lib/dispatcher-state.ts` 兼容 wrapper 仍存在，后续如彻底移除 checked-in wrapper，需要单独设计运行入口替代方案。

结论：通过。

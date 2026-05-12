# vNext 第九批：Console Timeline MVP

## 目标

让 Console 的任务详情能够从 dashboard snapshot 直接查看 attempt timeline、runtime events 和 artifact bundle 摘要，减少审查者在 dispatcher 状态文件与控制台之间来回切换。

## 计划

- [x] 在 dashboard snapshot 暴露 `taskAttempts` 与 `artifactBundles`。
- [x] 在 Console 任务详情面板接入 selected task 的 attempts 与 artifact bundles。
- [x] 渲染 attempts list、runtime events list 和 artifact summary。
- [x] 补充中英文 UI 文案与组件测试。
- [x] 更新 API / Console 文档，并运行最小充分验证。

## 验收

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts` 通过。
- `pnpm --filter console test:run -- src/components/__tests__/Lists.test.tsx` 通过。
- `pnpm typecheck`、`pnpm docs:validate`、`git diff --check` 通过。

## Review 小结

- dashboard snapshot 已新增 `taskAttempts` 与 `artifactBundles`，供 Console 直接消费。
- Console 任务详情已拆出 `TaskTimeline` 局部组件，展示 attempt timeline、runtime events 和最新 artifact summary。
- 已运行验证：`pnpm --filter @forgeflow/dispatcher test -- tests/modules/server/runtime-state.test.ts`、`pnpm --filter console test:run -- src/components/__tests__/Lists.test.tsx`、`pnpm typecheck`、`pnpm docs:validate`、`git diff --check`、`pnpm --filter console lint`、`pnpm --filter console build`、`pnpm lint`、`pnpm test`。

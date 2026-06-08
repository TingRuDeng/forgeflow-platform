# Trae session-store 默认路径对齐

## 目标

将 `scripts/lib` Trae automation gateway 的默认 session-store 路径对齐到发布包 `@tingrudeng/trae-beta-runtime` 使用的用户级稳定目录，减少两套 gateway 实现的运行时行为漂移。

## 非目标

- 不合并两套 gateway 实现。
- 不重写 session 持久化解析逻辑。
- 不引入新的 session 状态格式。

## 当前事实

- `packages/trae-beta-runtime/src/runtime/trae-automation-session-store.ts` 默认写入 `~/.forgeflow-trae-beta/sessions/sessions.json`。
- 变更前，`scripts/lib/trae-automation-session-store.ts` 默认写入相对路径 `.forgeflow-trae-gateway/sessions.json`。
- `docs/TECH_DEBT.md` 已明确 Trae gateway 仍有重复实现和剩余行为漂移。

## 决策日志

- 以发布包路径作为统一默认路径，避免脚本从不同工作目录启动时写入不同相对目录。
- 保留 `--state-dir` 显式覆盖能力，避免破坏需要隔离状态目录的本地调试。
- 本轮只处理默认路径；结构化 session 解析和 debugLog 差异保留为后续技术债。

## 执行计划

- [x] 补充 scripts/lib session-store 默认路径 RED 测试。
- [x] 更新 scripts/lib session-store 默认目录和 gateway 帮助文案。
- [x] 同步架构、数据库、契约和技术债文档。
- [x] 运行验证并补充 Review 小结。

## 验证结果

- RED：`pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-session-store.test.ts` 失败，期望 `~/.forgeflow-trae-beta/sessions/sessions.json`，实际 `.forgeflow-trae-gateway/sessions.json`。
- GREEN：`pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-session-store.test.ts` 通过，16 个用例通过。
- `pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway.test.ts`：通过，28 个用例通过。
- `pnpm docs:validate`：通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `git diff --check`：通过。
- `pnpm test`：通过。

## Review 小结

- 已将 scripts/lib gateway 默认 session-store 路径对齐到发布包使用的 `~/.forgeflow-trae-beta/sessions/sessions.json`，并保留 `--state-dir` 覆盖能力。
- 已同步架构、数据库、契约、onboarding 和技术债文档。
- 剩余风险：两套 gateway 仍有重复实现，packaged runtime 的持久化解析和结构化 debugLog 仍强于 scripts/lib。

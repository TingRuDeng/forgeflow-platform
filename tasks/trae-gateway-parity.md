# Trae gateway prepare-session 行为对齐

## 目标

对齐 `scripts/lib` Trae automation gateway 与 packaged runtime 的 prepare-session 会话行为，减少两套实现之间的可见漂移。

## 非目标

- 不合并两套 gateway 实现。
- 不改 Trae worker 主链执行流程。
- 不改变 session store 默认路径。

## 当前事实

- `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts:handleTraeAutomationHttpRequest` 在 `POST /v1/sessions/prepare` 中会创建会话，并在 prepare 成功后标记为 `running`。
- `scripts/lib/trae-automation-gateway.ts:handleTraeAutomationHttpRequest` 只有在没有传入 `sessionId` 时才创建会话，且 prepare 成功后仍保持 `prepared`。
- `scripts/lib/trae-automation-gateway.ts:handleTraeAutomationHttpRequest` 已支持 `POST /v1/sessions/:sessionId/release`，`docs/TECH_DEBT.md` 中对应事实已过期。

## 决策日志

- 本轮只修复 prepare-session 行为漂移：source gateway 使用传入 `sessionId` 创建会话，并在 prepare 成功后标记为 `running`。
- 技术债文档改为记录仍存在的真实差异：两套实现重复、默认 session-store 路径不同、packaged runtime 有更强的结构化解析和 debugLog。

## 执行计划

- [x] 补充 RED 测试，锁定 source gateway prepare-session 会创建传入 `sessionId` 并标记 `running`。
- [x] 修改 `scripts/lib/trae-automation-gateway.ts` 的 prepare-session 会话写入逻辑。
- [x] 同步 `docs/TECH_DEBT.md` 和任务记录。
- [x] 运行受影响测试、类型检查、lint、文档校验和 diff 检查。
- [x] 补充 Review 小结。

## 验证结果

- RED：`pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/server/trae-automation-gateway.test.ts` 失败于 `prepared` 未变成 `running`，以及传入 `sessionId` 时 source gateway 未创建会话。
- GREEN：同一命令通过，1 个测试文件、28 个用例通过。
- `pnpm --filter @tingrudeng/trae-beta-runtime exec vitest run tests/runtime/trae-automation-gateway.test.ts`：通过，1 个测试文件、11 个用例通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm docs:validate`：通过。
- `git diff --check`：通过。
- `pnpm test`：通过；dispatcher 38 个测试文件、400 个用例通过。

## Review 小结

- 已将 `scripts/lib` gateway 的 prepare-session 行为对齐到 packaged runtime：会使用请求传入的 `sessionId` 创建会话，并在 prepare 成功后标记为 `running`。
- 已修正 `docs/TECH_DEBT.md` 中过期的 release endpoint 漂移事实；剩余债务是重复实现、默认 session-store 路径差异和 packaged runtime 更强的解析 / debugLog 能力。
- 剩余风险：两套 gateway 仍未合并，共享兼容测试覆盖仍有限。

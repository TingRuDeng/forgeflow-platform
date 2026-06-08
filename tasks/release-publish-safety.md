# 发布链路安全化

## 目标

降低手动 npm 发布链路的不可恢复风险：npm 发布失败时不得提前推进 git commit / tag；npm 发布成功但 git 记录失败时必须给出明确恢复提示。

## 非目标

- 不改自动 push 发布链路的版本检测逻辑。
- 不引入新的发布系统或第三方 release 工具。
- 不处理 M2-M6 的 shadow、DR、lease、Console 或 entrypoint drift 目标。

## 当前事实

- `.github/workflows/release.yml` 的手动发布路径当前先 commit/tag/push，再执行 `npm publish`。
- `apps/dispatcher/tests/modules/execution/workflows.test.ts` 当前把 `git push` 早于 `npm publish` 固化成测试期望。
- `packages/trae-beta-runtime` 的 `prepublishOnly` 会把 `workspace:*` 依赖改写成已发布版本，发布后提交 git 记录时必须避免把该临时改写误提交。

## 决策日志

- 选择把 `npm publish` 放在 git commit/tag/push 之前，优先消除“git 已前进但 npm 未发布”的风险。
- 发布前保存 bump 后的 `package.json`，`npm publish` 成功后恢复该文件，再提交版本记录，避免提交 `prepublishOnly` 的临时依赖改写。
- 不自动创建 GitHub Issue；先使用 GitHub Actions step summary 写清恢复步骤，保持实现简单且不扩大权限面。

## 执行计划

- [x] 调整手动 release workflow 的 publish / git record 顺序。
- [x] 更新 workflow 质量测试，锁定 npm publish 早于 git push。
- [x] 同步 release cadence、README 和技术债说明。
- [x] 运行受影响测试、文档校验、类型检查和 diff 检查。
- [x] 补充 Review 小结。

## 进度记录

- 2026-06-08：用户确认迭代计划，开始执行 M1。
- 2026-06-08：完成手动 release workflow 顺序调整，发布成功后再提交版本记录和 tag。
- 2026-06-08：补充 post-publish git 记录失败的 Actions summary 恢复提示。
- 2026-06-08：同步 README、release cadence runbook 和技术债说明。

## 验证结果

- `pnpm --filter @forgeflow/dispatcher test -- tests/modules/execution/workflows.test.ts`：通过；实际执行 dispatcher 测试 35 个文件、394 个测试。
- `pnpm docs:validate`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `git diff --check`：通过。
- `pnpm test`：通过；全量 workspace 测试通过。

## Review 小结

已将手动发布路径调整为先完成 `npm publish`，再提交 `package.json` 版本变更、创建 release tag 并推送，避免 npm 发布失败时 git 历史提前记录未发布版本。发布前会保存 bump 后的 `package.json`，publish 成功后恢复该文件再提交，避免 `prepublishOnly` 的临时依赖改写被误提交。

剩余风险：如果 `npm publish` 已成功但后续 git commit/tag/push 失败，npm 会短暂领先 git；workflow 会在 Actions summary 中输出 `手动发布需要恢复` 和人工恢复步骤。

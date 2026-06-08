# 手动发布恢复 issue 自动留痕

## 目标

当手动 release 已经成功 `npm publish`，但后续 git commit / tag / push 失败时，自动创建 GitHub issue 记录恢复事项，避免只依赖 Actions summary 被人发现。

## 非目标

- 不自动修改 `main` 或补打 tag。
- 不改变 `npm publish` 先于 git record 的顺序。
- 不处理 push 自动发布路径。

## 当前事实

- `.github/workflows/release.yml` 已在 publish 成功后才提交版本记录和 tag。
- post-publish git record 失败时已有 Actions summary。
- `publish-manual` 当前没有 `issues: write` 权限，也不会自动创建恢复 issue。

## 决策日志

- 在 `publish-manual` job 增加 `issues: write`。
- 新增 `创建发布后 git 恢复 issue` 步骤，条件与 summary 一致：`failure() && steps.publish.outcome == 'success'`。
- issue body 写清包名、版本、tag、workflow run 和人工恢复步骤。

## 执行计划

- [x] 更新 release workflow 权限和失败恢复步骤。
- [x] 补充 workflow 结构测试。
- [x] 同步 release runbook、README 和技术债说明。
- [x] 运行验证并补充 Review 小结。

## 验证结果

- `pnpm --filter @forgeflow/dispatcher exec vitest run tests/modules/execution/workflows.test.ts`：通过，1 个测试文件、2 个用例通过。
- `pnpm docs:validate`：通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `git diff --check`：通过。
- `pnpm test`：首次在 dispatcher 集成测试并发阶段触发 15 秒超时；失败文件单独复跑全部通过。新增 `apps/dispatcher/vitest.config.ts` 将 dispatcher 测试超时预算设为 30 秒后，`pnpm test` 通过。

## Review 小结

- 已在手动 release 的 post-publish git record 失败路径创建恢复 issue，issue 包含 package、version、tag、workflow run 和人工恢复步骤；权限只在 `publish-manual` job 增加 `issues: write`。
- 已同步 README、release runbook 与技术债文档，明确现在可自动留痕但恢复动作仍需人工补齐。
- 剩余风险：同一次失败 workflow 如果被反复重跑，可能创建重复恢复 issue；当前保留为显式人工去重，不在 release workflow 里加入复杂状态查询。

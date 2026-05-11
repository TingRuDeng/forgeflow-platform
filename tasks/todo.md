# 当前项目审查修复任务

- [x] 修复 dispatcher read-only 写冻结缺口，补齐真实写路由拦截，并避免只读 GET 在 read-only 下落盘。
- [x] 将 dispatcher POST 鉴权前置到 body 解析之前，并补充 worker register 结构化输入校验。
- [x] 让 shadow 写失败可观测，并把 shadow health 接入 DR 状态。
- [x] 将 DR drill 升级为真实 SQLite/WAL 备份恢复验证。
- [x] 将文档校验接入 CI，并修正手动发布版本不可追踪问题。
- [x] 运行最小充分验证并补充 review 小结。

## Review 小结

已修复 read-only 写冻结、POST 鉴权前置、worker register 输入校验、shadow 写失败可观测、真实 SQLite DR 演练、CI 文档门禁和手动发布版本落账问题。

验证已通过：`pnpm docs:validate`、`git diff --check`、受影响 dispatcher 测试、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm -r --if-present build`、`pnpm coverage:critical`。

剩余风险：非 assignment lease 仍只是结构与指标层能力，repo/branch/session 强约束需要后续单独设计；手动发布现在先 commit/tag/push 再 publish，若 npm publish 失败，git 历史中会保留未发布版本，需要按发布 runbook 人工处置。

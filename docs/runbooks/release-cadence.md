# Release Cadence

阶段一/二默认发布节奏：

- patch：按周
- hotfix：必要时随时
- minor：阶段收尾时集中

## 1. patch

适用：

- 风险修复
- 文档同步
- 非破坏性契约补强

## 2. hotfix

适用：

- P0 安全
- 数据一致性
- 主链路不可用

hotfix 要求：

- 附故障说明
- 附回滚步骤
- 附最小验证命令

## 3. 发布前检查

- CI 全绿
- 文档同步完成
- runbook 已更新
- release notes 已准备

## 4. 手动 npm 发布失败恢复

手动包发布入口是 `.github/workflows/release.yml`。

- workflow 先执行 preflight、依赖安装、类型检查、测试、版本 bump、构建和 `npm publish`。
- `npm publish` 成功后，workflow 才提交对应 `packages/<name>/package.json` 版本变更、创建 `release/<name>@<version>` tag 并推送。
- 如果 `npm publish` 失败，git commit / tag 不会提前推进；修复 npm 或 Trusted Publishing 配置后重新触发发布即可。
- 如果 `npm publish` 已成功但 git 记录失败，GitHub Actions summary 会标记 `手动发布需要恢复`，并自动创建一个恢复 issue。此时先确认 npm 上该版本存在，再在 `main` 上补交同一个 `package.json` 版本变更，并创建同名 release tag；完成后关闭该 issue。

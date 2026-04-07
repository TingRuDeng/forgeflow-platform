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


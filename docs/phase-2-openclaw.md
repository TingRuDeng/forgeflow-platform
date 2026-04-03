# Phase 2: OpenClaw / ACP 边界

## 1. OpenClaw 在 Phase 2 的目标职责

OpenClaw 不替代当前 GitHub-first 主链路，它在 Phase 2 的职责应收敛为：

- 会话控制入口
- ChatOps
- 人工接管台
- 状态观察台

## 2. ACP 的接入边界

ACP 更适合做：

- session spawn
- session steer
- session cancel
- IDE / 控制台观察

不适合作为 v1 的主调度总线。

## 3. 为什么不进入 v1 主链路

当前不进入 v1 的原因：

- v1 先追求最小可运行闭环
- GitHub + worktree + PR 已经足够支撑第一版
- 过早引入会话控制层只会增加复杂度
- 当前更需要先跑通 dispatcher、worker、review、merge 这条主链路

## 4. Phase 2 的接入方式

推荐接法：

- GitHub 仍是唯一真相源
- MCP 仍是工具总线
- OpenClaw / ACP 作为控制面增强层接入

# forgeflow-platform v1 发布说明

> Archived: 这份文档只保留历史上下文，不代表当前主线。当前入口请看 `../README.md` 与 `../../README.md`。

## 1. v1 已支持

- `codex-control` 作为唯一交互入口
- `codex-worker` 与 `gemini-worker` 的基础分工
- 统一 task schema 与 result contracts
- dispatcher 状态机
- worktree manager
- provider registry 与 doctor 预检
- 4 个最小 MCP servers
- runtime adapter 骨架
- review gate 基础服务
- workflow 模板
- 业务仓接入文档与示例

## 2. v1 的使用方式

当前 v1 采用：

- 单个源仓库
- 多任务分支
- 多 `git worktree`
- PR 合并

## 3. 当前限制

- 还没有完整 dispatcher 到 GitHub API 的实连
- `ai-dispatch` 仍是 placeholder 调度入口
- 还没有真实执行 codex/gemini 任务的 orchestrated runtime loop
- 观测面仍是最小骨架
- branch protection 对私有个人仓可能不强制生效

## 4. 适合当前 v1 的场景

- 先把单仓多 worker 协作跑通
- 在真实业务仓演练 PR / CI / review 流程
- 为 Phase 2 的 OpenClaw / ACP 接入打基础

# 真实两机 Codex 演练 Runbook

已归档。该 runbook 依赖的本地 codex drill 脚本

- `scripts/create-two-codex-drill-planner.js`
- `scripts/run-codex-control-flow.js`
- `scripts/run-dispatch-assignments.js`

都已从主线仓库移除，不再作为当前支持入口。

保留本文档只用于说明历史演练方式，避免把旧控制层闭环再次当成当前主线路径。

当前替代入口：

- 控制面启动：`scripts/start-control-plane.sh`
- 控制层调度 / 审查：`forgeflow-review-orchestrator`
- Trae 无人值守主线：`@tingrudeng/trae-beta-runtime`

如果确实要维护 deferred 的 `codex/gemini` worker daemon 链路，请以当前 `dispatcher + run-worker-daemon.js` 为准，而不是恢复本文档里的旧本地 drill 流程。

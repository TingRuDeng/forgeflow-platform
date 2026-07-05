# @tingrudeng/beta-runtime-core

ForgeFlow beta runtime 的共享 worker daemon 与 task worktree 控制逻辑。

该包面向 `@tingrudeng/codex-beta-runtime`、`@tingrudeng/gemini-beta-runtime` 和源码仓 `scripts/run-worker-assignment.js` 复用，不提供独立 CLI。worker daemon 主循环、assignment runner、Codex/Gemini launch builder、managed executor、live executor、失败 result 回写和 task worktree 控制逻辑都应优先在这里扩展；provider 专属 CLI wrapper 仍保留在各自 runtime 包内。

当前发布状态：

- 这是源码内共享包，不是远程机器直接安装入口。
- npm 包名当前仍需外部包名和 Trusted Publisher 配置；配置完成并发布前，由 workspace 依赖消费。

## 验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
```

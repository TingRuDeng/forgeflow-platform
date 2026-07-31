# @tingrudeng/beta-runtime-core

ForgeFlow beta runtime 的共享 worker daemon 与 task worktree 控制逻辑。

该包面向 `@tingrudeng/codex-beta-runtime`、`@tingrudeng/gemini-beta-runtime`、`@tingrudeng/trae-beta-runtime` 和源码仓 worker adapter 复用，不提供独立 CLI。worker daemon 主循环、assignment runner、Codex/Gemini launch builder、managed executor、live executor、失败 result 回写和所有 provider 的 task worktree 控制逻辑都应优先在这里扩展；provider 专属 CLI、Trae session 与 automation adapter 仍保留在各自 runtime 包内。

当前发布状态：

- 这是源码内共享包，不是远程机器直接安装入口。
- npm 包名当前仍需外部包名和 Trusted Publisher 配置；配置完成并发布前，由 workspace 依赖消费。

## 执行隔离

Codex / Gemini assignment 默认使用 `trusted-host`。设置 `FORGEFLOW_EXECUTION_PROFILE=isolated-container` 和固定本地 `FORGEFLOW_EXECUTION_CONTAINER_IMAGE` 后，共享 runner 会把 provider 与 verification 都放入同一容器策略，并在 runtime 或镜像不可用时 fail closed。完整环境变量、挂载、secret、资源与网络边界见 `../../docs/contracts/execution-profile-v1.md`。

## Worktree 生命周期

- live executor 使用可取消的异步 Git 操作，单条命令默认最多运行 60 秒。
- task ID 必须生成安全的单级目录名；清洗有损或目录名过长时会附加原始 ID 的稳定短哈希以避免碰撞。升级前已登记在旧版无哈希精确路径的同分支 worktree 仍可复用，清理旧路径时必须提供并核对分支身份；符号链接路径会被拒绝。任务分支必须是合法 ref 且不能等于默认分支；复用前会核对 Git 登记的 worktree 路径与分支，拒绝未登记目录、分支占用和路径错配。
- provider 复用已有 worktree 时统一执行 `git reset --hard HEAD` + `git clean -fd`，避免上一次执行的已跟踪和未跟踪内容污染新 attempt。
- `FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT=1` 只会在 terminal result 已被 dispatcher 确认后尝试清理。默认不带 `--force`，脏 worktree 会保留并上报 `worktree_cleanup_failed`。
- 只有同时设置 `FORGEFLOW_WORKER_FORCE_WORKTREE_CLEANUP=1` 才会强制清理；这会丢弃任务 worktree 中尚未提交的内容，应只用于操作者明确接受该风险的环境。

## 验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
```

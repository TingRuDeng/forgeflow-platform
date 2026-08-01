# @tingrudeng/beta-runtime-core

ForgeFlow beta runtime 的共享 worker daemon 与 task worktree 控制逻辑。

该包面向 `@tingrudeng/codex-beta-runtime`、`@tingrudeng/gemini-beta-runtime`、`@tingrudeng/trae-beta-runtime` 和源码仓 worker adapter 复用，不提供独立 CLI。worker daemon 主循环、assignment runner、Codex/Gemini launch builder、managed executor、live executor、失败 result 回写和所有 provider 的 task worktree 控制逻辑都应优先在这里扩展；provider 专属 CLI、Trae session 与 automation adapter 仍保留在各自 runtime 包内。

当前发布状态：

- 这是源码内共享包，不是远程机器直接安装入口。
- npm 包名和 Trusted Publisher 已配置，版本 PR 合入受保护 `main` 后由 Release workflow 自动发布；源码仓内仍由 workspace 依赖消费。

## Dispatcher 协议

共享 dispatcher client 提供 claim/start/progress/result 主链。`runtime/dispatcher-auth` 统一执行 worker token 优先级和非空 / 无首尾空白校验；高优先级变量已定义但无效时 fail closed，不回退其他 token。generic HTTP / state-dir 与 Trae heartbeat client 复用 `heartbeat-delivery` 和共享 dispatcher retry 内核，固定最多尝试 4 次、间隔 1 秒，并在重试间复用同一 payload；网络/超时、`408`、`425`、`429` 与 `5xx` 会重试，普通 `4xx` 立即失败。

progress 使用 `POST /api/workers/:workerId/progress`，携带 claim 返回的完整 v1 attempt envelope，以及每条逻辑更新唯一的 `progressId`；普通 telemetry endpoint 不用于写入 progress。同一次逻辑更新会在所有网络投递中复用原 payload 和 `progressId`；它使用同一瞬时错误分类，默认总计最多尝试 3 次、间隔 1 秒。`WORKER_PROGRESS_MAX_ATTEMPTS` 与 `WORKER_PROGRESS_RETRY_DELAY_MS` 可覆盖 progress 默认值；调用方 `AbortSignal` 会中止 heartbeat / progress 请求或重试等待。

## 本地配置安全

`runtime/secure-config-file` 提供共享的 Node-only 配置路径安全原语，供 dispatcher、provider runtime、Console 的 Node 配置助手与 review orchestrator 复用。它只负责目录链 symlink、可替换目录祖先、文件类型 / mode、打开前后 identity、同一 fd 读取、旧权限修复及同目录原子写，不接管各消费者的 schema、默认路径或认证策略。它只支持 Unix-like 平台（macOS / Linux），会拒绝 group / other 可替换路径组件并在其他平台 fail closed。发布含该新子路径的消费者前，必须先发布对应版本的 `beta-runtime-core`。

## 执行隔离

Codex / Gemini assignment 默认使用 `trusted-host`。设置 `FORGEFLOW_EXECUTION_PROFILE=isolated-container` 和固定本地 `FORGEFLOW_EXECUTION_CONTAINER_IMAGE` 后，共享 runner 会把 provider 与 verification 都放入同一容器策略，并在 runtime 或镜像不可用时 fail closed。完整环境变量、挂载、secret、资源与网络边界见 `../../docs/contracts/execution-profile-v1.md`。

## Worktree 生命周期

- live executor 使用可取消的异步 Git 操作，单条命令默认最多运行 60 秒。
- task ID 必须生成安全的单级目录名；清洗有损或目录名过长时会附加原始 ID 的稳定短哈希以避免碰撞。升级前已登记在旧版无哈希精确路径的同分支 worktree 仍可复用，清理旧路径时必须提供并核对分支身份；符号链接路径会被拒绝。任务分支必须是合法 ref 且不能等于默认分支；复用前会核对 Git 登记的 worktree 路径与分支，拒绝未登记目录、分支占用和路径错配。
- provider 复用已有 worktree 时统一执行 `git reset --hard HEAD` + `git clean -fd`，避免上一次执行的已跟踪和未跟踪内容污染新 attempt。
- 同一 Git common-dir 下的 ForgeFlow 生命周期共用 `forgeflow-worktree-owner.lock`。默认等待 2 秒、25 毫秒重试；锁记录 PID、owner token 与创建时间，只有超过 30 秒且 PID 已退出的遗留锁可回收，释放会核对 inode 与 token。`prepareTaskWorktreeWithOwnership` / `prepareTaskWorktreeLifecycleWithOwnership` 用于持有完整任务期所有权；普通 prepare/remove helper 只在单次操作期间持锁。同一进程已持有异步 owner 时，同步 helper 会立即失败，避免阻塞 owner 的事件循环释放路径。
- generic live executor 持锁覆盖 assignment 与 Git 收尾；Trae worker 持锁覆盖 terminal result 投递尝试与确认后的可选清理。`FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT=1` 才启用删除：Trae 只在 dispatcher 确认结果后执行，未确认时保留 worktree 并在当前执行退栈时释放本机 owner；generic live executor 在返回外层 shared cycle 前执行。默认不带 `--force`，脏 worktree 会保留并上报 `worktree_cleanup_failed`。
- 只有同时设置 `FORGEFLOW_WORKER_FORCE_WORKTREE_CLEANUP=1` 才会强制清理；这会丢弃任务 worktree 中尚未提交的内容，应只用于操作者明确接受该风险的环境。
- owner lock 是本机文件锁，不覆盖独立 clone、跨主机进程或绕过 runtime helper 的直接 Git / 文件操作。

## 验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
```

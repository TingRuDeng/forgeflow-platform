# @tingrudeng/gemini-beta-runtime

ForgeFlow 远程 Gemini worker runtime 包，用于在没有 forgeflow-platform 源码 checkout 的机器上运行无人值守 Gemini worker。

当前发布状态：

- 源码内 runtime 已存在，可在仓库内用 `pnpm --filter @tingrudeng/gemini-beta-runtime exec ...` 验证。
- npm 包名当前仍需外部包名和 Trusted Publisher 配置；配置完成并发布前，不要把 `npm install -g @tingrudeng/gemini-beta-runtime` 写成已可用安装入口。

当前范围：

- 初始化本地 runtime 配置
- 校验远程机器前置条件
- 启动非托管或托管的 Gemini worker daemon
- 查看 runtime 状态并停止 worker 进程
- 直接更新 runtime 包

该包发布后对远程 Gemini runtime 路径是自包含的：

- 不要求本机 checkout forgeflow-platform 仓库
- 要求本机 checkout worker 要执行任务的目标项目仓库

## 命令

仓库内本地执行：

```bash
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta init
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta doctor
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta start worker
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta status
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta stop worker
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta update
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta version
```

仓库内后台运行并写日志：

```bash
pnpm --filter @tingrudeng/gemini-beta-runtime exec forgeflow-gemini-beta start worker --detach --log-file /tmp/gemini-worker.log
```

npm 包名配置并发布后的预期用法：

```bash
npm install -g @tingrudeng/gemini-beta-runtime
forgeflow-gemini-beta init
forgeflow-gemini-beta doctor
forgeflow-gemini-beta start worker
forgeflow-gemini-beta status
forgeflow-gemini-beta stop worker
forgeflow-gemini-beta update
forgeflow-gemini-beta version
forgeflow-gemini-beta --version
```

## 运行要求

- Node 22+
- git
- gemini CLI
- 目标项目仓库的本地 checkout
- 可访问的 dispatcher server
- dispatcher 使用默认 `token` 认证模式时，必须设置 `DISPATCHER_API_TOKEN`

## 配置

runtime 读写以下配置文件：

```text
~/.forgeflow-gemini-beta/config.json
```

默认字段包括：

- `repoDir`
- `dispatcherUrl`
- `workerId`
- `pollIntervalMs`
- `geminiBin`
- `pool`

## Dispatcher 协议

worker daemon 通过 `POST /api/workers/:workerId/claim-task` 显式领取任务，不再依赖只读的 assigned-task 查询路径。领取成功后，runtime 会把 dispatcher 返回的 `attemptId`、`leaseToken`、`protocolVersion`、`traceId`、`idempotencyKey` 作为 v1 envelope 回写到 start/result mutation。

dispatcher 默认 `token` 模式要求所有非 `/health` 接口携带 `Authorization: Bearer <DISPATCHER_API_TOKEN>`。远程机器启动 worker 前应设置：

```bash
export DISPATCHER_API_TOKEN="your-secret-token"
```

## Gemini 集成选项

`run-worker-assignment` 使用 gemini CLI run mode（`gemini -m gemini-2.5-pro -p <prompt>`），并支持以下环境变量覆盖：

- `FORGEFLOW_GEMINI_BIN` (default: `gemini`)
- `FORGEFLOW_GEMINI_MODEL` (default: `gemini-2.5-pro`)
- `FORGEFLOW_GEMINI_ARGS_JSON` (JSON string array, highest priority)
- `FORGEFLOW_GEMINI_ARGS` (shell-like string fallback)

这允许在不修改代码的情况下追加 gemini 参数。

## 说明

- 该包只负责 Gemini worker runtime，不替代完整 ForgeFlow 控制平面。
- Gemini 只支持 run mode，不支持 review mode。
- Dispatcher 仍在控制平面机器上独立运行。
- 该包按 ForgeFlow assignment package 约定执行 worker 任务。

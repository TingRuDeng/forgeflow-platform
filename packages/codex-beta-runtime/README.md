# @tingrudeng/codex-beta-runtime

ForgeFlow 远程 Codex worker runtime 包，用于在没有 forgeflow-platform 源码 checkout 的机器上运行无人值守 Codex worker。

当前范围：

- 初始化本地 runtime 配置
- 校验远程机器前置条件
- 启动非托管或托管的 Codex worker daemon
- 查看 runtime 状态并停止 worker 进程
- 直接更新 runtime 包

该包对远程 Codex runtime 路径是自包含的：

- 不要求本机 checkout forgeflow-platform 仓库
- 要求本机 checkout worker 要执行任务的目标项目仓库

## 命令

仓库内本地执行：

```bash
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta init
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta doctor
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta start worker
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta status
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta stop worker
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta update
pnpm --filter @tingrudeng/codex-beta-runtime exec forgeflow-codex-beta version
```

后台运行并写日志：

```bash
forgeflow-codex-beta start worker --detach --log-file /tmp/codex-worker.log
```

发布后的预期用法：

```bash
npm install -g @tingrudeng/codex-beta-runtime
forgeflow-codex-beta init
forgeflow-codex-beta doctor
forgeflow-codex-beta start worker
forgeflow-codex-beta status
forgeflow-codex-beta stop worker
forgeflow-codex-beta update
forgeflow-codex-beta version
forgeflow-codex-beta --version
```

## 运行要求

- Node 22+
- git
- codex CLI
- 目标项目仓库的本地 checkout
- 可访问的 dispatcher server
- dispatcher 使用默认 `token` 认证模式时，必须设置 `DISPATCHER_API_TOKEN`

## 配置

runtime 读写以下配置文件：

```text
~/.forgeflow-codex-beta/config.json
```

默认字段包括：

- `repoDir`
- `dispatcherUrl`
- `workerId`
- `pollIntervalMs`
- `codexBin`
- `pool`

## Dispatcher 协议

worker daemon 通过 `POST /api/workers/:workerId/claim-task` 显式领取任务，不再依赖只读的 assigned-task 查询路径。领取成功后，runtime 会把 dispatcher 返回的 `attemptId`、`leaseToken`、`protocolVersion`、`traceId`、`idempotencyKey` 作为 v1 envelope 回写到 start/result mutation。

dispatcher 默认 `token` 模式要求所有非 `/health` 接口携带 `Authorization: Bearer <DISPATCHER_API_TOKEN>`。远程机器启动 worker 前应设置：

```bash
export DISPATCHER_API_TOKEN="your-secret-token"
```

## Codex 集成选项

`run-worker-assignment` 使用 codex CLI 的 `exec` 模式，并支持以下环境变量覆盖：

- `FORGEFLOW_CODEX_BIN` (default: `codex`)
- `FORGEFLOW_CODEX_MODEL`
- `FORGEFLOW_CODEX_SANDBOX` (default: `workspace-write`)
- `FORGEFLOW_CODEX_ARGS_JSON` (JSON string array, highest priority)
- `FORGEFLOW_CODEX_ARGS` (shell-like string fallback)

这允许在不修改代码的情况下追加 codex 参数。

## 说明

- 该包只负责 Codex worker runtime，不替代完整 ForgeFlow 控制平面。
- Dispatcher 仍在控制平面机器上独立运行。
- 该包按 ForgeFlow assignment package 约定执行 worker 任务。

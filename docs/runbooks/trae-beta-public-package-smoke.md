# Trae Beta 公开包 Remote Smoke Runbook

本 runbook 用于验证 `@tingrudeng/trae-beta-runtime` 公开 npm 包的远程 Trae 使用流程是否正常工作。

包名：`@tingrudeng/trae-beta-runtime`
CLI 入口：`forgeflow-trae-beta`

## 1. 安装

确保 Node.js >= 22 已安装。

```bash
npm install -g @tingrudeng/trae-beta-runtime
```

验证安装：

```bash
forgeflow-trae-beta --version
```

## 2. 初始化配置

在目标机器上运行 init，生成配置文件：

```bash
forgeflow-trae-beta init \
  --project-path /path/to/your/repo \
  --dispatcher-url http://your-dispatcher:8787 \
  --automation-url http://your-automation-host:8790 \
  --worker-id your-worker-id \
  --trae-bin /path/to/trae \
  --remote-debugging-port 9222
```

覆盖已有配置：

```bash
forgeflow-trae-beta init --overwrite
```

## 3. Doctor 健康检查

运行完整健康检查，验证环境就绪：

```bash
forgeflow-trae-beta doctor
```

预期输出包含 `ok: true`，且所有 check 项的 `ok` 均为 `true`。
常见检查项：配置文件存在、trae 二进制可执行、remote debugging port 可用、dispatcher URL 可达等。

## 4. 启动 launch

启动 Trae launch 进程：

```bash
forgeflow-trae-beta start launch --project-path /path/to/your/repo --trae-bin /path/to/trae --remote-debugging-port 9222
```

如需在后台运行并记录日志：

```bash
forgeflow-trae-beta start launch --detach --log-file /tmp/launch.log
```

启动成功后会输出 JSON，包含 `pid`。

## 5. 启动 gateway

启动 Trae automation gateway：

```bash
forgeflow-trae-beta start gateway
```

如需在后台运行并记录日志：

```bash
forgeflow-trae-beta start gateway --detach --log-file /tmp/gateway.log
```

启动后检查就绪：

```bash
curl http://your-automation-host:8790/ready
```

预期返回包含 `ready: true`。

## 6. 启动 worker

启动 Trae automation worker：

```bash
forgeflow-trae-beta start worker
```

如需在后台运行并记录日志：

```bash
forgeflow-trae-beta start worker --detach --log-file /tmp/worker.log
```

worker 会向 dispatcher 注册并开始 poll 任务。

**Git SSH Override (if port 22 is blocked):**

If your environment blocks port 22, set the SSH override before starting the worker:

```bash
export FORGEFLOW_GIT_SSH_COMMAND="ssh -o Hostname=ssh.github.com -p 443"
forgeflow-trae-beta start worker
```

Or use the backward-compatible fallback:

```bash
export TRAE_GIT_SSH_COMMAND="ssh -o Hostname=ssh.github.com -p 443"
```

Note: If the remote baseline cannot be fetched (network unreachable, auth failed), the worker will still hard-fail — this only changes how SSH connects.

## 7. Status 状态查看

查看当前所有进程状态：

```bash
forgeflow-trae-beta status
```

输出包含 `gateway` 和 `worker` 的进程信息。

## 8. Stop 停止进程

停止 gateway：

```bash
forgeflow-trae-beta stop gateway
```

停止 worker：

```bash
forgeflow-trae-beta stop worker
```

## 9. 最小成功标准

smoke test 通过的最低标准：

- `doctor` 输出 `ok: true`，所有 checks 通过
- `start gateway` 后 `/ready` 返回 `ready: true`
- `status` 能正确列出 gateway 和 worker 进程状态
- `stop gateway` / `stop worker` 能干净终止进程，无残留
- 全流程可重复执行，无hang或僵尸进程

## 10. 常见故障

| 症状 | 排查方向 |
|------|---------|
| doctor 报 `trae binary not found` | 确认 `--trae-bin` 路径正确且可执行 |
| doctor 报 `remote debugging port not accessible` | 确认 Trae 已启动且 `--remote-debugging-port` 对应 |
| gateway `/ready` 返回 `ready: false` | 检查 automationUrl 配置是否与实际 gateway 绑定一致 |
| worker 无法注册到 dispatcher | 检查 dispatcherUrl 是否可访问，workerId 是否唯一 |
| `stop` 后进程仍存在 | 使用 `ps aux \| grep forgeflow-trae-beta` 手动清理 |

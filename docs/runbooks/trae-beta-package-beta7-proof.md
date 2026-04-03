# Trae Beta Package beta.7 Remote Execution Proof Runbook

本 runbook 记录使用 `@tingrudeng/trae-beta-runtime@0.1.0-beta.7` 在远程机器上完成真实 npm 安装与最小执行链路验证的步骤与预期结果。

包名：`@tingrudeng/trae-beta-runtime`
版本：`0.1.0-beta.7`
CLI 入口：`forgeflow-trae-beta`

## 1. 安装

确保 Node.js >= 22 已安装，然后在远程机器执行：

```bash
npm install -g @tingrudeng/trae-beta-runtime@0.1.0-beta.7
```

验证安装版本：

```bash
npm list -g @tingrudeng/trae-beta-runtime --depth=0
```

预期输出包含 `@tingrudeng/trae-beta-runtime@0.1.0-beta.7`。

## 2. 初始化配置

生成运行时配置：

```bash
forgeflow-trae-beta init \
  --project-path /path/to/your/repo \
  --dispatcher-url http://your-dispatcher:8787 \
  --automation-url http://127.0.0.1:8790 \
  --worker-id your-worker-id \
  --trae-bin /path/to/Trae.app \
  --remote-debugging-port 9222
```

如需覆盖已有配置：

```bash
forgeflow-trae-beta init --overwrite
```

## 3. Doctor 健康检查

执行：

```bash
forgeflow-trae-beta doctor
```

预期输出包含：

```text
ok: yes
```

当前 `doctor` 会检查：
- Node 版本
- `pnpm` 是否可用（可选，不影响通过）
- git 是否可用
- config file 是否存在
- `projectPath` 是否存在
- `projectPath` 是否为 git worktree
- Trae binary 是否存在
- dispatcher URL 是否合法
- automation URL 是否合法
- worker id 是否存在

注意：`doctor` 当前不会探测 remote debugging 端口是否已可连接；这一步由后续 `start launch` 与 gateway `/ready` 验证。

## 4. 启动 launch

```bash
forgeflow-trae-beta start launch
```

预期输出为 JSON，包含：
- `pid`
- `scriptPath`
- `command`
- `args`

如果 Trae 已经在正确项目和 remote debugging 端口上运行，launch 可能直接复用已有 target。

## 5. 启动 gateway

```bash
forgeflow-trae-beta start gateway
```

验证 gateway 就绪：

```bash
curl http://127.0.0.1:8790/ready
```

预期返回包含：

```json
{"success":true,"code":"OK","data":{"ready":true}}
```

## 6. 启动 worker

```bash
forgeflow-trae-beta start worker
```

如需后台运行，可使用：

```bash
nohup forgeflow-trae-beta start worker >/tmp/forgeflow-trae-beta-worker.log 2>&1 < /dev/null &
```

预期行为：
- worker 成功注册到 dispatcher
- worker 最终进入 `idle`

## 7. Status 状态查看

```bash
forgeflow-trae-beta status
```

预期输出包含：
- `configPresent: true`
- `gateway.running: true`
- `worker.running: true`
- `matches` 内含当前 gateway / worker 的 PID 与命令行

## 8. 最小成功标准

本轮 smoke 通过的最低标准：

- npm 全局安装成功
- `init` 成功写入 `~/.forgeflow-trae-beta/config.json`
- `doctor` 输出 `ok: yes`
- `start launch` 返回有效 `pid`
- gateway `/ready` 返回 `ready: true`
- worker 成功注册到 dispatcher，并回到 `idle`
- `status` 能准确列出 gateway 与 worker 进程

## 9. beta.7 实际验证结论

本次 beta.7 远程验证已经确认：
- 公开 npm 包可直接在远程机器安装
- 不再依赖本地 forgeflow-platform checkout
- `doctor` 能正确验证 target repo 的 git worktree
- `start launch`、`start gateway`、`start worker` 都能通过包内 `dist/runtime/*` 直接运行
- `status` 能识别包内启动的 gateway 与 worker 进程
- 远程 worker 可通过该公开包路径领取并执行真实 forgeflow-platform 任务，再把结果回写到 dispatcher

# Worker Execution Profile v1

## 目标

为 Codex / Gemini worker 定义 provider-neutral 的任务执行边界。执行策略由 worker 操作者在启动环境中选择，dispatcher task payload 和模型输出都不能覆盖它。

当前支持两种 profile：

- `trusted-host`：默认值，沿用宿主机执行语义。
- `isolated-container`：在固定的本地容器镜像中执行 provider CLI 和全部 verification command。

## 配置

```bash
export FORGEFLOW_EXECUTION_PROFILE=isolated-container
export FORGEFLOW_EXECUTION_CONTAINER_IMAGE=forgeflow-worker:2026-07-26
export FORGEFLOW_EXECUTION_NETWORK=bridge
export FORGEFLOW_EXECUTION_CPUS=2
export FORGEFLOW_EXECUTION_MEMORY=4g
export FORGEFLOW_EXECUTION_PIDS_LIMIT=256
forgeflow-codex-beta start worker
```

可用环境变量：

- `FORGEFLOW_EXECUTION_PROFILE`：`trusted-host` 或 `isolated-container`。
- `FORGEFLOW_EXECUTION_CONTAINER_RUNTIME`：默认 `docker`。
- `FORGEFLOW_EXECUTION_CONTAINER_IMAGE`：isolated profile 必填，必须已经存在于本机。
- `FORGEFLOW_EXECUTION_NETWORK`：`bridge` 或 `none`，默认 `bridge`。
- `FORGEFLOW_EXECUTION_CPUS`：默认 `2`。
- `FORGEFLOW_EXECUTION_MEMORY`：默认 `4g`。
- `FORGEFLOW_EXECUTION_PIDS_LIMIT`：默认 `256`。
- `FORGEFLOW_EXECUTION_CONTAINER_USER`：数字形式 `uid:gid`，默认使用 worker 进程的 uid / gid。

这些变量始终穿过 assignment 子进程 allowlist。旧的 `FORGEFLOW_WORKER_ENV_ALLOWLIST` 自定义值不能删除 execution policy，避免 daemon 已按 isolated profile 启动、assignment 却静默退回宿主机。

## `isolated-container` 语义

worker 启动和每次非 dry-run assignment 都会先检查：

1. 容器 runtime 可连接。
2. 指定镜像在本机可 inspect。

检查失败时任务 fail closed，不自动 pull 镜像，也不回退到 `trusted-host`。

provider 和 verification 使用同一个 profile：

- 容器 root filesystem 只读。
- 丢弃全部 Linux capabilities，并启用 `no-new-privileges`。
- worktree 以可写方式挂载到 `/workspace`。
- worktree 的 Git metadata 以只读叠加挂载，relative / absolute gitdir 都映射到容器可解析的目标，供 provider 读取 status / diff。
- `/home/forgeflow` 与 `/tmp` 使用有大小上限的 tmpfs。
- 不挂载 Docker socket。
- 只向 Codex 容器暴露 `OPENAI_API_KEY`，只向 Gemini 容器暴露 `GEMINI_API_KEY`；secret 值不进入命令参数。
- verification 容器不接收 provider key。
- CPU、memory 和 PID 使用显式上限。

固定镜像必须包含：

- provider CLI（`codex` 或 `gemini`）；
- `/bin/sh`；
- 任务 verification 所需的语言运行时、包管理器和工具链；
- 与任务仓库兼容的 Git 客户端。

`FORGEFLOW_CODEX_BIN` / `FORGEFLOW_GEMINI_BIN` 在 isolated profile 中解释为镜像内路径，不探测宿主机可执行文件。

## Policy identity

isolated worker 启动参数携带由非敏感 profile 字段计算的 SHA-256 policy id。托管进程复用和子进程启动都会重新核对该值；策略变化后必须重启 worker，不能继续复用旧进程。

policy id 不包含 API key，也不替代镜像 digest。生产环境应使用 immutable digest 或受控的唯一 tag 固定镜像。

## 安全边界

- 这是标准容器隔离，不是 microVM 或不受信任多租户沙箱。
- `bridge` 允许容器使用 Docker 默认网络，不等于域名或 IP allowlist。
- `none` 会完全禁用容器网络，也会让需要访问 provider API 的 Codex / Gemini 执行失败。
- 容器 runtime、镜像内容和宿主机内核仍属于 trusted computing base。
- Git metadata 只读意味着 provider 可检查仓库，但提交、push 和 PR 仍由容器外的 shared live executor 负责。
- task payload、assignment 文件和 provider 输出都没有选择或放宽 execution profile 的入口。
- `trusted-host` 同样按 provider 过滤 key，verification command 不继承 `OPENAI_API_KEY` 或 `GEMINI_API_KEY`。

需要更强的出站域名控制、microVM 或跨租户隔离时，应在容器外增加独立网络代理或专用 sandbox runtime，不应把 Docker `bridge` 描述成等价能力。

## 验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/codex-beta-runtime test
pnpm --filter @tingrudeng/gemini-beta-runtime test
```

参考实现边界：

- [OpenHands Docker sandbox](https://docs.openhands.dev/openhands/usage/sandboxes/docker)
- [SWE-agent environment configuration](https://swe-agent.com/latest/config/environments/)
- [GitHub dev container configuration](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers)
- [Docker Agent Sandbox FAQ](https://docs.docker.com/ai/sandboxes/faq/)

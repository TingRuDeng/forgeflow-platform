# 业务仓接入指南

这份文档只负责说明如何把业务仓接入 forgeflow-platform。仓库规则看 `../AGENTS.md`，文档导航看 `README.md`，当前主线能力与 Trae 路径定位看 `../README.md`，协议细节看 `contracts/*`。

## 1. 接入目标

当前 v1 的接入目标是：

- 业务仓能产出 `.orchestrator` 调度产物
- worker 能在 assignment package 边界内执行
- 结果能回写到 dispatcher 或本地状态产物
- 需要多机时，能接入 `dispatcher server` + worker runtime

## 2. 接入前提

业务仓至少满足：

- 已开启 GitHub Actions
- 已准备 self-hosted runner
- 仓库根目录可放入 `.orchestrator/project.yaml`
- `main` 作为默认分支

## 3. 最小接入步骤

### 3.1 放入项目契约

在业务仓放入：

- `.orchestrator/project.yaml`
- `AGENTS.md`
- `GEMINI.md`

可直接复用模板：

- `../templates/project.yaml`
- `../templates/AGENTS.md`
- `../templates/GEMINI.md`

### 3.2 调整业务仓参数

至少改这些字段：

- `project.key`
- `project.repo`
- `routing.codex`
- `routing.gemini`
- `commands.lint`
- `commands.test`
- `commands.build`（如果有）

### 3.3 放入 workflow 模板

复制到业务仓：

- `.github/workflows/ai-dispatch.yml`
- `.github/workflows/ai-ci.yml`
- `.github/workflows/ai-verify-merge.yml`

并根据业务仓技术栈调整：

- `LINT_COMMAND`
- `TEST_COMMAND`
- `BUILD_COMMAND`
- `runs-on`

### 3.4 配 GitHub 仓库

至少完成：

1. 开启 Actions
2. 启动 self-hosted runner
3. 给 `main` 加 branch rule
4. 配 `OPENAI_API_KEY` 和 `GEMINI_API_KEY`

### 3.5 跑第一次 smoke

推荐顺序：

1. 手工触发 `ai-dispatch`
2. 确认 workflow 能读取 `.orchestrator/project.yaml`
3. 下载 `dispatch-plan` artifact
4. 用 `run-dispatch-assignments.js` 跑本地最小执行闭环
5. 提一个测试 PR
6. 看 `ai-ci` 是否跑通
7. 看 `ai-verify-merge` 是否跑通

完整检查项见 `e2e-smoke-checklist.md`。

如果接入流程、主链路定位或运行方式发生变化，收尾时还要检查 `DOC_SYNC_CHECKLIST.md`，同步更新受影响的入口文档。

## 4. 运行时接入模式

在当前主线路径里，推荐把“控制层启动”、“control-layer skill 安装”和“远程 Trae npm 包安装”分开看：

当前迭代策略：Trae-first。优先收敛 Trae 无人值守链路稳定性，`codex/gemini` 多机链路能力扩展暂缓投入（deferred）。

- 控制平面机器：从 `scripts/start-control-plane.sh` 启动常驻 dispatcher 控制面
- 控制层会话：按需安装 `worker-review-orchestrator` skill
- 控制层机器：按需安装 `@tingrudeng/worker-review-orchestrator-cli`
- 远程 Trae 机器：按需安装 `@tingrudeng/trae-beta-runtime`

### 4.1 本地最小闭环

适合先验证 assignment package 与结果回写：

- 触发 `ai-dispatch`
- 生成 `.orchestrator`
- 用 `scripts/run-dispatch-assignments.js` 顺序执行 `assigned` 任务

### 4.2 `codex` / `gemini` 多机链路（deferred）

该链路当前仍可用，但在本阶段不作为优先推进范围：

1. 启动 `dispatcher server`
2. 把 `.orchestrator` 发布到 dispatcher
3. 在各机器上启动 `run-worker-daemon.js`

当前不建议把它当作新的接入起点；控制中枢优先只启动 dispatcher，让 Trae runtime 先稳定收口。

#### Dispatcher HTTP 认证（可选）

如果需要给 dispatcher HTTP 面加一层 token 认证，可在启动 dispatcher 前设置：

```bash
export DISPATCHER_API_TOKEN="your-secret-token"
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

启用后行为：

- `/health` 仍可匿名访问
- 其他 endpoint 需要 `Authorization: Bearer <token>`
- 缺失或错误 token 返回 `401` + `{ "error": "unauthorized" }`

调用方连通性检查示例：

```bash
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/dashboard/snapshot
```

控制平面最小启动示例：

```bash
cd /abs/path/to/forgeflow-platform
./scripts/start-control-plane.sh
```

如果需要绕过一键入口，也可以直接起 dispatcher：

```bash
node /abs/path/to/forgeflow-platform/scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

如果控制层需要标准 review/dispatch skill，可安装：

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill worker-review-orchestrator -g -y
npm install -g @tingrudeng/worker-review-orchestrator-cli
```

### 4.3 Trae 首选无人值守链路

如果目标是让 Trae 在 dispatcher 驱动下长期无人值守执行，当前推荐路径是 npm 运行时：

```bash
npm install -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init
forgeflow-trae-beta doctor
forgeflow-trae-beta start all
```

补充：`forgeflow-trae-beta start all` / `restart all` 会在返回成功前依次等待：

- Trae remote debugging endpoint（`/json/version`）可用
- automation gateway `/ready` 可用
- dispatcher `/health` 可用

这条链路已经覆盖：

1. `register`
2. `fetch_task`
3. `start_task`
4. 基于最新抓取的默认分支物化每任务独立 worktree
5. 通过 automation gateway 驱动 Trae
6. 解析最终回复模板
7. `submit_result`

当前边界：

- 单任务串行
- 非流式最终回复
- 只有最小 backoff / 错误恢复
- 还没有自动清理旧 worktree 的完整生命周期治理
- 没有多实例协调
- `blocked + rework -> continuation` 已进入主线协议，并完成远程 Trae smoke 验证；当前 continuation 链路依赖更新后的 packaged runtime。
- 一个最小的远程机器运行时包已进入 beta 安装路径，位于 `packages/trae-beta-runtime/`；当前 npm 包版本为 `@tingrudeng/trae-beta-runtime@0.1.0-beta.38`，用于包装启动与直接包自更新命令。

补充：

- `start gateway` 默认启用 session store，并将会话状态落在 `.forgeflow-trae-gateway/sessions.json`。
- Trae worker 的软超时恢复依赖这份会话状态；如需改目录，可在 gateway 启动时传 `--state-dir /abs/path/to/state-dir`。
- `forgeflow-trae-beta doctor` 会输出 dispatcher/gateway/CDP 连通性检查（标记为 optional），用于快速排查部署连通性问题。

脚本方式仅用于在 forgeflow-platform 仓库内做开发或调试：

```bash
node scripts/run-trae-automation-launch.js \
  --trae-bin /Applications/Trae.app \
  --project-path /abs/path/to/repo \
  --remote-debugging-port 9222

node scripts/run-trae-automation-gateway.js \
  --host 127.0.0.1 \
  --port 8790

node scripts/run-trae-automation-worker.js \
  --repo-dir /abs/path/to/repo \
  --dispatcher-url http://127.0.0.1:8787 \
  --automation-url http://127.0.0.1:8790 \
  --worker-id trae-auto-gateway
```

如果远程机器不方便直接使用全局 npm，才回退到本仓库脚本链路；正常情况下优先 npm 命令：

```bash
npm install -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init
forgeflow-trae-beta doctor
forgeflow-trae-beta start all
```

`forgeflow-trae-beta update` 会直接对已安装包执行自更新，不是推荐式卸载重装流程。

**Git SSH Override:**

If port 22 is blocked, set `FORGEFLOW_GIT_SSH_COMMAND` (or `TRAE_GIT_SSH_COMMAND` as fallback) before starting the worker. See `../README.md` → Git SSH Override for details.

试运行与问题记录建议：

- 远程 Trae beta 试运行顺序见 `runbooks/trae-remote-beta.md`
- 每轮试运行后的记录模板见 `runbooks/trae-issue-template.md`
- 在故障模式收敛前，优先用 `docs/**`、小脚本、小配置改动验证
- 当前可以谨慎放开“单功能闭环”的小范围业务代码修改，但必须明确 `allowedPaths`、明确 `acceptance`，且不要把重构打包进去
- 不要过早放开高风险任务

### 4.4 Trae MCP deprecated/fallback 路径

`scripts/run-trae-mcp-worker-server.js` 仍可用于交互式 Trae Agent 或兼容性场景，但不再是仓库推荐的 unattended 主线。

只在这些场景继续使用：

- 需要人工值守的 Trae 交互式执行
- 维护现有 MCP 集成
- 验证 MCP 协议兼容性

如果需求是远程、无人值守、dispatcher 驱动执行，优先改 automation gateway + automation worker，不要继续把 MCP 当未来主线。

## 5. 常见调整项

前端不在 `apps/web`：

```yaml
routing:
  gemini:
    - frontend/**
```

后端不在 `apps/api`：

```yaml
routing:
  codex:
    - server/**
    - scripts/**
```

仓库不是 `pnpm`：

- 把 workflow 模板里的命令换成实际命令
- 例如 `npm ci && npm test`
- 例如 `go test ./...`
- 例如 `pytest`

## 6. 当前不是前置条件的事项

- GitHub App
- 每个 worker 一个 GitHub 账号
- fork 模式
- 多仓统一权限治理
- OpenClaw / ACP 会话控制

## 7. 相关契约与参考

- `contracts/worker-prompt-layering-v1.md`
  - assignment payload、worker prompt、context 的职责边界
- `contracts/review-memory-v1.md`
  - review memory 的存储与注入边界
- `contracts/trae-automation-gateway-v1.md`
  - Trae 无人值守控制层契约
- `contracts/trae-worker-v1.md`
  - Trae MCP fallback 契约

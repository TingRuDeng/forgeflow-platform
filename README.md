# forgeflow-platform

forgeflow-platform 是多智能体协作开发的控制平面仓库。当前主线以 `dispatcher` 为任务、分配、状态流转与审计记录的真相源；`codex-control` 等控制层负责编排；`codex`、`gemini`、`Trae` 都只是 worker 接入方式。当前迭代优先级为 **Trae-first**：先收敛 Trae 无人值守链路稳定性，再扩展 `codex/gemini` worker 主线能力。

## 当前主线

当前仓库已落到主线能力，而不是早期的 Trae MCP-only 阶段：

- Phase 1 运行时合并到 TypeScript 已完成：`worker-daemon`、`review-decision`、`dispatcher-state`、`dispatcher-server` 主链现在都通过 `scripts/*.js` 入口桥接到 `apps/dispatcher/dist` 下的 TypeScript foundation。
- Phase 2 持久化切换主线已完成：dispatcher 默认真相源现在是 `.forgeflow-dispatcher/runtime-state.db`，基于 `node:sqlite` 落盘；只有显式传 `--persistence-backend json`（或设置 `RUNTIME_STATE_BACKEND=json`）时才回退到 JSON。
- `scripts/*.js` 仍然是当前 live 入口与本地启动方式；它们现在主要承担 CLI、bootstrap、薄适配层与剩余脚本 glue，而不再单独承载整条 dispatcher 主链实现。
- `dispatcher server` + `worker daemon` 的 `codex` / `gemini` 链路仍可用，但当前迭代按 Trae-first 策略暂缓投入（deferred）。
- `.orchestrator` assignment package、本地执行脚本、结果回写与 review 决策链路仍然可用。
- review memory 已有文件存储契约，并会在 dispatcher 创建 dispatch 时按 repo/scope/worker 条件注入上下文。
- Trae 的首选无人值守路径是 `Trae automation gateway` + `Trae automation worker`。
- `worker daemon` 与 `Trae automation worker` 现在都会先基于最新抓取的默认分支物化每任务独立 worktree，避免跨任务串味。
- Trae MCP worker 仍保留，但现在只应视为交互式、人工值守或兼容性 fallback，不是首选未来路径。
- 远程 Trae 任务执行已经通过 dispatcher 驱动的主链路验证；当前限制主要在串行度、流式输出与多实例协调，而不是“能否接入 dispatcher”。
- `blocked + rework -> continuation` 已通过远程 Trae 真机联调验证：dispatcher 能生成 continuation 任务，Trae worker 会消费 `continuationMode=continue`、`continueFromTaskId` 和注入后的 `Rework Notes`。
- 一个最小的远程机器运行时包已在 `packages/trae-beta-runtime/` 下进入 beta 安装路径，用来提供 launch/gateway/worker/update 命令；当前 npm 包版本是 `@tingrudeng/trae-beta-runtime@0.1.0-beta.37`，`update` 会直接自更新已安装包，不是推荐式卸载重装流程。

## 文档入口

- `AGENTS.md`：唯一规则入口。
- `docs/README.md`：唯一文档导航入口。
- `docs/DOC_SYNC_CHECKLIST.md`：代码任务收尾时的文档同步门禁。
- `docs/ARCHITECTURE.md` / `docs/API_ENDPOINTS.md` / `docs/DATABASE_SCHEMA.md`：当前主线路径的稳定知识层概览。
- `docs/onboarding.md`：业务仓接入手册。
- `docs/contracts/*`：精确协议与能力边界，不负责仓库导航。
- `docs/research/*`：研究或探索材料，默认非权威。

## 关键入口

- 总控与 dispatch：`scripts/run-codex-control-flow.js`
- dispatcher server：`scripts/run-dispatcher-server.js`
- `.orchestrator` 发布：`scripts/dispatch-orchestrator-to-server.js`
- 多机 worker daemon（`codex/gemini`，deferred）：`scripts/run-worker-daemon.js`
- Trae automation gateway：`scripts/run-trae-automation-gateway.js`
- Trae automation worker：`scripts/run-trae-automation-worker.js`
- Trae MCP fallback：`scripts/run-trae-mcp-worker-server.js`
- 审查决策：`scripts/submit-review-decision.js`
- 包发布助手：`scripts/release-package.js`

## 当前使用方式

### 1. 中控启动

当前推荐从控制层入口启动，由 `codex-control` 负责请求理解、planner 结果输入、dispatch 与发布：

```bash
node scripts/run-codex-control-flow.js \
  --repo TingRuDeng/your-business-repo \
  --ref main \
  --repo-dir /abs/path/to/business-repo \
  --request-summary "补充接入文档并增加 API 冒烟测试" \
  --task-type feature \
  --planner-provider manual \
  --planner-json-file /tmp/planner-output.json \
  --dispatcher-url http://127.0.0.1:8787
```

常用补充：

- 只看将要执行的步骤时，加 `--dry-run`
- 如果不发布到 dispatcher，可省略 `--dispatcher-url`
- 参数语义见 `node scripts/run-codex-control-flow.js --help`

更完整的控制层用法见 `docs/codex-control-usage.md`。

### 2. 安装控制层 skill

当前仓库对外提供的 control-layer skill 是 `worker-review-orchestrator`。它和控制层 CLI 是分开安装的两步路径：

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill worker-review-orchestrator -g -y
npm install -g @tingrudeng/worker-review-orchestrator-cli
```

其中：

- `worker-review-orchestrator` skill 负责控制层工作流和审查约束
- `@tingrudeng/worker-review-orchestrator-cli` 提供 `forgeflow-review-orchestrator` 可执行命令

这个 skill 适合控制层做任务派发、review 检查和 merge/block 决策（默认 PR-first：审查通过后先开 PR 合入，再做 `decision merge`），不适合直接替代 worker 写业务代码。

### 3. 安装公开 npm 包

当前公开发布的 npm 包是远程 Trae 运行时 `@tingrudeng/trae-beta-runtime`：

```bash
npm install -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init
forgeflow-trae-beta doctor
forgeflow-trae-beta start launch
forgeflow-trae-beta start gateway
forgeflow-trae-beta start worker
```

补充：`forgeflow-trae-beta start all` / `restart all` 现在会在返回成功前依次等待：

- Trae remote debugging endpoint（`/json/version`）可用
- automation gateway `/ready` 可用
- dispatcher `/health` 可用

它适合远程机器上的 Trae 无人值守执行，不替代控制平面仓库本身。

如果本机还没有安装控制层 CLI，可在 forgeflow-platform 仓库内临时用 `node packages/worker-review-orchestrator-cli/dist/cli.js ...` 作为 fallback，但不应把仓库内 `dist` 当成默认长期入口。

### 4. 发布 npm 包

使用包发布助手发布 forgeflow-platform npm 包：

```bash
# 预览发布（默认 dry-run，不会修改文件）
node scripts/release-package.js --package trae-beta-runtime --bump prerelease

# 实际发布
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --publish
```

该助手默认为 dry-run 模式，只有显式传入 `--publish` 才会真正修改 `package.json` 并发布到 npm。发布命令自动带上 `--no-git-checks` 以避免 git 状态冲突。

如需安装发包助手 skill：

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill package-release -g -y
```

详细用法见 `skills/package-release/SKILL.md`。

### 5. 直接脚本启动

启动 dispatcher：

```bash
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

如需启用认证保护，设置环境变量 `DISPATCHER_API_TOKEN`：

```bash
export DISPATCHER_API_TOKEN="your-secret-token"
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

认证说明：
- 未配置 `DISPATCHER_API_TOKEN` 时，所有接口无需认证（向后兼容）
- 配置后，除 `/health` 外的所有接口需要 `Authorization: Bearer <token>` 认证
- 认证失败返回 401 状态码和 JSON 错误信息

如需显式回退到 JSON 持久化：

```bash
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher \
  --persistence-backend json
```

启动 `codex` / `gemini` worker daemon（可用但当前 deferred）：

```bash
node scripts/run-worker-daemon.js \
  --dispatcher-url http://127.0.0.1:8787 \
  --worker-id codex-mac-mini \
  --pool codex \
  --repo-dir /abs/path/to/business-repo
```

启动 Trae 无人值守链路（推荐：npm 运行时）：

```bash
npm install -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init
forgeflow-trae-beta doctor
forgeflow-trae-beta start launch
forgeflow-trae-beta start gateway
forgeflow-trae-beta start worker
```

说明：

- `start gateway` 默认启用 session store，并将会话状态落在 `.forgeflow-trae-gateway/sessions.json`。
- Trae worker 的软超时恢复依赖该会话状态；如需修改目录可显式传 `--state-dir /abs/path/to/state-dir`。
- `forgeflow-trae-beta doctor` 现在会额外输出 dispatcher/gateway/CDP 连通性检查（标记为 optional），用于快速定位部署环境问题。

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

如果只是维护旧的交互式 Trae MCP 接入，再启动 fallback server：

```bash
node scripts/run-trae-mcp-worker-server.js \
  --dispatcher-url http://127.0.0.1:8787 \
  --worker-id trae-01
```

## Trae 定位

当前建议明确区分两条路：

- 首选无人值守路径：`Trae automation gateway` + `Trae automation worker`
  - 负责程序化驱动 Trae 客户端
  - 通过 dispatcher 拉任务、`start_task`、解析最终回复并 `submit_result`
  - 适合远程、无人值守、dispatcher 驱动的执行闭环
- deprecated/fallback 路径：`Trae MCP worker`
  - 保留给交互式 Trae Agent 或兼容性场景
  - 仍使用相同 dispatcher 真相源
  - 不是当前仓库推荐投入的首选 unattended 路线

## 当前边界

- Trae automation worker 目前仍是单任务串行 runtime，不支持多任务并发。
- automation gateway 本体只定义 Trae 自动化控制接口；dispatcher 任务循环与结果回写由 automation worker 负责完成。
- 任务 worktree 只保证从最新抓取的默认分支派生；还没有做更激进的旧 worktree 自动清理策略。
- review memory 当前是文件存储 + dispatch 注入主线；lesson 的自动提取与落盘仍需外部调用方编排。
- `docs/plans/*`、`docs/runbooks/*`、`docs/research/*` 可作为背景资料，但不能替代当前主线文档和代码。

## Git SSH Override

Trae runtime workers support overriding the git SSH command via environment variables. This is useful when the default SSH port (22) is blocked by firewall, requiring SSH over HTTPS port (443) instead.

**Environment variables (in priority order):**

1. `FORGEFLOW_GIT_SSH_COMMAND` — preferred
2. `TRAE_GIT_SSH_COMMAND` — backward-compatible fallback

**Example: GitHub over ssh.github.com:443**

```bash
export FORGEFLOW_GIT_SSH_COMMAND="ssh -o Hostname=ssh.github.com -p 443"
```

This tells git to use SSH over port 443 via GitHub's `ssh.github.com` endpoint, which works in environments where port 22 is blocked.

**Important notes:**

- This override applies to git operations performed by Trae runtime workers during task execution.
- If the remote baseline cannot be fetched (e.g., network unreachable, authentication failed), the worker will still hard-fail — this override only changes how SSH connects, not the fetch behavior itself.
- Set the environment variable before starting the worker daemon or automation worker.

## 试运行与问题记录

- 远程 Trae beta 试运行流程见 `docs/runbooks/trae-remote-beta.md`
- 每次试运行后的问题记录模板见 `docs/runbooks/trae-issue-template.md`

当前建议：

- 先从 `docs/**`、小脚本、小配置改动开始
- 当前已可以试运行“单功能闭环”的小范围业务代码修改，但仍要求明确 `allowedPaths`、明确 `acceptance`，且不要夹带重构
- 每次试运行都记录结果，不只记录失败
- 不要在故障模式还未收敛前过早放开高风险大范围任务

## CI

本项目使用 GitHub Actions 作为持续集成门禁。每次推送到 `main` 分支或创建 Pull Request 时，CI 会自动执行：

- `pnpm typecheck`
- `pnpm test`
- `git diff --check`

CI 配置见 `.github/workflows/ci.yml`。

## 验证

```bash
pnpm test
pnpm typecheck
git diff --check
```

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
- `forgeflow-review-orchestrator dispatch-task` 在 `pool=trae` 时会默认按结构化任务规范自动渲染 worker prompt，并把最终 prompt 连同 `workerPromptMode/reportSchemaVersion` 一起持久化到 dispatcher assignment；自定义 Trae prompt 若缺少 `任务完成/结果/任务ID` 会在 dispatch 前被拒绝。
- follow-up / rework 任务只有在源任务已经交付过可验证的远端分支产物、且 worker 不变时才允许复用原分支；否则控制层应改用新的 `-rN` 分支继续修复。
- Trae runtime 的 `new_chat` 采样现在会优先收窄到最后一个可见聊天根节点，并在基线里检测是否仍持续读到上一个任务的完成回执；发现旧 `任务ID` 污染时会提前失败，而不是继续误读旧会话。
- Trae runtime 现在只有在远端分支 HEAD 与最终回执里的 commit SHA 完全一致时才会把成功结果提升为 `review_ready`；遇到远端 ref 传播延迟时，会先进入短暂重试窗口，而不是立刻把产物交给 review。
- dispatcher 的状态型 HTTP 路径现在共用一把跨进程文件锁（`.runtime-state.lock`）；锁竞争超时会显式返回 `503`，陈旧锁会自动回收。
- dispatcher SQLite snapshot 现在按 revision 追加落盘，并保存 `checksum_sha256`；读取默认 fail-closed，只有显式设置 `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1` 时才允许从 JSON 救援导入。
- `dependsOn` 现在进入调度门控：依赖未满足的任务保持 `planned`，依赖满足后由 dispatcher 自动解锁到 `ready` 并写状态事件。
- generic worker claim 已收口为显式副作用路径：`GET /api/workers/:workerId/assigned-task` 现在只读，真正的 claim / assign 走 `POST /api/workers/:workerId/claim-task`。
- review decision 现在明确支持 `merge`、`block`、`rework`、`changes_requested`；其中 `rework` 和 `changes_requested` 都会落到 `blocked` 任务态，但保留原始 decision 用于 redrive 和审计。
- dispatcher 现在会 canonicalize worker result 的 `taskId/workerId/pool/repo/defaultBranch/branchName/mode`，worker 只能上送 `output/verification/evidence` 等执行证据；不合法元数据会被拒绝。
- `worker-daemon` 不再把 `submitResult` 重试耗尽、`git push` 失败或自动 PR 创建失败记成“completed”；这些路径现在都会保留在显式 failed 语义里。
- `worker-daemon` 子进程现在使用 env allowlist，而不是继承完整 `process.env`；自动 PR 创建也改成显式 `FORGEFLOW_WORKER_CREATE_PR=1` 才会启用。
- dashboard snapshot 现在附带最小控制面指标：`queueDepth`、`plannedTasks`、`reviewBacklog`、`avgAssignmentLagMs`、`maxAssignmentLagMs`。
- dispatcher 现在额外暴露只读 `/api/metrics`，便于控制层和告警脚本直接读取阶段二最小指标，而不必解析完整 dashboard snapshot。
- `/api/metrics` 现在还会汇总关键失败信号：`submitResultRetryCount`、`deliveryFailedCount`、`cleanupFailureCount`、`sessionInterruptionCount`、`stateLockTimeoutCount`。
- 脚本侧 pino logger 现在默认对 `Authorization`、`DISPATCHER_API_TOKEN`、`GITHUB_TOKEN` 等敏感字段做 redact，减少 worker / dispatcher 日志泄露风险。
- Trae MCP worker 仍保留，但现在只应视为交互式、人工值守或兼容性 fallback，不是首选未来路径。

## MCP Thin-Wrapper Packages

`packages/mcp-*/` 下的包都是 **thin wrapper**：

- `mcp-scheduler` — 暴露调度任务管理工具，委托给 dispatcher-scheduler 实现
  - 当前已切到 generic pool + per-tool input schema，不再写死 codex/gemini-only 表达
- `mcp-review-gate` — 暴露审查工具（submit_findings、check_merge_readiness、render_markdown_pr）
- `mcp-github` — 暴露 GitHub 工具（create_branch、open_pull_request、get_pull_request_status）
- `mcp-repo-policy` — 暴露仓库策略工具（validate_paths、get_repo_commands）
- `mcp-trae-worker` — **DEPRECATED / FALLBACK**，保留给交互式 Trae Agent 或兼容性场景；推荐路径是 Trae automation gateway + automation worker

所有工具定义和 deps 注入都在各自 `src/server.ts`；实际业务逻辑在 dispatcher 层。

## 当前使用方式
- 远程 Trae 任务执行已经通过 dispatcher 驱动的主链路验证；当前限制主要在串行度、流式输出与多实例协调，而不是“能否接入 dispatcher”。
- `blocked + rework -> continuation` 已通过远程 Trae 真机联调验证：dispatcher 能生成 continuation 任务，Trae worker 会消费 `continuationMode=continue`、`continueFromTaskId` 和注入后的 `Rework Notes`。
- 一个最小的远程机器运行时包已在 `packages/trae-beta-runtime/` 下进入 beta 安装路径，用来提供 launch/gateway/worker/update 命令；当前 npm 包版本是 `@tingrudeng/trae-beta-runtime@0.1.0-beta.42`，`update` 会直接自更新已安装包，不是推荐式卸载重装流程。

## 文档入口

- `AGENTS.md`：唯一规则入口。
- `docs/README.md`：唯一文档导航入口。
- `docs/DOC_SYNC_CHECKLIST.md`：代码任务收尾时的文档同步门禁。
- `docs/ARCHITECTURE.md` / `docs/API_ENDPOINTS.md` / `docs/DATABASE_SCHEMA.md`：当前主线路径的稳定知识层概览。
- `docs/STATE_MACHINE.md`：阶段二状态机规则、claim/review/continuation/worker-result canonicalization 摘要。
- `docs/onboarding.md`：业务仓接入手册。
- `docs/runbooks/single-machine-deployment.md`：阶段一单机控制面部署与恢复入口。
- `docs/runbooks/observability-and-alerting.md`：阶段二 metrics / runtime events / alert 说明入口。
- `docs/contracts/*`：精确协议与能力边界，不负责仓库导航。
- `docs/research/*`：研究或探索材料，默认非权威。

## 关键入口

- 控制中枢常驻入口：`scripts/start-control-plane.sh`
- dispatcher server：`scripts/run-dispatcher-server.js`
- `.orchestrator` 发布：`scripts/dispatch-orchestrator-to-server.js`
- 多机 worker daemon（`codex/gemini`，deferred）：`scripts/run-worker-daemon.js`
- Trae automation gateway：`scripts/run-trae-automation-gateway.js`
- Trae automation worker：`scripts/run-trae-automation-worker.js`
- Trae MCP fallback：`scripts/run-trae-mcp-worker-server.js`
- 审查决策：`scripts/submit-review-decision.js`
- 包发布助手：`scripts/release-package.js`

## 当前使用方式

### 1. 控制中枢启动

当前推荐把控制中枢收敛成 Trae-first 的常驻控制面，只启动 dispatcher：

```bash
pnpm install
./scripts/start-control-plane.sh
```

前置条件：

- 这是源码仓库启动路径，不是独立二进制发布物。
- 首次启动前需要先在仓库根目录执行 `pnpm install`，确保 `typescript` 等 workspace 依赖已安装。
- `start-control-plane.sh` 启动过程中会触发 `apps/dispatcher` 的本地 build；如果缺少依赖，常见报错是 `sh: tsc: command not found`。

该脚本会：

- 基于脚本位置自动推导仓库根目录
- 创建 `.forgeflow-dispatcher`
- 启动 `scripts/run-dispatcher-server.js`
- 输出当前 dispatcher 地址和 Trae 侧下一步命令提示

如需覆盖默认值，可设置：

- `FORGEFLOW_ROOT_DIR`
- `FORGEFLOW_STATE_DIR`
- `FORGEFLOW_DISPATCHER_HOST`
- `FORGEFLOW_DISPATCHER_PORT`

如果只想直接调用底层入口，也可以继续使用：

```bash
pnpm install
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

说明：

- 当前先放弃 `codex/gemini` 主线支持，`run-codex-control-flow.js` 与 `run-worker-daemon.js` 不再属于推荐启动路径。
- 控制平面启动后，当前推荐由远程 Trae 运行时机器执行 `forgeflow-trae-beta start all` 接入。

### 2. 安装控制层 skill

当前仓库对外提供的 control-layer skill 是 `worker-review-orchestrator`。它和控制层 CLI 是分开安装的两步路径：

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill worker-review-orchestrator -g -y
npm install -g @tingrudeng/worker-review-orchestrator-cli
```

其中：

- `worker-review-orchestrator` skill 负责控制层工作流和审查约束
- `@tingrudeng/worker-review-orchestrator-cli` 提供 `forgeflow-review-orchestrator` 可执行命令
- `dispatch-task --pool trae` 默认会根据结构化参数自动生成 Trae worker prompt，不需要再手写完整回执模板；只有在确实需要覆盖时才传 `--worker-prompt` / `--worker-prompt-file`
- 自动 draft PR 现在有硬门禁：只有当验收命令通过、push 成功且无 `push_error`、远端分支 HEAD 与最终 commit SHA 一致、且变更仍在允许范围内时，worker 才允许开 draft PR；worker 仍不得自行 merge

这个 skill 适合控制层做任务派发、review 检查和 merge/block 决策（默认 PR-first：审查通过后先开 PR 合入，再做 `decision merge`），不适合直接替代 worker 写业务代码。

### 3. 安装公开 npm 包

当前公开发布的 npm 包是远程 Trae 运行时 `@tingrudeng/trae-beta-runtime`：

```bash
npm install -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init \
  --project-path /abs/path/to/your-business-repo \
  --dispatcher-url http://<control-plane-host>:8787 \
  --worker-id trae-remote-01
forgeflow-trae-beta doctor
forgeflow-trae-beta start all
```

如果 Trae 安装路径不是默认值，再补 `--trae-bin "/Applications/Trae.app"`。

如果机器默认走镜像源（例如 `https://registry.npmmirror.com`），而新发布的共享依赖还没有完成镜像同步，安装或升级可能报依赖 404。此时请显式改用官方 npm registry：

```bash
npm install -g @tingrudeng/trae-beta-runtime@0.1.0-beta.42 --registry=https://registry.npmjs.org/
```

升级后可确认：

```bash
forgeflow-trae-beta version
npm ls -g --depth=0 @tingrudeng/trae-beta-runtime
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

# GitHub Actions 中实际发布
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --tag beta --publish --ci
```

如果这次 runtime 变更同时修改了共享报告解析库，还需要先发布 `@tingrudeng/automation-gateway-core`：

```bash
node scripts/release-package.js --package automation-gateway-core --bump prerelease --tag beta --publish --ci
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --tag beta --publish --ci
```

该助手默认为 dry-run 模式，只有显式传入 `--publish` 才会真正修改 `package.json` 并发布到 npm。`--publish` 现在是 CI-only 门禁，本地直接执行会失败；推荐入口是 `.github/workflows/release.yml`，由 GitHub Actions 用 OIDC + provenance 执行发布，并在发布后跑 Scorecard。

自动发布还有两条硬门禁：

- 只有 `.github/workflows/release.yml` 这一条正式发布链路，`packages/*/package.json` 变更不会再触发重复 workflow 并发发包。
- 只有当 npm 已把当前仓库 `TingRuDeng/forgeflow-platform` 配置成 `@tingrudeng/*` 包的 Trusted Publisher，且仓库或组织变量 `NPM_TRUSTED_PUBLISHING_ENABLED=true` 时，push 自动发包才会真正执行；否则 workflow 会成功结束并明确写出“已跳过自动发布”。
- release job 会先把 npm CLI 升到 `11.12.1`；npm Trusted Publishing 至少要求 `npm 11.5.1+`，不要再用 Node 自带的 npm 10.x 直接判断发布链是否可用。

当前还要注意一个外部前置条件：

- 仓库内阶段一发布链已经切到 CI-only + OIDC + provenance + Scorecard，但 npm 侧 Trusted Publisher 绑定仍需要与当前 GitHub 仓库身份对齐后，自动正式发版才会真正恢复。

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

如需启用认证保护，设置环境变量 `DISPATCHER_AUTH_MODE` 和 `DISPATCHER_API_TOKEN`：

```bash
# 默认 token 模式（推荐生产环境）
export DISPATCHER_API_TOKEN="your-secret-token"
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

认证模式说明（通过 `DISPATCHER_AUTH_MODE` 控制）：
- `token`（默认）：强制认证模式，必须设置 `DISPATCHER_API_TOKEN`，除 `/health` 外所有接口需要认证
- `legacy`：兼容模式，当 `DISPATCHER_API_TOKEN` 未设置时，只允许 loopback 地址（127.0.0.1、::1）访问；设置后需认证
- `open`：完全开放模式，所有接口可匿名访问，适合本地开发

dispatcher 状态锁说明：
- 所有基于状态目录的 dispatcher 路径当前共用 `.runtime-state.lock`
- `DISPATCHER_STATE_LOCK_TIMEOUT_MS` 控制获取锁的总超时时间，默认 `2000`
- `DISPATCHER_STATE_LOCK_RETRY_MS` 控制重试间隔，默认 `25`
- `DISPATCHER_STATE_LOCK_STALE_MS` 控制陈旧锁回收阈值，默认 `30000`
- 锁竞争超时返回 `503`，调用方应重试而不是把它当作鉴权或参数错误

如需显式回退到 JSON 持久化：

```bash
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher \
  --persistence-backend json
```

启动 `codex` / `gemini` worker daemon（可用但当前 deferred，不属于推荐启动路径）：

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
forgeflow-trae-beta init \
  --project-path /abs/path/to/your-business-repo \
  --dispatcher-url http://<control-plane-host>:8787 \
  --worker-id trae-remote-01
forgeflow-trae-beta doctor
forgeflow-trae-beta start all
```

如果 Trae 安装路径不是默认值，再补 `--trae-bin "/Applications/Trae.app"`。

说明：

- `start all` 会按 `launch -> gateway -> worker` 顺序启动，并等待关键就绪检查通过后再返回。
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
- 任务 worktree 只保证从最新抓取的默认分支派生；允许复用时会先 `reset --hard` + `clean -fd`，但自动删除旧 worktree 仍不是默认行为。
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

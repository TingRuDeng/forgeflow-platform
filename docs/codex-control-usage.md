# Codex Control 使用说明

这份文档说明如何把 Codex 当成 forgeflow-platform 的总调度来使用。

## 1. 目标

你不是让 Codex 直接写全部业务代码，而是让它先充当：

- planner
- dispatcher
- integrator

也就是：

- 先理解需求
- 先拆任务
- 先决定任务给谁
- 最后再交给 workflow 和 worker 去执行

## 2. 最推荐的使用方式

当前推荐先把控制层入口、skill 和远程 runtime 入口分清：

- 中控入口：`node scripts/run-codex-control-flow.js`
- 控制层 skill：`worker-review-orchestrator`
- 控制层 CLI：`@tingrudeng/worker-review-orchestrator-cli`
- 远程 Trae npm 包：`@tingrudeng/trae-beta-runtime`

### 最小中控启动命令

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

如果只是预演步骤，不真正发送，可加 `--dry-run`。

### 运行时复用原则

如果当前已经有 live dispatcher 和在线 worker，控制层默认应复用现有运行时，而不是再启动一套新的中控或 worker。

最小检查方式：

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot | jq '{workers: [.workers[] | {id, pool, status, repoDir}]}'
```

然后：

- 优先使用已有 `--dispatcher-url`
- 优先选择 snapshot 里已经在线的目标 worker
- 需要精确落到某一台 worker 时，显式传 `--target-worker-id`
- 需要强制复用现有运行时时，额外传 `--require-existing-worker`
- 如果现有 dispatcher 在线但没有合适 worker，先报告 blocked 或询问是否要做 runtime bootstrap

推荐组合：

```bash
forgeflow-review-orchestrator dispatch-task \
  --dispatcher-url http://127.0.0.1:8787 \
  --repo TingRuDeng/forgeflow-platform \
  --default-branch main \
  --task-id task-1 \
  --title "Update docs" \
  --pool trae \
  --branch-name ai/trae/task-1 \
  --target-worker-id trae-local-forgeflow \
  --require-existing-worker
```

如果是已有任务的 rework / continuation，不要再用 `dispatch-task` 新建任务，而是改用：

```bash
forgeflow-review-orchestrator continue-task \
  --dispatcher-url http://127.0.0.1:8787 \
  --task-id dispatch-1:task-1
```

这里的 `--default-branch` 和 `--branch-name` 不是让控制层自己先切分支，而是告诉 worker runtime：

- 先基于最新抓取的 `origin/<defaultBranch>` 准备任务工作区
- 再进入该任务对应的 `branchName`
- 在每任务独立 worktree 中执行，而不是直接改控制层当前 checkout

所以正常 dispatch 时，不需要再在任务提示里重复要求 worker “先 pull main / 新建 branch / 新建 worktree”，除非你要调试的正是 workspace materialization 本身。

如果你准备并行派发两个或更多独立任务，而且当前 snapshot 里已经有多台空闲 worker，不要只写同一个 `--pool` 连发多次。更稳妥的做法是先从 snapshot 里挑不同的在线 worker，然后分别传不同的 `--target-worker-id`：

```bash
curl -s http://127.0.0.1:8787/api/dashboard/snapshot | jq '{workers: [.workers[] | select(.pool=="trae" and (.status=="idle" or .status=="busy")) | {id, status}]}'

forgeflow-review-orchestrator dispatch-task ... --target-worker-id trae-local-forgeflow --require-existing-worker
forgeflow-review-orchestrator dispatch-task ... --target-worker-id trae-remote-forgeflow --require-existing-worker
```

否则控制层只是把任务都交给同一个 pool，不能保证 dispatcher 一定替你自动均匀分散到不同 worker。

除非用户明确要求拉起新运行时，否则不要在普通 dispatch / review 任务里顺手执行：

- `node scripts/run-dispatcher-server.js`
- `node scripts/run-worker-daemon.js`
- `node scripts/run-trae-automation-gateway.js`
- `node scripts/run-trae-automation-worker.js`

### 方式 A：Codex 先产出 planner JSON，再触发 workflow

这是默认推荐方式。

流程是：

1. 你把需求给 Codex
2. Codex 读取：
   - `.orchestrator/project.yaml`
   - `AGENTS.md`
   - `GEMINI.md`
   - `prompts/codex-control.md`
3. Codex 输出：
   - 需求理解
   - 任务拆分
   - `planner_output_json`
4. 再触发 `ai-dispatch`
   - `planner_provider=manual`
   - `planner_output_json=Codex 刚才输出的 JSON`

这是最稳的，因为：

- 你能先审一遍 Codex 的分工
- workflow 不需要再让模型重新思考一次
- 结果最可控

### 方式 B：workflow 自动调用 Codex 当 planner

流程是：

1. 你手工触发 `ai-dispatch`
2. 设置：
   - `planner_provider=codex`
   - `planner_output_json` 留空
3. workflow 会：
   - 先生成 `planner-prompt.md`
   - 调用 `codex`
   - 从模型输出里抽 JSON
   - 再继续 dispatch

这适合你想快速跑通链路时使用，但可控性比方式 A 低一点。

## 3. 给 Codex 的推荐指令

你可以直接对 Codex 这样说：

```text
你现在是 codex-control，不是普通 coder。
先读取当前业务仓的 .orchestrator/project.yaml、AGENTS.md、GEMINI.md，
再根据 prompts/codex-control.md 的规则工作。

我会给你一个需求。
你先输出：
1. 需求理解
2. 任务拆分理由
3. planner_output_json

不要直接写业务代码，除非我明确要求你亲自实现。
```

然后再补你的业务需求。

## 4. 什么时候用 manual，什么时候用 codex

### 用 `planner_provider=manual`

适合：

- 你已经让 Codex 在会话里想清楚了
- 你想先看一遍 JSON 再 dispatch
- 你要最高可控性

### 用 `planner_provider=codex`

适合：

- 你想让 GitHub workflow 直接自动产出 planner
- 你先跑自动化 smoke test
- 你不想先在会话里人工确认 planner JSON

## 5. 当前最合理的默认流程

当前推荐默认流程是：

1. 你和 Codex 交互
2. Codex 先思考并输出 `planner_output_json`
3. 你确认
4. 系统用 `planner_provider=manual` 触发 `ai-dispatch`
5. workflow 生成：
   - `dispatch-plan.json`
   - `task-ledger.json`
   - `task-events.json`
   - `task-assignments.json`
   - `assignment package`

一句话总结：

`Codex 决策，workflow 落账，worker 执行`

## 6. 配套安装

### 控制层 skill

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill worker-review-orchestrator -g -y
npm install -g @tingrudeng/worker-review-orchestrator-cli
```

其中 `worker-review-orchestrator` skill 负责工作流约束，`@tingrudeng/worker-review-orchestrator-cli` 提供 `forgeflow-review-orchestrator` 命令本体。

### 远程 Trae runtime npm 包

```bash
npm install -g @tingrudeng/trae-beta-runtime
```

安装后使用：

```bash
forgeflow-trae-beta init
forgeflow-trae-beta doctor
forgeflow-trae-beta start launch
forgeflow-trae-beta start gateway
forgeflow-trae-beta start worker
```

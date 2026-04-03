# 真实两机 Codex 演练 Runbook

## 目标

用两台真实设备完成一次 `codex-worker` 多机演练。

## 机器分工

- `192.168.1.78`
  - dispatcher server
  - `codex-worker-1`
- `192.168.1.xx`
  - `codex-worker-2`
- 总调度机器
  - `codex-control`

## 前提

- 两台 worker 机器都已准备好：
  - `openclaw-multi-agent-mvp` 仓库
  - `codex` CLI
  - Git 远端权限
- dispatcher 机器能被两台 worker 访问：`http://192.168.1.78:8787`
- 总调度机器有 `GITHUB_TOKEN`

建议先统一设置路径变量（按你的本机实际路径调整）：

```bash
export FORGEFLOW_REPO_DIR="/abs/path/to/forgeflow-platform"
export TARGET_REPO_DIR="/abs/path/to/openclaw-multi-agent-mvp"
```

## 1. 在 192.168.1.78 启动 dispatcher

```bash
cd "$FORGEFLOW_REPO_DIR"
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

打开 dashboard：

- `http://192.168.1.78:8787/dashboard`

## 2. 在 192.168.1.78 启动 codex-worker-1

```bash
cd "$FORGEFLOW_REPO_DIR"
node scripts/run-worker-daemon.js \
  --dispatcher-url http://192.168.1.78:8787 \
  --worker-id codex-worker-78 \
  --pool codex \
  --hostname 192.168.1.78 \
  --labels dispatcher,codex \
  --repo-dir "$TARGET_REPO_DIR"
```

## 3. 在 192.168.1.xx 启动 codex-worker-2

```bash
cd "$FORGEFLOW_REPO_DIR"
node scripts/run-worker-daemon.js \
  --dispatcher-url http://192.168.1.78:8787 \
  --worker-id codex-worker-remote \
  --pool codex \
  --hostname 192.168.1.xx \
  --labels codex \
  --repo-dir "$TARGET_REPO_DIR"
```

## 4. 在总调度机器生成双 codex planner JSON

```bash
cd "$FORGEFLOW_REPO_DIR"
node scripts/create-two-codex-drill-planner.js \
  --output /tmp/two-codex-drill-planner.json
```

## 5. 在总调度机器发布任务

```bash
cd "$FORGEFLOW_REPO_DIR"
node scripts/run-codex-control-flow.js \
  --repo TingRuDeng/openclaw-multi-agent-mvp \
  --ref master \
  --repo-dir "$TARGET_REPO_DIR" \
  --dispatcher-url http://192.168.1.78:8787 \
  --request-summary "执行真实两机 codex 演练" \
  --task-type feature \
  --planner-provider manual \
  --planner-json-file /tmp/two-codex-drill-planner.json
```

## 6. 观察 dashboard

预期：

- 两个 worker 都出现在 Workers 表里
- 两个 task 都进入 `assigned`，随后进入 `review`
- 两个 worker 在执行阶段会显示 `busy`

## 7. 提交 review 决策

先在 dashboard 或状态文件里找到 `taskId`，然后执行：

```bash
cd "$FORGEFLOW_REPO_DIR"
node scripts/submit-review-decision.js \
  --dispatcher-url http://192.168.1.78:8787 \
  --task-id dispatch-1:task-1 \
  --decision merge
```

如果要打回：

```bash
node scripts/submit-review-decision.js \
  --dispatcher-url http://192.168.1.78:8787 \
  --task-id dispatch-1:task-1 \
  --decision rework
```

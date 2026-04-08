# Phase 2 Mainline Operations

这份 runbook 只覆盖阶段二主链能力：`dependsOn`、claim POST、review redrive / continuation、worker result canonicalization、控制层 `state-dir` fallback、任务取消、`traceId` 关联、最小指标导出。

它不是仓库规则文件。规则仍以 `../AGENTS.md` 为准，接口字段仍以 `API_ENDPOINTS.md` 和 `contracts/*` 为准。

## 1. 最小启动

控制平面：

```bash
pnpm install
node scripts/run-dispatcher-server.js \
  --host 0.0.0.0 \
  --port 8787 \
  --state-dir .forgeflow-dispatcher
```

远端 Trae worker：

```bash
forgeflow-trae-beta init \
  --project-path /abs/path/to/business-repo \
  --dispatcher-url http://<dispatcher-host>:8787 \
  --worker-id trae-remote-01
forgeflow-trae-beta start all
```

## 2. dependsOn 调度门控

带依赖的任务不会直接进入 `ready`，而是先落到 `planned`。

最小 dispatch 示例：

```json
{
  "repo": "acme/example",
  "defaultBranch": "main",
  "requestedBy": "codex-control",
  "tasks": [
    {
      "id": "task-a",
      "title": "prepare base change",
      "pool": "trae",
      "branchName": "codex/task-a"
    },
    {
      "id": "task-b",
      "title": "follow task-a",
      "pool": "trae",
      "branchName": "codex/task-b",
      "dependsOn": ["dispatch-1:task-a"]
    }
  ],
  "packages": []
}
```

验证点：

- `task-a` 初始可进入 `ready` 或 `assigned`
- `task-b` 初始必须是 `planned`
- 依赖任务完成并进入 `merged` 后，dispatcher 会把 `task-b` 解锁到 `ready`

## 3. Generic Worker Claim

阶段二起，generic worker 的 claim 只能走显式 POST：

```bash
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/workers/codex-01/assigned-task

curl -s -X POST \
  -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"at":"2026-04-07T12:00:00+08:00"}' \
  http://127.0.0.1:8787/api/workers/codex-01/claim-task
```

约束：

- `GET /assigned-task` 只读，不再产生 side effect
- `POST /claim-task` 才允许把 `ready` 任务转成 `assigned`
- 纯读取 GET 默认返回 `Cache-Control: no-store`

## 4. Review Redrive / Continuation

阶段二主线里：

- `merge`：`review -> merged`
- `block`：`review -> blocked`
- `rework`：`review -> blocked`，但允许 redrive
- `changes_requested`：`review -> blocked`，但允许 redrive

最小 redrive 示例：

```bash
forgeflow-review-orchestrator redrive \
  --dispatcher-url http://127.0.0.1:8787 \
  --task-id dispatch-12:task-3
```

redrive 后的新任务会带：

- `continuationMode=continue`
- `continueFromTaskId=<source task>`

控制层分支规则：

- 已验证远端成功后的轻量返工，可继续复用原分支
- 未验证远端成功，或换 worker / 换环境 / 大改重做时，必须新开 `-rN` 分支

控制层 CLI 摘要视图：

```bash
forgeflow-review-orchestrator inspect \
  --state-dir .forgeflow-dispatcher \
  --task-id dispatch-12:task-3 \
  --summary

forgeflow-review-orchestrator watch \
  --state-dir .forgeflow-dispatcher \
  --task-id dispatch-12:task-3 \
  --summary
```

当前 `--summary` 至少会收口：

- `reviewState`
- `traceId`
- `latestResultEvidence.failureSummary`
- `latestResultEvidence.failureCode`
- `canRedrive`
- `latestProgressAt`
- `latestProgressSummary`
- `lineage`

补充：

- 直接 `dispatch/dispatch-task` 到 `pool=trae` 且显式 `targetWorkerId` 时，CLI 默认会先校验 worker 在线
- `redrive` 属于显式 continuation / rework 路径，当前内部会显式 opt-out 在线门禁，允许先生成后续任务再等 worker 恢复

## 5. Manual Cancel

控制层现在可以手动作废非终态任务：

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"actor":"operator","reason":"superseded by newer task"}' \
  http://127.0.0.1:8787/api/tasks/dispatch-12:task-3/cancel
```

当前语义：

- `merged` / `failed` 不允许取消
- 已分配或执行中的任务被取消时，dispatcher 会释放对应 worker
- console 页面现在也支持选中任务后直接点击 `作废任务`

## 6. Worker Result Canonicalization

worker 上送的是执行证据，不是权威任务元数据。dispatcher 会重建：

- `taskId`
- `workerId`
- `pool`
- `repo`
- `defaultBranch`
- `branchName`
- `mode`

因此：

- worker 不能把结果伪装到别的 repo / branch / worker
- PR `baseBranch` 与 dispatch `defaultBranch` 不一致时会被拒绝
- 越权或不匹配元数据当前返回 `409`

## 7. Metrics / Health Checks

阶段二最小控制面观测入口：

```bash
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/metrics
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/dashboard/snapshot
```

当前 `/api/metrics` 至少导出：

- `queueDepth`
- `plannedTasks`
- `reviewBacklog`
- `avgAssignmentLagMs`
- `maxAssignmentLagMs`
- `retryRatePct`
- `submitResultRetryCount`
- `deliveryFailedCount`
- `cleanupFailureCount`
- `sessionInterruptionCount`
- `stateLockTimeoutCount`
- `branchProtectionHitCount`
- `repoConcurrencySaturation`
- `failureCodes`
- `reviewReasonCodes`
- `workers`
- `tasks`

详细的 metrics / alert 说明见 `observability-and-alerting.md`。

## 8. Failure Handling Notes

- `submitResult` / push / 自动 draft PR 失败，不应再当成 completed 成功
- worker 失败结果会显式回写 failed 语义，控制层再决定 redrive / rework
- worktree cleanup 失败现在会尽力回写 worker event，并体现在 `/api/metrics.cleanupFailureCount`
- Trae runtime 现在还会回写结构化 phase events 与 failure blocker codes；generic worker daemon 的 failed result 也会带 blocker code。redrive 优先读 blocker `code`，再回退到旧文本 pattern
- 排障时仍要联合 worker 侧日志和 `.worktrees/failed/` 证据查看

## 9. Stage 2 Exit Checks

阶段二收尾时，建议至少确认这几组能力都能跑通：

- dispatcher ownership：
  - `review-memory` / `task-worktree` 权威实现位于 `apps/dispatcher/src/modules/server/*`
  - `scripts/lib/*` 仅保留 bootstrap wrapper
- 最小观测面：
  - snapshot / `/api/metrics` / CLI summary / console 都能看到 `traceId`
  - `/api/metrics` 暴露 `retryRatePct`、`failureCodes`、`reviewReasonCodes`
- worker 证据：
  - Trae runtime 会回写 phase events、`sessionId`、`traceId`、`failureCode`
- 最小出口验证：
  - dispatcher server / runtime-state / review-memory / task-worktree
  - orchestrator CLI `watch` / `inspect`
  - console task detail
  - Trae runtime worker evidence
- 可重复验证入口：
  - `pnpm verify:stage2`
  - `git diff --check`
## 10. 收尾检查

阶段二相关改动收尾前至少执行：

```bash
pnpm verify:stage2
pnpm test
pnpm typecheck
git diff --check
```

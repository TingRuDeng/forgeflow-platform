# Observability And Alerting

这份 runbook 说明当前阶段二到阶段三核心平台的观测面：metrics、runtime events、lease 指标、SLO / burn-rate、日志脱敏、告警建议。

它描述的是当前仓库已落地实现，不代表已经完成长期版 OTel 体系。

## 1. 当前观测入口

读活性：

```bash
curl -s http://127.0.0.1:8787/health
```

读最小指标：

```bash
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/metrics
```

读完整快照：

```bash
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/dashboard/snapshot
```

阶段三额外可观察入口：

```bash
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/query/projection-health

curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/slo

curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/dr/status
```

## 2. `/api/metrics` 字段

当前最小指标包括：

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
- `shadowWriteFailureCount`
- `leaseConflictCount`
- `leaseReclaimCount`
- `activeLeases`
- `branchProtectionHitCount`
- `repoConcurrencySaturation`
- `failureCodes`
- `reviewReasonCodes`
- `workers`
- `tasks`

含义摘要：

- `queueDepth`: 当前未完成任务数
- `plannedTasks`: 仍被 `dependsOn` 或其他前置条件锁住的任务数
- `reviewBacklog`: 已到 review 但尚未 merge/block 的任务数
- `avgAssignmentLagMs` / `maxAssignmentLagMs`: 从 ready 到 assigned 的等待时间
- `retryRatePct`: 近期 task 级 redrive / retry 占比
- `submitResultRetryCount`: worker 回写 dispatcher 前出现的回写重试信号
- `deliveryFailedCount`: `submitResult`、push、draft PR 等交付链失败的控制面落账数
- `cleanupFailureCount`: worktree cleanup 失败数
- `sessionInterruptionCount`: 会话中断信号数
- `stateLockTimeoutCount`: dispatcher 状态锁竞争超时数
- `shadowWriteFailureCount`: Postgres / queue shadow 写失败次数，对应 `shadow_write_failed` runtime event
- `leaseConflictCount`: assignment ownership 争用次数
- `leaseReclaimCount`: reconcile 回收过期 assignment lease 的次数
- `activeLeases`: 当前活跃 assignment lease 总数和按资源类型聚合
- `branchProtectionHitCount`: 保护分支/分支前缀策略命中数
- `repoConcurrencySaturation`: 按 `repoDir` 聚合的活跃 worker 并发饱和度
- `failureCodes`: 基于 worker evidence / blocker code 的失败码聚合
- `reviewReasonCodes`: 基于 review evidence `reasonCode` 的阻断原因聚合

## 3. 指标来源

当前指标来源不是单一 exporter，而是三类合并：

- dispatcher snapshot 直接计算出的 backlog / lag / queue 指标
- dispatcher runtime events 聚合出的失败计数
- dispatcher runtime ownership 派生出的 lease 指标

当前 worker 侧会尽力上送这些事件到 `POST /api/workers/:workerId/events`：

- `submit_result_retry_failed`
- `delivery_failed`
- `worktree_cleanup_failed`
- `session_interrupted`
- Trae runtime structured phase events:
  - `register_*`
  - `fetch_task_*`
  - `workspace_prepare_*`
  - `start_task_*`
  - `readiness_wait_*`
  - `prepare_session_*`
  - `send_chat_*`
  - `session_recovery_*`
  - `artifact_check_*`
  - `submit_result_*`
  - `session_release_*`

dispatcher 进程内还会记录：

- `state_lock_timeout`
- `lease_conflict`
- `lease_reclaimed`

注意：

- worker 事件上送是 best-effort
- `/api/metrics` 的零值不等于“全链路绝对无故障”
- 排障时仍要联合 worker 日志与 `.worktrees/failed/` 证据看

## 4. 日志与 trace 现状

当前已落地：

- 脚本侧 logger 默认会 redact `Authorization`、`DISPATCHER_API_TOKEN`、`GITHUB_TOKEN` 等敏感字段
- dispatcher events、task state、worker id、task id、trace id、session id 已能提供最小相关性线索
- console 现在支持 task drill-down，可直接查看 failure summary、reasonCode、canRedrive、lineage 和最近任务事件

当前还没有完整长期版能力：

- 还没有统一 OTel collector / exporter 配置
- 还没有所有组件共享的全链路 trace pipeline

阶段三核心当前采用的是 OTel-ready 关联键和结构化 phase events，而不是绑定某个外部 collector 实现。

因此当前 trace 实践应以这些关联键为主：

- `taskId`
- `traceId`
- `workerId`
- `sessionId`
- `repo`
- `branchName`

## 5. 最小告警建议

建议先做简单阈值告警，而不是复杂 BI。

推荐规则：

- `deliveryFailedCount` 在短时间窗口内递增
- `stateLockTimeoutCount` 持续递增
- `leaseConflictCount` 在短时间窗口内递增
- `reviewBacklog` 长时间不下降
- `queueDepth` 持续堆积且 `avgAssignmentLagMs` 上升
- `cleanupFailureCount` 连续出现
- `sessionInterruptionCount` 在同一 worker 或同一 repo 下集中出现
- `/api/slo` 的 `burnRate.triggered=true`

推荐观察组合：

- `queueDepth + avgAssignmentLagMs`
  - 看调度是否堵塞
- `reviewBacklog + deliveryFailedCount`
  - 看 review 与交付是否同时阻塞
- `cleanupFailureCount + sessionInterruptionCount`
  - 看无人值守执行环境是否不稳定
- `stateLockTimeoutCount + recent events`
  - 看控制面是否存在写冲突或卡锁
- `leaseConflictCount + leaseReclaimCount`
  - 看 ownership 是否在抖动、是否存在 stale owner reclaim
- `artifact_check_* + send_chat_*`
  - 看 Trae 失败是聊天交互问题还是远端产物验证问题
- `workspace_prepare_* + start_task_*`
  - 看失败是 worktree / branch 预处理，还是 dispatcher 状态流转本身

## 6. 排障顺序

1. 先看 `/health`
2. 再看 `/api/metrics`
3. 再看 `/api/query/projection-health`
4. 再看 `/api/slo` 和 `/api/dr/status`
5. shadow rollout 前执行 `pnpm verify:shadow-drift` 或 `node scripts/check-shadow-drift.mjs <stateDir>`，确认 `drift.status` 不是 `drifted`；release workflow 也会执行同一 gate
6. 需要阈值化告警时执行 `node scripts/check-shadow-drift.mjs <stateDir> --max-mismatches 0 --max-delta 0`，查看 `alert.level` 和 `alert.reasonCodes`
7. 需要主动对账时执行 `node scripts/check-shadow-drift.mjs <stateDir> --reconcile`；需要落运行时证据时追加 `--record-alert` 写入 `shadow_drift_detected`
8. 最后再看 worker 日志和 `.worktrees/failed/`

常见入口：

- 交付失败：`delivery-failed-recovery.md`
- 锁竞争：`auth-and-state-lock.md`
- 清理失败：`worktree-cleanup.md`
- 备份与恢复：`runtime-state-backup-restore-repair.md`
- 主链操作：`phase2-mainline-operations.md`
- 阶段三核心平台：`stage3-core-platform-operations.md`

## 7. 当前边界

这份 runbook 覆盖的是阶段二到阶段三核心底座的最小可观测闭环：

- control-plane metrics
- runtime event 聚合
- lease / projection / burn-rate 可视化入口
- 日志脱敏
- 最小阈值告警建议

它不声明以下能力已经完成：

- 完整 OTel logs / traces / metrics 全量贯通
- 多实例观测平台
- 对外统一 observability SDK / collector 平台

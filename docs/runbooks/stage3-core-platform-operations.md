# Stage 3 Core Platform Operations

这份 runbook 是阶段三核心底座的操作入口。

它只覆盖：

- lease / structured reads / query projection
- Postgres / queue shadow path
- SLO / burn-rate
- backup / restore / read-only
- 参考部署

它不覆盖：

- 对外 SDK / 第三方准入
- 完整多租户治理

## 1. 最小验证

本地回归：

```bash
pnpm verify:stage3
pnpm verify:stage3:live
git diff --check
```

线上 / staging 最小巡检：

```bash
curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/metrics

curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/query/projection-health

curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/slo

curl -s -H "Authorization: Bearer ${DISPATCHER_API_TOKEN}" \
  http://127.0.0.1:8787/api/dr/status
```

## 2. Lease 与 Query Projection

建议检查：

- `/api/metrics`
  - `leaseConflictCount`
  - `leaseReclaimCount`
  - `activeLeases`
- `/api/leases`
- `/api/query/leases`
- `/api/query/projection-health`

期望：

- 当前活跃 lease 与任务执行状态一致
- `leaseConflictCount` 不持续递增
- `projectionHealth.matches=true`

## 3. Structured Reads

启用方式：

```bash
export DISPATCHER_STRUCTURED_READS=1
```

含义：

- dashboard / metrics / workers 走 SQLite 结构化投影读路径
- 写路径仍保持 snapshot + projection 同步

建议：

- 先在 staging 开启
- 观察 `/api/query/projection-health`
- 如果发现 drift，先关掉 structured reads 再排查

## 4. Shadow Postgres / Queue

推荐起步配置：

```bash
export DISPATCHER_SHADOW_MODE=shadow-write
export DISPATCHER_POSTGRES_URL=postgres://user:pass@host:5432/forgeflow
export DISPATCHER_QUEUE_SHADOW_MODE=shadow-write
```

当前语义：

- SQLite 仍是真相源
- shadow 写失败不会改变主链状态机写入结果
- shadow 写状态会写入 `runtime-state-shadow-status.json`，重启后仍可通过 `/api/dr/status.shadowWrite` 查看
- drift / shadow 故障应通过告警和对账处理，而不是自动把任务判失败

推荐巡检：

- SQLite projection 正常
- Postgres shadow 已配置
- `/api/dr/status.shadowWrite` 最近状态为 `ok`，或失败原因已被人工确认
- `node scripts/check-shadow-drift.mjs .forgeflow-dispatcher` 返回 `ok=true`
- `node scripts/check-shadow-drift.mjs .forgeflow-dispatcher --max-mismatches 0 --max-delta 0` 可输出 `alert.level`；release / rollout gate 也可通过 `DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES` 与 `DISPATCHER_SHADOW_DRIFT_MAX_DELTA` 注入同一阈值
- 如果 drift 来自 shadow projection / queue 落后，operator 可执行 `node scripts/check-shadow-drift.mjs .forgeflow-dispatcher --reconcile` 主动重放 SQLite truth 到 shadow 后复查
- 生产巡检或定时任务可使用 `pnpm verify:shadow-drift:reconcile`，等价于显式 `--reconcile --record-alert`；需要长期运行的自动对账进程时使用 `pnpm verify:shadow-drift:reconciler`，它会周期性执行同一 reconciliation + alert 记录流程，并可通过 `run-shadow-reconciler.mjs --output <path>` 或 `DISPATCHER_SHADOW_RECONCILER_STATUS_FILE=<path>` 原子写入最近一轮 `shadow-reconciler-status/v1` 状态快照；生产切换窗口使用 `pnpm verify:shadow-cutover:reconciler`，让长期进程持续执行 strict cutover 条件：shadow 已配置、primary backend 已配置、零 drift；也可通过 `DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE=1` 与 `DISPATCHER_SHADOW_DRIFT_RECORD_ALERT=1` 注入同一行为
- 如果需要把 drift 留作运行时告警证据，operator 可追加 `--record-alert` 写入 `shadow_drift_detected` system event
- 生产 cutover 前必须执行 `pnpm verify:shadow-cutover`，该命令要求 shadow 已配置、`--max-mismatches 0 --max-delta 0` 通过，并且 `RUNTIME_STATE_BACKEND=postgres` 与 `DISPATCHER_PRIMARY_POSTGRES_URL` 已配置；未配置 shadow 或 primary backend 时会失败
- 生产 cutover 演练使用 `pnpm verify:shadow-cutover:drill`；它会依次运行 drift gate、`--reconcile --record-alert` 对账、strict cutover preflight，并输出每个 phase 的 `ok/statusCode/payload`
- 变更窗口前必须归档 cutover drill 证据时，使用 `pnpm verify:shadow-cutover:drill:evidence`，它会把同一 payload 写入 `.forgeflow-dispatcher/shadow-cutover-drill.json`；自定义归档路径可直接调用 `node scripts/verify-shadow-cutover-drill.mjs <stateDir> --output <path>`
- 归档 drill 证据后必须执行 `pnpm verify:shadow-cutover:approve`，该命令会校验证据里的 `cutover_preflight=cutover_ready`，记录 `evidencePath` / `evidenceSha256`，并生成 `.forgeflow-dispatcher/shadow-cutover-approval.json`
- 切换窗口开始前必须执行 `pnpm verify:shadow-cutover:approval`，该命令会独立校验 approval marker 仍为 `cutover_ready`、归档 evidence SHA-256 未漂移，并确认不存在 `shadow-cutover-revocation.json`
- 最终切换前必须执行 `pnpm verify:shadow-cutover:ready`，该命令会输出 `strict_cutover_preflight` 与 `approval_evidence` 两个 phase，只有 strict preflight 和 approval evidence 同时通过才返回成功
- 需要归档最终切换前门禁证据时执行 `pnpm verify:shadow-cutover:ready:evidence`，它会把同一 payload 原子写入 `.forgeflow-dispatcher/shadow-cutover-ready.json`；自定义归档路径可直接调用 `node scripts/verify-shadow-cutover-ready.mjs <stateDir> --output <path>`
- 回滚或撤销生产切换窗口时执行 `pnpm verify:shadow-cutover:revoke`；该命令会把 approval marker 归档为 `shadow-cutover-approval.revoked-*.json`，并写入 `.forgeflow-dispatcher/shadow-cutover-revocation.json`
- `RUNTIME_STATE_BACKEND=postgres` 现在会在读写 primary snapshot 前校验 `shadow-cutover-approval.json` 与 `shadow-cutover-ready.json`，并重新读取 `evidencePath` 确认当前文件 SHA-256 与 approval 里的 `evidenceSha256` 匹配；ready evidence 必须包含通过的 `strict_cutover_preflight` 和与 approval marker 匹配的 `approval_evidence`。自定义审批文件路径可设置 `DISPATCHER_PRIMARY_CUTOVER_APPROVAL_FILE`，自定义 ready 文件路径可设置 `DISPATCHER_PRIMARY_CUTOVER_READY_FILE`；如果存在 `shadow-cutover-revocation.json`，primary backend 会拒绝连接，直到重新完成 drill evidence、approval 和 ready evidence
- `DISPATCHER_SHADOW_MODE=primary` 不是独立生产切换开关；只有 `RUNTIME_STATE_BACKEND=postgres` 和 `DISPATCHER_PRIMARY_POSTGRES_URL` 已配置时，它才作为切换后兼容状态通过 drift / cutover 检查。primary backend 未选择时会失败为 `primary_backend_not_selected`
- `@forgeflow/dispatcher-store-postgres` 已有 primary snapshot 表原语，dispatcher HTTP route 主链与 `/api/query/*` 已通过 async Postgres state path 读写 primary snapshot；仓库内生产切换门禁已收口到 drill evidence、approval marker、ready gate、revocation marker 和 Postgres primary backend guard
- `pnpm verify:stage3` 和 release workflow 会执行 `pnpm verify:shadow-drift`，shadow 配置存在且 drifted 时必须阻断 rollout / release
- assignment delivery queue 影子计数合理

## 5. Read-only 与 DR

只读降级：

```bash
export DISPATCHER_READ_ONLY_MODE=1
```

此时：

- 查询接口继续可用
- `/api` 下 `POST` / `PUT` / `PATCH` / `DELETE` 默认返回 `503 read_only_mode`
- 该开关可作为 DR / repair 前的 dispatcher API 写冻结入口；直接文件操作和外部数据库操作仍需单独管控

备份与恢复：

```bash
node scripts/backup-runtime-state.mjs .forgeflow-dispatcher .forgeflow-dispatcher/backups/<timestamp>
node scripts/restore-runtime-state.mjs .forgeflow-dispatcher/backups/<timestamp> .forgeflow-dispatcher
node scripts/verify-stage3-dr.mjs
node scripts/verify-live-dispatcher-dr.mjs
```

建议：

- 发布前至少做一次 backup
- backup / restore 会包含 `runtime-state-shadow-status.json`、`shadow-cutover-drill.json`、`shadow-cutover-approval.json`、`shadow-cutover-ready.json` 和 `shadow-cutover-revocation.json`，确保 shadow 健康状态、cutover drill / ready evidence、approval marker 与 rollback revocation marker 可随运行时状态恢复
- 每季度跑一次 `verify-stage3-dr`，它能证明源码级 SQLite WAL 备份恢复与 checksum 校验
- 风险较高的 runtime 发布前跑一次 `verify-live-dispatcher-dr`，它能启动本地 live dispatcher、执行真实 HTTP 写入，并覆盖 SIGKILL 替换恢复、磁盘损坏后恢复和双 stateDir 多节点恢复一致性；它仍不替代真实生产 quorum / fencing / DNS 切流演练
- 先切 read-only，再做 restore

## 6. SLO / Burn-rate

当前阈值环境变量：

- `DISPATCHER_SLO_MAX_QUEUE_DEPTH`
- `DISPATCHER_SLO_MAX_REVIEW_BACKLOG`
- `DISPATCHER_SLO_MAX_ASSIGNMENT_LAG_MS`
- `DISPATCHER_SLO_MAX_DELIVERY_FAILED`
- `DISPATCHER_SLO_MAX_LEASE_CONFLICTS`
- `DISPATCHER_SLO_MAX_SHADOW_WRITE_FAILED`

当前 `/api/slo` 会输出：

- `targets`
- `indicators`
- `burnRate.triggered`
- `burnRate.reasons`

当前 burn-rate 触发原因：

- `queue_depth`
- `review_backlog`
- `assignment_lag`
- `delivery_failed`
- `lease_conflict`
- `shadow_write_failed`

## 7. 参考部署

当前仓库内参考部署：

- `deploy/compose/docker-compose.single-node.yml`
- `deploy/compose/docker-compose.single-write-multi-executor.yml`
- `deploy/helm/forgeflow/*`

建议：

- 单机环境先用 single-node
- 单写多执行先用 single-write-multi-executor
- 先在 reference deployment 验证 structured reads / shadow write，再进入正式环境

## 8. 当前边界

阶段三核心底座当前已完成：

- task 生命周期 lease / lock：claim 获取 assignment / repo / branch，continuation 或 follow-up 任务额外获取 session；dispatcher 外部直接操作仍需 operator-level lock
- query-first SQLite projection
- Postgres / queue shadow path
- SLO / burn-rate
- DR 演练入口
- 参考部署与 provider 收口
- 内部 Worker SDK helper 与第三方 provider admission gate

当前仍未纳入本 runbook 的是生态开放波次：

- 公网对外 SDK 长期兼容承诺
- 第三方 provider 自助注册 / 撤销后台
- 外部公共 API 稳定承诺

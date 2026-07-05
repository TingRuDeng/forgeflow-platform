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
- 生产巡检或定时任务可使用 `pnpm verify:shadow-drift:reconcile`，等价于显式 `--reconcile --record-alert`；也可通过 `DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE=1` 与 `DISPATCHER_SHADOW_DRIFT_RECORD_ALERT=1` 注入同一行为
- 如果需要把 drift 留作运行时告警证据，operator 可追加 `--record-alert` 写入 `shadow_drift_detected` system event
- 生产 cutover 前必须执行 `pnpm verify:shadow-cutover`，该命令要求 shadow 已配置、`--max-mismatches 0 --max-delta 0` 通过，并且 `RUNTIME_STATE_BACKEND=postgres` 与 `DISPATCHER_PRIMARY_POSTGRES_URL` 已配置；未配置 shadow 或 primary backend 时会失败
- 当前 `DISPATCHER_SHADOW_MODE=primary` 会被明确拒绝为 `primary_store_not_implemented`；不要把它作为生产切换开关，真正 primary store 开关是 `RUNTIME_STATE_BACKEND=postgres`
- `@forgeflow/dispatcher-store-postgres` 已有 primary snapshot 表原语，dispatcher HTTP route 主链与 `/api/query/*` 已通过 async Postgres state path 读写 primary snapshot；完整生产切换仍需生产阈值演练和外部存储运维确认
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

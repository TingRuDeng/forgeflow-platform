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
- drift / shadow 故障应通过告警和对账处理，而不是自动把任务判失败

推荐巡检：

- SQLite projection 正常
- Postgres shadow 已配置
- assignment delivery queue 影子计数合理

## 5. Read-only 与 DR

只读降级：

```bash
export DISPATCHER_READ_ONLY_MODE=1
```

此时：

- 查询接口继续可用
- 写接口统一返回 `503 read_only_mode`

备份与恢复：

```bash
node scripts/backup-runtime-state.mjs --state-dir .forgeflow-dispatcher
node scripts/restore-runtime-state.mjs --state-dir .forgeflow-dispatcher --backup-dir .forgeflow-dispatcher/backups/<timestamp>
node scripts/verify-stage3-dr.mjs
```

建议：

- 发布前至少做一次 backup
- 每季度跑一次 `verify-stage3-dr`
- 先切 read-only，再做 restore

## 6. SLO / Burn-rate

当前阈值环境变量：

- `DISPATCHER_SLO_MAX_QUEUE_DEPTH`
- `DISPATCHER_SLO_MAX_REVIEW_BACKLOG`
- `DISPATCHER_SLO_MAX_ASSIGNMENT_LAG_MS`
- `DISPATCHER_SLO_MAX_DELIVERY_FAILED`
- `DISPATCHER_SLO_MAX_LEASE_CONFLICTS`

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

- lease / lock
- query-first SQLite projection
- Postgres / queue shadow path
- SLO / burn-rate
- DR 演练入口
- 参考部署与 provider 收口

当前仍未纳入本 runbook 的是生态开放波次：

- 对外 SDK
- 第三方准入
- 外部公共 API 稳定承诺

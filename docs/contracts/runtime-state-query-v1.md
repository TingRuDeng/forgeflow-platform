# Runtime State Query V1

这份契约只描述阶段三核心底座已经落地的 query-first / lease / shadow / read-only 语义，不替代完整状态机说明。

## 1. Scope

当前契约覆盖：

- dispatcher runtime state 中新增的 `leases[]`
- SQLite 结构化投影与 `/api/query/*` 只读面
- `DISPATCHER_STRUCTURED_READS`
- `DISPATCHER_READ_ONLY_MODE`
- `DISPATCHER_SHADOW_MODE` / `DISPATCHER_QUEUE_SHADOW_MODE`

不覆盖：

- review memory lesson 结构
- Trae gateway 协议
- 对外公开 SDK / 第三方准入

## 2. Lease Shape

当前 `RuntimeState.leases[]` 最小字段：

- `id`
- `resourceType`
- `resourceId`
- `ownerId`
- `ownerToken`
- `acquiredAt`
- `renewedAt`
- `expiresAt`
- `releasedAt`
- `reclaimReason`
- `metadata`

当前支持的 `resourceType`：

- `assignment`
- `session`
- `repo`
- `branch`

当前主线强约束：

- assignment claim / start / result / cancel / offline / reconcile 都会检查或释放 `assignment` lease
- lease 冲突会记录 `lease_conflict` 事件
- 过期回收会记录 `lease_reclaimed` 事件
- dispatcher metrics 会暴露：
  - `leaseConflictCount`
  - `leaseReclaimCount`
  - `activeLeases`

当前边界：

- `session` / `repo` / `branch` 已进入类型、存储、投影和指标表达，但当前代码只确认 assignment lease 接入强约束 acquisition / release。
- 不要把这些 resource type 解读成已经完整落地的 repo / branch / session 并发治理。

## 3. SQLite Structured Projection

当前 SQLite 真相源仍是 append-only `snapshots`。

阶段三新增的结构化投影表：

- `workers`
- `tasks`
- `assignments`
- `reviews`
- `pull_requests`
- `dispatches`
- `runtime_events`
- `leases`
- `sessions`

当前语义：

- `snapshots` 仍是真相源
- 结构化表是由同一次保存事务重建的 query projection
- `/api/query/projection-health` 会比较 snapshot 派生计数与结构化投影计数
- projection mismatch 当前属于运维 / drift 信号，不会自动把 SQLite 主链切到 failed

## 4. Structured Read Semantics

环境变量：

- `DISPATCHER_STRUCTURED_READS=1`

当前影响的只读接口：

- `GET /api/dashboard/snapshot`
- `GET /api/metrics`
- `GET /api/workers`

当前辅助查询接口：

- `GET /api/leases`
- `GET /api/query/tasks`
- `GET /api/query/events`
- `GET /api/query/reviews`
- `GET /api/query/leases`
- `GET /api/query/dashboard-snapshot`
- `GET /api/query/projection-health`

当前保证：

- structured reads 只改变读路径，不改变 dispatcher 写语义
- structured reads 关闭时，读路径会回退到 snapshot 派生逻辑

## 5. Read-only Mode

环境变量：

- `DISPATCHER_READ_ONLY_MODE=1`

当前语义：

- 查询接口继续可用
- `dispatcher-server.ts:isMutationRequest` 覆盖的 mutation 请求会被拒绝
- 当前返回：
  - HTTP `503`
  - JSON `{ "error": "dispatcher is in read-only mode", "code": "read_only_mode" }`

当前 read-only 适用目标：

- 故障隔离
- 恢复前冻结写入
- DR drill 验证

当前边界：

- read-only 不是独立路由注册系统，而是依赖手写 matcher；matcher 漏掉的 state-changing 路由不会自动获得保护。
- 在 matcher 和测试补齐前，运行手册不得把该开关描述为完整写冻结。

## 6. Shadow Modes

环境变量：

- `DISPATCHER_SHADOW_MODE`
- `DISPATCHER_POSTGRES_URL`
- `DISPATCHER_QUEUE_SHADOW_MODE`

当前支持的 `shadow mode`：

- `disabled`
- `shadow-write`
- `shadow-read`
- `primary`

当前主线只把 `shadow-write` 作为稳定用法写进主文档。

当前落地行为：

- SQLite snapshot + SQLite structured projection 仍是真相源
- 开启 shadow write 后，dispatcher 会 best-effort 写入：
  - `dispatcher_workers`
  - `dispatcher_tasks`
  - `dispatcher_assignments`
  - `dispatcher_reviews`
  - `dispatcher_events`
  - `dispatcher_leases`
- 如果 queue shadow 启用，还会写入 assignment delivery queue 影子表

当前边界：

- shadow 同步失败不会阻断 SQLite 主链写入
- shadow 同步失败当前不会通过 `/api/dr/status` 暴露为一等健康状态
- Postgres 当前是 shadow projection / queue shadow，不是 primary runtime store

## 7. Completion Signals

阶段三核心底座当前最小验收信号：

- `pnpm verify:stage3`
- `/api/query/projection-health` 显示 SQLite projection 无漂移
- `/api/slo` 可输出 burn-rate 状态
- `/api/dr/status` 可输出 read-only / structured reads / projection health / backup 清单

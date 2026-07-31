# forgeflow-platform Technical Debt

Only confirmed, still-active debt belongs here.

## 目的

记录已经确认仍存在、不能被误当成主线完成能力的技术债和迁移边界。

## 适合读者

适合规划阶段修复、代码审查、发布风险评估、文档同步和多 agent 任务拆分时阅读。

## 一分钟摘要

- 本文件只写仍然存在的债务，不写愿望清单。
- 当前债务集中在 runtime bridge、持久化 fallback / shadow 边界、Trae gateway 发布适配层和 Stage 3 边界。
- 近期审查确认 dispatcher 外部资源锁和跨主机生产 DR 仍需后续修复；发布版本落账已改为 PR-first，不再由 workflow 直推受保护 `main`。
- 修复债务时必须同步 `README.md`、`docs/README.md` 和相关稳定文档。

```yaml
ai_summary:
  authority: "已确认仍存在的技术债、影响范围和迁移边界"
  scope: "runtime bridge、persistence fallback、shadow path、Trae gateway、文档系统、Stage 3 deferred 能力"
  read_when:
    - "拆分技术债修复任务"
    - "判断某项能力是否已经完整落地"
    - "审查文档是否过度声明实现成熟度"
  verify_with:
    - "apps/dispatcher/src/modules/server/runtime-state-sqlite.ts"
    - "apps/dispatcher/src/modules/server/runtime-state-shadow.ts"
    - "apps/dispatcher/src/modules/server/dispatcher-server.ts"
    - ".github/workflows/release.yml"
  stale_when:
    - "债务项被代码修复、删除、归档或升级为正式能力"
```

## 权威边界

本文件负责债务和边界，不负责操作步骤或具体接口字段。操作看 `runbooks/*`，接口看 `API_ENDPOINTS.md`，持久化看 `DATABASE_SCHEMA.md`，最终以代码为准。

## 如何验证

- 对每个债务项执行 `rg` 或读取对应代码入口，确认仍存在。
- 对 release 债务核对 `.github/workflows/release.yml`。
- 对 shadow / DR 债务核对 `runtime-state-shadow.ts`、`runtime-state-sqlite.ts` 和 `scripts/verify-stage3-dr.mjs`。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## 1. Compatibility wrappers still depend on their authority package `dist` freshness

Current situation:

- dispatcher control-plane ownership now lives in `apps/dispatcher/`
- `scripts/lib/dispatcher-server|dispatcher-state|review-memory|review-decision` 只保留指向 `apps/dispatcher/dist` 的 bootstrap / compatibility wrapper
- `apps/dispatcher/src/modules/server/task-worktree.ts`、`scripts/lib/task-worktree.ts` 和 Trae adapter 只 re-export `@tingrudeng/beta-runtime-core` 的唯一 worktree 实现
- live entrypoints still depend on checked-in adapters importing the built `dist` of their authority package

Impact:

- bootstrap/freshness bugs can still appear at the boundary between source and built `dist`
- compatibility wrappers still add one extra layer for debugging local runtime startup

Desired direction:

- either keep this adapter split explicit and well-tested
- or remove more checked-in wrappers once all supported entrypoints can run directly from packaged/app-owned runtime modules

## 2. SQLite runtime state and JSON fallback still coexist as an explicit compatibility boundary

Current situation:

- dispatcher runtime state now defaults to SQLite via `runtime-state-sqlite.ts`
- JSON fallback still exists for explicit compatibility mode and import bootstrap
- standalone `apps/dispatcher/src/db/schema.ts` constants have been removed; live SQLite schema ownership is now concentrated in `runtime-state-sqlite.ts`
- active SQLite reads use WAL-aware read-only connections; immutable mode is limited to a no-WAL/no-SHM compatibility fallback for a fully read-only directory

Impact:

- easy to overstate database maturity or assume every persistence path is SQLite-first
- persistence-related changes can still land in the default SQLite backend or the explicit JSON fallback separately

Desired direction:

- keep the SQLite snapshot backend and JSON fallback explicitly documented
- do not reintroduce standalone schema constants outside the live runtime persistence module without a tested caller

## 3. Postgres primary is guarded, while SQLite remains the default

Current situation:

- dispatcher now has query-first SQLite projection tables
- optional Postgres / queue shadow write also exists
- SQLite snapshots remain the default truth source
- a guarded Postgres primary backend exists behind drill, approval, ready evidence, revocation checks, and explicit backend selection
- Postgres primary uses a storage revision CAS; stale full-state writers fail instead of overwriting a newer snapshot
- shadow projection / queue writes carry the persisted SQLite source revision, reject rollback, and advance atomically
- SQLite snapshots now have bounded retention, and SQLite/Postgres shadow projection rewrites skip unchanged tables

Impact:

- external drift detection, production cutover evidence, and rollout discipline still matter
- table-level hashing still rewrites an entire changed table; it is not row-level change data capture
- SQLite projection self-repair detects source-hash or row-count drift, but same-row-count manual content corruption still requires clearing projection hash metadata and rebuilding from the latest snapshot

Desired direction:

- keep shadow mode / primary mode boundaries explicit
- retain production cutover / rollback evidence and move to row-level projection deltas only if measured write volume justifies the added complexity

## 4. Trae automation gateway handler、HTTP server、debug logger、driver 创建规则和 session-store 已共享，剩余债务集中在发布适配层

已确认情况：

- `@tingrudeng/automation-gateway-core` 已提供共享 `handleAutomationGatewayRequest`，统一处理 `GET /ready`、session 查询 / release / prepare 和 `POST /v1/chat`
- `@tingrudeng/automation-gateway-core` 已提供共享 `startAutomationGatewayHttpServer`，统一处理 Node HTTP server、JSON body 读取、错误响应和 server close
- `@tingrudeng/automation-gateway-core` 已提供共享 `createAutomationGatewayDebugLogger` 和 `isAutomationGatewayDebugEnabled`，统一处理 `TRAE_AUTOMATION_DEBUG` / `debug` 开关与 `[trae-gateway][debug]` 结构化日志格式
- `@tingrudeng/automation-gateway-core` 已提供共享 `resolveAutomationGatewayDriver`，统一处理已注入 driver、automationOptions 透传和 gateway debug / driver debug 归一化
- `@tingrudeng/automation-gateway-core` 已提供共享 `createPersistentAutomationSessionStore`，统一处理 session 持久化、重启中断、TTL 清理、request fingerprint / target 解析和 public shape 裁剪；本机 mutation 通过 `sessions.json.lock` 串行化，并在锁内重读最新文件后再更新，损坏 JSON 会 fail closed
- `@tingrudeng/automation-gateway-core` 已提供共享 Trae CDP / DOM driver，统一 target discovery、CDP session、DOM 表达式、response extraction、activity snapshot 和 final report completion 判断
- `@tingrudeng/automation-gateway-core` 已提供共享 Trae clean relaunch 原语，统一 `.app` 名称解析、macOS app quit 和旧 CDP 端口 drain
- `@tingrudeng/automation-gateway-core` 已提供共享 Trae launcher helper，统一 launch 参数解析、remote debugging port 注入、project path 注入、macOS `.app` 到 `Contents/MacOS/*` 可执行文件解析、debugger wait / reuse、clean relaunch 后 spawn 和 spawn error race
- 脚本侧 `scripts/lib/trae-automation-gateway.ts` 与 packaged runtime `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 都已委托共享 handler、共享 HTTP server adapter、共享 debug logger、共享 driver 创建规则和共享 DOM driver；脚本侧只通过 wrapper 保留旧的 plain-text response 兼容默认值
- 脚本侧 `scripts/lib/trae-automation-session-store.ts` 与 packaged runtime `packages/trae-beta-runtime/src/runtime/trae-automation-session-store.ts` 都已委托共享 session-store，只保留默认目录、时间格式和类型兼容薄适配
- 脚本侧已经对齐 packaged runtime 的持久化 session 解析、`POST /v1/chat` 元数据透传和结构化 debugLog 关键事件
- packaged runtime 已补齐脚本侧 `POST /v1/chat` 的 completed-session cache、running-session conflict、request fingerprint conflict、progress touch 和 soft-timeout 保持 running 语义

影响：

- 默认 session-store 路径、持久化解析和 chat 调用关键行为已经对齐
- 同一状态目录内的重叠本机进程不再因各自持有旧 Map 而覆盖其他 session；唯一临时文件加 rename 继续防止 torn write
- route / session / chat 语义、HTTP JSON IO、debug logger、driver 创建规则、持久化 session-store 和 Trae DOM driver 已经集中到共享 core；后续 handler、request IO、debug 日志、driver debug 归一化、session 文件语义或 DOM driver 行为修复不应再分别修改脚本侧和 packaged runtime
- session store 仍是单机文件存储；该锁不是跨主机 lease，多个 active gateway 也不受 dispatcher session lease 协调
- 剩余漂移风险主要来自发布适配层：发布前 dist / workspace 依赖同步，以及 wrapper test 读取 workspace 依赖 dist 时必须先构建共享 core

期望方向：

- 后续不要再在两侧扩写 route handler、HTTP request IO、debug logger、driver 创建规则、session-store 或 DOM driver 逻辑；发布前重点验证 dist / workspace 依赖同步
- 需要多主或跨主机 session 协调时，把状态和 ownership 迁入共享 store / lease 协议，不要把本机 lock 扩写成分布式能力

## 5. Stable agent-facing docs were previously concentrated in rule/nav docs but lacked a durable knowledge layer

Impact:

- agents had to infer architecture, persistence, and HTTP boundaries from scattered files
- repeated rediscovery risk was high

Current status:

- partially addressed by the docs added in this pass

Remaining need:

- keep these docs synced whenever runtime boundaries or API surfaces change

## 6. Stage 3 ecosystem wave has internal gates, but public opening is still deferred

Current situation:

- stage-3 core platform waves are now in place
- `@forgeflow/worker-protocol` now provides internal start/result payload helpers for worker adapter authors
- `@forgeflow/provider-registry` now evaluates known provider capabilities and defaults third-party providers to deny unless allowlisted and declaring `worker-protocol-v1`
- public external API / SDK stability guarantees remain intentionally postponed

Impact:

- internal worker adapter integration has executable schema and admission gates
- external consumers should not assume public API / SDK compatibility guarantees yet

Desired direction:

- keep Wave 5 explicitly out of “already supported” docs until governance and compatibility policy are finalized

## 7. Repo / branch / session lease guards 已接入 task 生命周期但仍有边界

当前情况：

- `leases.ts` 当前支持 `assignment`、`repo`、`branch`、`session` resource type
- `runtime-state.ts` 将 acquisition/release helper 接入 task claim、start、result、cancel、review decision 和 worker offline 路径
- continuation / follow-up 任务会基于 `continueFromTaskId` / `followUpOfTaskId` 获取 session lease
- busy worker heartbeat 会在同一个 state mutation 中续租 active attempt 与 assignment / repo / branch / optional session lease；到期 attempt 不会被 heartbeat 复活

影响：

- dispatcher 管理的 task 生命周期已经有 repo/branch/session lease ownership
- dispatcher 外部脚本直接操作同一 repo、branch 或 Trae session store 仍不受该 lease 保护

期望方向：

- 如果要覆盖 dispatcher 外部脚本，需要新增统一入口或 operator-level lock，而不是误用 runtime task lease

## 8. vNext runtime reliability 目标契约已接入 worker mutation 主链

当前情况：

- `packages/worker-protocol` 提供 Worker Protocol v1、TaskAttempt 和 RuntimeEvent schema；ArtifactBundle 直接重导出 `packages/result-contracts` 的 canonical schema，不再维护第二份定义
- `packages/task-schema` 已接纳当前 dispatcher runtime 使用的 `trae` pool、Task/Worker 扩展字段和 AssignmentPayload 形态
- `packages/worker-protocol` 已提供当前 runtime 事件名到 vNext RuntimeEvent taxonomy 的 normalize helper
- `packages/worker-protocol` 已提供 start/result payload helper，统一第三方 worker adapter 需要回写的 envelope 字段
- dispatcher runtime state 已有 `taskAttempts[]`，SQLite `task_attempts` projection 会保存 synthetic attempt
- dispatcher start/result mutation 已强制完整 v1 envelope，并会拒绝缺少 active attempt、缺字段或携带历史终态 `attemptId` 的 stale result
- start/result admission 现在会在 reconcile 前直接 fence 已到期 attempt；result 还要求同一 worker 持有有效 assignment lease
- `succeeded` / `failed` result 的精确网络重放现在幂等返回原状态；同一 key 若改变 canonical result、PR metadata 或 ArtifactBundle 会明确冲突
- 通用 dispatcher worker start/result 会校验 `protocolVersion`、`traceId` 和 `idempotencyKey` 与 active attempt 一致
- Trae 兼容主链的 `fetch-task` / `start-task` / `submit-result` 已回显并校验 `protocolVersion`、`traceId`、`idempotencyKey`、`attemptId` 和 `leaseToken`
- dispatcher runtime state 已有 `artifactBundles[]`，SQLite `artifact_bundles` projection 会保存 ArtifactBundle 摘要、refs、结构化 trajectory 和可选 retainedContent 正文片段
- reconcile 支持 `maxTaskAttempts` retry policy，默认仍是 2 次 attempt
- task-level `terminationPolicy.maxAttempts`、`attemptLeaseTimeoutMs`、`heartbeatTimeoutMs`、`assignmentTimeoutMs` 已接入 retry / lease / offline / assignment 回收主链
- review material 已强制绑定 canonical attempt / ArtifactBundle / 可选 commit freshness tuple；Console、orchestrator CLI 与兼容 review CLI 必须携带 `expectedFreshness`，dispatcher 拒绝所有 unfenced / stale decision，并把实际审查 tuple 写入 evidence/event；旧状态必须重新执行或 redrive，不保留兼容决策路径
- HITL 已有 dispatcher 级 `waiting_for_input` / `resumePayload` 协议；HTTP interrupt/resume 和 worker result `waitingForInput` 都会释放 worker / lease、checkpoint active attempt，并以 request/attempt identity、可选 session/expiry fence resume

影响：

- 代码审查和文档阅读时容易把 vNext 目标契约误读为当前已执行的 runtime 保护
- 空 envelope / 无 active attempt 的 worker mutation 已被拒绝，历史夹具或迁移脚本必须先补 claim / attempt 语义
- ArtifactBundle 已支持结构化 `trajectory` 和受限 `retainedContent`，dispatcher 会把 `result.json`、trajectory / retained diff / log / test result 写入本地 artifact store，生成真实 bundle refs，并同时生成 `trajectory.json` 与 `trajectory.traj` 回放文件；retention 删除正文时会同步裁剪 runtime bundle index；generic Codex/Gemini assignment runner 已在 `worker-result.json` 内主动产出 preflight / action / verification / result trajectory 和 retained logs / test results，Trae automation worker 的成功与失败 submitResult 路径也会把当前 task 的真实 phase events 映射进同类 trajectory 和 retained logs / test results
- Console 任务详情可通过摘要 / 引用 / 正文 / 轨迹 tabs 查看审查证据，runtime events 默认展示最新 10 条摘要、支持按 event type 筛选并可展开完整列表，Artifact Review Workbench 也会跨任务展示 runtime event type 聚合、trajectory action / observation / command 搜索、跨任务轨迹并排详情、全文搜索和按事件类型筛选，轨迹 tab 与 Workbench 轨迹并排详情均支持从 step `artifactRef` 直接展开或下载对应观察文件；失败面板会按时间归一 worker result、attempt 与 delivery/runtime event，并为可恢复的 failed / blocked-rework 任务提供 dispatcher-authoritative redrive 操作；任务处于 `review` 状态时可直接提交带 `reasonCode`、`mustFix[]`、重驱动策略和高风险确认的 `merge` / `rework` / `block` 决策；Console 审查队列支持对多个 `review` 任务批量提交共享证据的 `merge` / `rework` / `block` 决策，批量 merge 会要求确认已选高风险任务，批量提交结果会在队列内展示成功数和逐项 taskId / error 明细；审查队列也会单独列出 `waiting_for_input` 任务供点击定位；`waiting_for_input` 任务可在 Console 详情页按 `resumePayloadSchema` 提交结构化恢复输入，未提供 schema 时保留 JSON fallback；任务详情会展示 task-level `terminationPolicy`，让 reviewer 直接看到 maxAttempts、attempt lease、heartbeat 和 assignment timeout
- HITL 当前已接通 dispatcher 状态语义、worker 主动 `waitingForInput`、Console schema 驱动 resume payload 编辑、dispatcher resume API schema 与 identity 校验、幂等重放和 beta runtime assignment package 消费；`resumePayloadSchema` 已支持 `string` / `number` / `integer` / `boolean` / `array`、textarea、范围和数组数量校验，Console 会在页面内展示校验文案，Codex / Gemini worker prompt 已写入共享 schema 子集约束

期望方向：

- Console refs tab 和 trajectory step artifactRef 已支持 manifest 文件按需展开和下载，trajectory tab 已支持当前 bundle 内的 step 前后回放；Artifact Review Workbench 已支持跨任务 artifact 筛选、runtime event 搜索、trajectory action / observation / command 搜索、review reasonCode / risk / mustFix / artifact ref 证据联动、runtime event type / reasonCode / risk 计数对比摘要、轨迹步骤摘要、跨任务轨迹并排详情及其 step artifactRef 展开 / 下载、差异高亮、证据并排详情和卡片级 `artifact://...` 引用复制 / 展开 / 下载，并可跳转到对应任务；审查队列已支持批量 `merge` / `rework` / `block`

## 9. Shadow path has drift gate, reconciliation, cutover drill, approval gate, and guarded primary cutover

Current situation:

- `saveRuntimeState()` writes SQLite snapshot/projection first
- Postgres / queue shadow sync runs asynchronously
- `runtime-state-shadow.ts:readRuntimeStateShadowWriteStatus` exposes last shadow attempt status through `/api/dr/status`
- shadow write status is also persisted to `runtime-state-shadow-status.json`
- backup / restore scripts include `runtime-state-shadow-status.json`
- backup / restore scripts include `shadow-reconciler-status.json`
- backup / restore scripts include `shadow-cutover-drill.json`
- backup / restore scripts include `shadow-cutover-approval.json`
- backup / restore scripts include `shadow-cutover-ready.json`
- backup / restore scripts include `shadow-cutover-revocation.json`
- shadow write failures now append `shadow_write_failed` system events and feed metrics / SLO; the failure recorder reads the latest committed snapshot, deduplicates, appends, and refreshes the structured projection inside one SQLite `BEGIN IMMEDIATE` transaction, so an async failure callback cannot publish an older snapshot over a concurrent committed business update
- `scripts/check-shadow-drift.mjs` compares SQLite expected counts with Postgres projection / queue shadow counts
- `scripts/check-shadow-drift.mjs --max-mismatches <n> --max-delta <n>` emits a stable `alert` summary with `none` / `warning` / `critical` levels; rollout / release environments can also set `DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES` and `DISPATCHER_SHADOW_DRIFT_MAX_DELTA`
- `scripts/check-shadow-drift.mjs <stateDir> --reconcile` replays current SQLite truth into the configured shadow projection / queue and checks drift again
- `scripts/check-shadow-drift.mjs <stateDir> --record-alert` appends a `shadow_drift_detected` system event when drift is present; it shares `.runtime-state.lock` with dispatcher mutations and reloads the latest state inside the lock, so concurrent local writers do not overwrite one another
- `DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE=1`, `pnpm verify:shadow-drift:reconcile`, and long-running `pnpm verify:shadow-drift:reconciler` provide explicit automatic reconciliation cadence hooks without changing the default read-only gate; root reconciler scripts now write `.forgeflow-dispatcher/shadow-reconciler-status.json` as a durable `shadow-reconciler-status/v1` latest-run snapshot for production monitors; `pnpm verify:shadow-cutover:reconciler` runs the same reconciler with `--require-configured --require-primary-backend --max-mismatches 0 --max-delta 0` for strict production cutover window 巡检
- `pnpm verify:shadow-cutover` is a strict production cutover preflight: shadow must be configured and zero-drift under `--max-mismatches 0 --max-delta 0`, and the primary backend must be configured as `RUNTIME_STATE_BACKEND=postgres` with `DISPATCHER_PRIMARY_POSTGRES_URL`
- `pnpm verify:shadow-cutover:drill` runs drift gate, explicit reconcile + alert recording, and strict cutover preflight as one production rehearsal command; `pnpm verify:shadow-cutover:drill:evidence` writes the same phase payload to `.forgeflow-dispatcher/shadow-cutover-drill.json`
- `pnpm verify:shadow-cutover:approve` validates archived drill evidence and writes `.forgeflow-dispatcher/shadow-cutover-approval.json`
- `pnpm verify:shadow-cutover:approval` independently verifies the approval marker, archived evidence SHA-256, and absence of `.forgeflow-dispatcher/shadow-cutover-revocation.json`
- `pnpm verify:shadow-cutover:ready` combines strict cutover preflight and approval evidence verification into the final pre-switch gate
- `pnpm verify:shadow-cutover:ready:evidence` archives that final pre-switch gate payload to `.forgeflow-dispatcher/shadow-cutover-ready.json`
- `pnpm verify:shadow-cutover:complete` verifies post-switch readiness evidence, selected Postgres primary backend, and readable `dispatcher_runtime_state` primary snapshot
- `pnpm verify:shadow-cutover:complete:evidence` archives that post-switch verification to `.forgeflow-dispatcher/shadow-cutover-complete.json`
- Postgres primary backend refuses to connect unless `shadow-cutover-ready.json` exists, has `ok=true`, records a passed `strict_cutover_preflight`, and has `approval_evidence` matching the approval marker path, drill evidence path, and SHA-256
- `pnpm verify:shadow-cutover:revoke` archives the approval marker and writes `.forgeflow-dispatcher/shadow-cutover-revocation.json` for rollback / aborted change windows
- `RUNTIME_STATE_BACKEND=postgres` refuses primary snapshot load/save until `shadow-cutover-approval.json` exists, has `approved=true`, records `cutoverReason=cutover_ready`, points to archived drill evidence through `evidencePath`, the current evidence file SHA-256 matches `evidenceSha256`, and `shadow-cutover-ready.json` confirms the final strict preflight + approval evidence gate; it also refuses primary snapshot load/save when `shadow-cutover-revocation.json` exists
- `DISPATCHER_SHADOW_MODE=primary` is accepted only as a post-cutover compatibility state when `RUNTIME_STATE_BACKEND=postgres` and `DISPATCHER_PRIMARY_POSTGRES_URL` are configured; without that primary backend it fails as `primary_backend_not_selected`
- `@forgeflow/dispatcher-store-postgres` now has primary snapshot primitives (`dispatcher_runtime_state`, JSONB load/save), and dispatcher HTTP routes plus `/api/query/*` use the async runtime-state path for state mutations / reads
- `/api/dr/status.primaryCutover` now summarizes approval marker, final ready evidence, post-cutover completion evidence, revocation marker, primary backend selection, and evidence mismatch failures for Console / operator review; completed status requires completion evidence to bind to the current approval marker and archived drill evidence hash
- `pnpm verify:stage3` 和 release workflow 都会执行 `pnpm verify:shadow-drift` 作为 rollout / release gate

Impact:

- process restart keeps both the last shadow health record and runtime event history
- shadow alert recording is serialized with local dispatcher state mutations; this file lock does not coordinate independent hosts
- shadow-write rollout / release 已有 drift gate、阈值告警摘要、显式自动 reconciliation cadence hook、长期 reconciler 入口、默认 reconciler durable status snapshot、strict cutover reconciler 模式、strict cutover preflight、production cutover drill、cutover evidence file、primary approval marker、approval marker 独立校验、最终 ready 组合门禁、post-cutover completion evidence、ready evidence primary backend guard、rollback revocation marker、Postgres primary snapshot 原语、primary-mode 兼容状态、HTTP route async state path 和 `/api/query/*` Postgres primary snapshot reads；真实生产执行仍需要 operator 在变更窗口切换 `RUNTIME_STATE_BACKEND=postgres` / `DISPATCHER_PRIMARY_POSTGRES_URL` 并保留 evidence
- Console 首屏已展示 `/api/dr/status` 的 shadow write、shadow reconciler 运行次数 / 更新时间 / 最近一轮 reconciliation request-attempt-reason 证据、primary cutover / completion evidence、projection、backup、read-only 和 structured reads 摘要，reviewer 可以在同一工作台看到 cutover 前后轻量状态

Desired direction:

- require `pnpm verify:shadow-cutover:drill:evidence`, `pnpm verify:shadow-cutover:approve`, `pnpm verify:shadow-cutover:approval`, and `pnpm verify:shadow-cutover:ready:evidence` before any primary-store switch; require `pnpm verify:shadow-cutover:complete:evidence` after the primary switch has written a Postgres snapshot; retain `.forgeflow-dispatcher/shadow-cutover-drill.json`, `.forgeflow-dispatcher/shadow-cutover-approval.json`, `.forgeflow-dispatcher/shadow-cutover-ready.json`, and `.forgeflow-dispatcher/shadow-cutover-complete.json` as change evidence; use `pnpm verify:shadow-cutover:revoke` to retain rollback evidence when aborting or reverting a cutover window
- keep the event / metric / SLO contract stable while shadow remains best-effort

## 10. Live dispatcher DR drill covers local failure scenarios, but production cutover is still deferred

Current situation:

- `scripts/verify-stage3-dr.mjs` creates a real SQLite `runtime-state.db`
- it writes multiple `snapshots` rows while the SQLite connection remains open in WAL mode
- source scripts and the packaged dispatcher CLI now share one backup / restore core instead of maintaining duplicate file-copy implementations
- backup / restore serializes with dispatcher mutations through `.runtime-state.lock`; v1 manifests record file sizes, SHA-256 values, and a validated SQLite snapshot watermark
- restore verifies the complete manifest before changing the target, stages every file, rolls back on apply failure, and removes stale runtime files that are absent from the backup
- it verifies that backup / restore includes `runtime-state.db-wal`, then validates `PRAGMA integrity_check`, snapshot count, latest sequence, and checksum
- `scripts/verify-live-dispatcher-dr.mjs` starts a real dispatcher HTTP server, writes through live endpoints, backs up while the server is still open, then restores and validates SQLite integrity
- the live drill also starts a dispatcher child process, writes / backs up during live traffic, kills it with `SIGKILL`, restores the backup into a second state directory, and restarts dispatcher against the restored state
- the live drill treats writes acknowledged before backup as the local RPO floor, records local recovery duration, and verifies a post-recovery write survives a second restart
- the live drill corrupts the current runtime SQLite files before restore and verifies the restored database passes `PRAGMA integrity_check`
- the live drill restores the same backup into two independent state directories, starts both dispatchers, and checks task / event counts plus the complete runtime-state SHA-256 stay consistent

Impact:

- `pnpm verify:stage3` proves the shared source/package backup core, verified manifest, WAL-backed restore, and restored SQLite queryability
- `pnpm verify:stage3:live` proves the live dispatcher HTTP write path, acknowledged-write RPO floor, measured local recovery, post-recovery write persistence, WAL restore, SIGKILL replacement recovery, local disk-corruption restore, and two-node state-hash consistency can be exercised locally
- it is not yet a full production exercise for physical power loss, quorum fencing, DNS cutover, or cross-host storage failure

Desired direction:

- keep the source DR script as the fast gate and run the live drill before risky runtime releases
- archive drill output in the production release system when production rollout evidence becomes mandatory
- add real cross-host failover, quorum restore, and cutover runbooks if production RTO / RPO requirements tighten

## 11. Release is PR-first; exceptional post-publish recovery remains operator-driven

Current situation:

- local `release-package.js` defaults to preview and only changes the target manifest version when `--prepare` is explicit
- every release version enters protected `main` through a normal pull request; the workflow has no manual dispatch path and never pushes to `main`
- the resulting package manifest push auto-detects an exact version missing from npm, then publishes one prepared tarball through Trusted Publishing
- npm publishing uses `contents: read` plus `id-token: write`; a separate `contents: write` job records an idempotent tag only after publish and registry verification succeed
- if npm accepts the immutable version but later registry verification, provider smoke, or tag recording fails, the workflow writes a recovery summary and the operator must reconcile that exact version

Impact:

- normal releases no longer need a post-publish commit recovery or a protected-branch bypass
- exceptional failures after `npm publish` still require checking registry metadata before rerunning verification or the tag job

Desired direction:

- keep the release runbook recovery path current
- keep publish and tag permissions separated
- consider a dedicated verification-only repair workflow only if post-publish verification failures become common

## 12. 确定性候选打分原语已落地，但并行竞争执行仍 deferred

当前情况：

- `apps/dispatcher/src/modules/server/candidate-scoring.ts` 提供确定性、可解释的候选打分 / 排序原语（`scoreCandidate` / `rankCandidates`），打分输入为验证状态、改动规模、测试文件数和受保护路径命中，与 review-risk 共用受保护路径 glob，不使用 LLM 裁判。
- 该原语只对“已经产出”的候选结果排序，可用于排序 redrive attempt 或外部收集的候选集合。

影响：

- 容易把“能给候选打分”误读为“dispatcher 已支持同任务多 worker 并行竞争执行”。
- 当前 Trae-first 主链仍是单任务串行 runtime，dispatcher 每个任务只绑定一个 worker / assignment。

期望方向：

- 真正的 competitive 执行（同任务多 worktree 并行、择优合并）需要在 codex/gemini worker 主线解封后单独设计 assignment / 并发模型，不应在当前 Trae-first 单串行约束下强行接入。
- 在那之前，打分原语保持为纯函数库，供控制层或后续竞争选择路径复用。

## 13. codex/gemini 解封：pool 契约 / gemini 包 / runtime daemon 去重已落地，剩余发布边界仍需外部配置

当前情况：

- worker pool 契约已统一为通用 string（`apps/dispatcher/src/modules/runtime/types.ts`、`tasks/service.ts`、`dispatch/service.ts`、`workers/service.ts`），与 `runtime-state.ts` 既有 string 对齐；`task-schema` 的 `WorkerPoolSchema(codex|gemini|trae)` 作为校验边界保留。
- gemini 已有对等远程运行时包 `@tingrudeng/gemini-beta-runtime`（镜像 codex-beta-runtime），与 codex/trae 三者在“远程 worker 运行时包”层面并列。
- generic worker daemon 现在会上报 `progress_reported` 运行阶段事件（worktree_prepared / execution_completed），与 Trae 的进度可观测性对齐。
- `scripts/lib/worker-daemon.ts`、dispatcher runtime-glue 和 packaged Codex/Gemini runtime 已共用 `packages/beta-runtime-core/src/runtime/worker-daemon-cycle.ts` 的 register / heartbeat / claim / start / completed submitResult retry 主循环；dispatcher HTTP / state-dir client plumbing 保留在 `apps/dispatcher/src/modules/server/runtime-glue-dispatcher-client.ts`，dispatcher 侧 shared cycle adapter 已拆到 `apps/dispatcher/src/modules/server/runtime-glue-worker-daemon-cycle.ts`。worktree、child worker execution、Codex/Gemini launch builder、commit/push、PR 创建、cleanup live executor、执行期 managed heartbeat / metrics hooks 和失败 fallback result 已下沉到 `packages/beta-runtime-core/src/runtime/*`；dispatcher / beta runtime dist bootstrap 与 assignment runtime factory freshness 检查已收敛到 `scripts/lib/runtime-bootstrap.ts`，脚本侧本地 logger / metrics hook 组装已拆到 `scripts/lib/worker-daemon-hooks.ts`，dispatcher client adapter 已拆到 `scripts/lib/worker-daemon-dispatcher-client.ts`，task executor adapter 已拆到 `scripts/lib/worker-daemon-task-executor.ts`，公开类型已拆到 `scripts/lib/worker-daemon-types.ts`。

已完成的收口：

- **Codex / Gemini provider-neutral execution profile 已落地**：`@tingrudeng/beta-runtime-core` 统一拥有 `trusted-host` / `isolated-container` profile，provider 与 verification 共用固定镜像、只读 root、受限 tmpfs、最小 provider secret、CPU / memory / PID 上限和 fail-closed runtime / image preflight；managed worker 使用非敏感 policy id 阻止旧进程跨策略复用。已删除无运行时调用的 `scripts/lib/worker-daemon-helpers.*` 与对应旧测试，避免脚本侧重新形成第二套 env / command helper。剩余安全边界是标准 Docker `bridge` 不提供域名级 egress allowlist，也不是 microVM；更强隔离需要独立 sandbox runtime 或网络代理。
- **`scripts/lib` 构建可重建已修复（P0 完成）**：`scripts/lib/review-memory.ts` 的 type-only re-export 改从 `apps/dispatcher/dist` 的 `.d.ts` 取（消除 rootDir 违规），`worker-daemon.ts` 的 `startTime` 已提到 try 外（修复 latent ReferenceError），`scripts/lib/tsconfig.json` 改为非严格并排除 `*.test.ts`。现在 `tsc -p scripts/lib/tsconfig.json` 可干净、幂等地 emit；committed `.js` 已与 `.ts` 对齐（含此前缺失从未提交的 `logger.js` / `metrics.js` / `dispatcher-auth.js` 运行时依赖）。CI 新增 `Verify scripts/lib build is in sync` 步骤（`tsc` + `git diff --exit-code`）防止再次漂移。`.ts` 现在是真相源。
- **daemon 主循环、worker CLI、dispatcher client、assignment runner、launch builder、managed executor、live executor 与失败回写已收敛到共享 runtime core（P2 主体完成）**：`packages/beta-runtime-core/src/runtime/worker-daemon-cycle.ts` 是唯一 generic daemon cycle 实现，`scripts/lib/worker-daemon.ts`、dispatcher `runtime-glue-worker-daemon-cycle.ts` 与 packaged Codex/Gemini runtime 都只做 adapter；completed submitResult retry / delivery_failed 事件由 shared cycle 负责。Trae 的独立 automation worker lifecycle 现在也对齐同一默认重试配置和事件语义：默认 3 次 / 2 秒，支持 AbortSignal，耗尽时抛出明确 delivery error，在 dispatcher 确认终态前不降为 idle、不释放 session，并停止任务轮询、以非零状态退出，避免同一进程重复执行未确认任务。每个 generic task 由 shared cycle 维护一条 single-flight heartbeat，覆盖执行与结果提交重试，脚本 executor 不再重复启动第二条 heartbeat；assignment 子进程默认总超时为 30 分钟，可通过 `WORKER_DAEMON_EXECUTION_TIMEOUT_MS` 调整；SIGINT / SIGTERM / execution timeout 会通过 AbortSignal 取消 dispatcher HTTP 请求和重试等待，并通过 process-group / taskkill 终止完整子进程树。dispatcher HTTP / state-dir client lazy adapter 已拆到 `worker-daemon-dispatcher-client.ts`，claimed task execution / failed result fallback adapter 已拆到 `worker-daemon-task-executor.ts`；`run-worker-assignment` 的 prompt 拼接、verification shell / nvm 包装、执行 timeout、workspace dependency symlink、Codex/Gemini launch builder、worker-result 文件写入已下沉到 `packages/beta-runtime-core/src/runtime/run-worker-assignment.ts` 与 `run-worker-assignment-cli.ts`；provider worker CLI 参数解析、help、pool 校验和 provider binary env wiring 已下沉到 `packages/beta-runtime-core/src/runtime/provider-worker-cli.ts`；worktree / commit / push / PR / cleanup live executor 已下沉到 `executeLiveWorkerTask`；失败 result 构建、落盘、submitResult retry 和 evidence 分类已下沉到 `submitFailedWorkerResult`，重试耗尽会抛出 `WorkerResultDeliveryError`。root `scripts/run-worker-assignment.ts` 只保留 env / CLI wiring，beta-runtime-core dist、dispatcher runtime factory dist 和 src/dist freshness 检查都由 `scripts/lib/runtime-bootstrap.ts` 负责；`@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 只保留 provider 配置型薄入口。
- **全 provider worktree 生命周期已统一（P2 完成）**：Codex、Gemini、Trae、dispatcher 与源码 worker adapter 都复用 `@tingrudeng/beta-runtime-core` 的唯一 task worktree 实现。可取消 Git 命令默认 60 秒超时；有损或过长的 task 目录名会附加稳定短哈希，创建/复用前拒绝危险目录、非法 ref、默认分支、未登记目录、分支占用和 path/branch 错配；复用统一执行 `reset --hard` + `clean -fd`。只有 terminal result 已被 dispatcher 确认且 `FORGEFLOW_WORKER_REMOVE_WORKTREE_ON_EXIT=1` 时才清理，默认不 force、保留脏 worktree，并写失败事件；`FORGEFLOW_WORKER_FORCE_WORKTREE_CLEANUP=1` 是显式破坏性 opt-in。
- **runtime 包发布清单门禁已落地（P2 完成）**：`pnpm verify:runtime-packages` 会校验 `automation-gateway-core`、`beta-runtime-core`、`codex-beta-runtime`、`gemini-beta-runtime`、`trae-beta-runtime` 的 public package 元数据、`dist`/README/PUBLISHING 发布范围、build/typecheck/test 脚本、provider CLI bin 和源码内 `workspace:*` 依赖重写规则；CI 与 release workflow 都会执行该门禁。生产发布窗口可执行 `pnpm verify:runtime-packages:published`，用只读 `npm view` 强制校验 npm registry 包名、当前本地版本和已发布依赖元数据；该检查会把源码内 `workspace:*` 依赖转换为本地 workspace 版本后，与已发布包的 `dependencies` 对比，避免远端安装包仍停留在旧依赖形态。
- **runtime tarball 安装 smoke 已落地（P2 完成）**：`pnpm verify:runtime-packages:install` 会构建并本地 staging `codex`、`gemini`、`trae` runtime 组，重写 `workspace:*` 依赖为本地 workspace 版本，使用临时 npm cache 执行 `npm pack` / `npm install --ignore-scripts`，并校验 provider CLI bin 安装成功、安装后的 package 不含 `workspace:*` 依赖。CI 与 release workflow 都会执行该门禁，证明发布前 tarball 形态可安装且不依赖外部 registry。
- **release preflight 会提前阻断未配置包名和未发布 workspace 依赖（P2 完成）**：版本 PR 合入 `main` 后，`release-publish-preflight.mjs --require-package-exists --require-version-available --require-published-workspace-deps` 会在 typecheck / test / build / publish 前执行只读 registry 查询，并把当前 package.json 的 `workspace:*` 依赖解析为本地 workspace 版本后校验对应精确版本已发布。包名不存在、目标版本已占用、权限不足、registry 查询失败或 provider 依赖的 shared core 版本未发布时，workflow 会停在 preflight，避免在 `npm publish` PUT 阶段或发布后 smoke 才暴露依赖缺口。
- **runtime 包设置报告已落地（P2 完成）**：`pnpm report:runtime-packages:setup` 复用同一份 runtime package spec，只读查询 npm registry，输出每个包名、当前源码版本、package/version 发布状态、推荐发布顺序和 Trusted Publisher 配置要求；需要把缺口作为硬失败时可加 `-- --require-ready`。
- **已发布 provider runtime smoke 已落地（P2 完成）**：`pnpm verify:runtime-packages:published-smoke` 会从 npm registry 安装当前源码版本的 `codex`、`gemini`、`trae` provider runtime，并校验 provider CLI bin、`--version` 和 `--help`；该命令要求所有 provider 包名和版本都已发布，适合作为发布后远端安装证据入口。
- **GitHub Actions 与精确 npm tarball 发布链已加固（P1 完成）**：CI、Release、Stage3 Drill 和 Release Scorecard 的第三方 action 已固定到完整 commit SHA；CI / drill 使用显式只读权限，正式发布共用仓库级 concurrency group，并把 publish 绑定到 detect commit 与 package version。版本变化先通过 PR 进入受保护 `main`，本地 `release-package` helper 默认只预览，显式 `--prepare` 只修改目标 manifest 的版本字段；merge push 自动触发发布，workflow 不写 `main`。远端 `main` 会在紧邻 publish 前和发布后各校验一次，竞态漂移会失败并留下恢复证据。`scripts/prepare-release-tarball.mjs` 以 `--ignore-scripts` 生成唯一 tarball 和 manifest，正式链路只发布该文件；`scripts/verify-published-package-tarball.mjs` 随后读取 registry `dist.tarball` / `integrity` / `shasum`，并核对目标 dist-tag、完整文件集、manifest、bin 与安装结果；独立低权限 job 最后记录幂等 release tag。剩余外部边界是各包 npm Trusted Publisher / environment protection 配置，以及 npm 服务端 provenance 签发可用性。
- **Trae launcher clean relaunch 已下沉到共享 core（P2 完成）**：`@tingrudeng/automation-gateway-core` 现在提供 `prepareCleanRelaunch` / `quitExistingMacApp` / `waitForDebuggerPortToDrain` / `resolveMacAppName`，`scripts/run-trae-automation-launch.ts` 和 `@tingrudeng/trae-beta-runtime` 共用同一实现，避免源码调试脚本与 packaged runtime 的 clean relaunch 语义继续漂移。
- **Trae `.app` launch target 解析已下沉到共享 core（P2 完成）**：`@tingrudeng/automation-gateway-core` 现在提供 `resolveMacAppBundleExecutable`，`scripts/lib/trae-launcher.ts` 和 `packages/trae-beta-runtime/src/runtime/trae-launcher.ts` 共用同一实现，避免 macOS `.app` executable 探测规则在源码脚本与 packaged runtime 之间漂移。
- **Trae launch target 构建已下沉到共享 core（P2 完成）**：`@tingrudeng/automation-gateway-core` 现在提供 `parseLaunchArgs`、`hasRemoteDebuggingPortArg` 和 `resolveTraeLaunchTarget`，`scripts/lib/trae-launcher.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-launcher.ts` 共用 launch args、remote debugging port 和 project path 组装规则。
- **Trae launcher wait / spawn 编排已下沉到共享 core（P2 完成）**：`@tingrudeng/automation-gateway-core` 现在提供 `waitForTraeDebugger` 和 `launchTraeForAutomation`，`scripts/lib/trae-launcher.ts` 与 `packages/trae-beta-runtime/src/runtime/trae-launcher.ts` 只注入各自默认 timeout、CDP discovery 和兼容导出。

仍存在的债务：

- `@tingrudeng/gemini-beta-runtime` 与 `@tingrudeng/beta-runtime-core` 的 npm 包名和 Trusted Publisher 已配置；后续发布仍必须按 shared core 在前、provider 在后的版本 PR 顺序进入自动发布矩阵。
- codex/gemini 已是源码内受支持路径，但生产远端部署仍应以已发布包、固定版本和 CI 验证证据为准，不应直接依赖本仓未发布 dist。
- worktree 保留、复用和 ack 后清理策略已经跨 provider 统一；自动删除刻意保持显式 opt-in。Trae automation worker 的 executor / session-store / gateway 仍保留必要的 provider runtime 边界，后续若收敛完整 executor core，应单独评估 session、phase event 和 failure evidence 模型，不再重复实现 worktree 生命周期。

影响：

- codex/gemini 已可作为受支持 worker 接入方式与 Trae 并列；worker-daemon 主循环、worker CLI、dispatcher client、assignment runner、managed executor、live executor、失败回写、dist bootstrap、本地 hook adapter、dispatcher client adapter、dispatcher cycle adapter 和 task executor adapter 边界已对齐到 `@tingrudeng/beta-runtime-core` / runtime-bootstrap / worker-daemon-* adapters。`worker-daemon.ts` 已降为 under-budget thin cycle adapter。
- 任何对 generic worker daemon 的后续改动，应优先扩展 `packages/beta-runtime-core/src/runtime/worker-daemon-cycle.ts` 或对应 executor adapter，而不是重新在脚本侧、dispatcher runtime-glue 或 packaged runtime 内扩写主循环。

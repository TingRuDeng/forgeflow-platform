# forgeflow-platform Technical Debt

Only confirmed, still-active debt belongs here.

## 目的

记录已经确认仍存在、不能被误当成主线完成能力的技术债和迁移边界。

## 适合读者

适合规划阶段修复、代码审查、发布风险评估、文档同步和多 agent 任务拆分时阅读。

## 一分钟摘要

- 本文件只写仍然存在的债务，不写愿望清单。
- 当前债务集中在 runtime bridge、持久化多形态、shadow 可观测性、Trae gateway 重复实现和 Stage 3 边界。
- 近期审查确认 dispatcher 外部资源锁、DR drill 深度和手动发布版本落账仍需后续修复。
- 修复债务时必须同步 `README.md`、`docs/README.md` 和相关稳定文档。

```yaml
ai_summary:
  authority: "已确认仍存在的技术债、影响范围和迁移边界"
  scope: "runtime bridge、persistence、shadow path、Trae gateway、文档系统、Stage 3 deferred 能力"
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

## 1. Dispatcher compatibility wrappers still depend on `apps/dispatcher/dist` freshness

Current situation:

- dispatcher control-plane ownership now lives in `apps/dispatcher/`
- `scripts/lib/dispatcher-server|dispatcher-state|review-memory|task-worktree|review-decision` 只保留 bootstrap / compatibility wrapper
- live entrypoints still depend on checked-in adapters importing `apps/dispatcher/dist`

Impact:

- bootstrap/freshness bugs can still appear at the boundary between source and built `dist`
- compatibility wrappers still add one extra layer for debugging local runtime startup

Desired direction:

- either keep this adapter split explicit and well-tested
- or remove more checked-in wrappers once all supported entrypoints can run directly from packaged/app-owned runtime modules

## 2. SQLite runtime state, JSON fallback, and schema constants still coexist without one fully consolidated persistence story

Current situation:

- dispatcher runtime state now defaults to SQLite via `runtime-state-sqlite.ts`
- JSON fallback still exists for explicit compatibility mode and import bootstrap
- `apps/dispatcher/src/db/schema.ts` still defines standalone SQLite schema constants that are not the active runtime persistence path

Impact:

- easy to overstate database maturity or assume every persistence path is SQLite-first
- persistence-related changes can still land in the default SQLite backend, the JSON fallback, or the schema constants separately

Desired direction:

- keep the SQLite snapshot backend and JSON fallback explicitly documented, or further consolidate the remaining duplicate persistence representations
- decide whether `apps/dispatcher/src/db/schema.ts` should survive as a compatibility constant set now that runtime SQLite + structured projection tables are the live path

## 3. Postgres / queue shadow path exists, but external stores are not primary yet

Current situation:

- dispatcher now has query-first SQLite projection tables
- optional Postgres / queue shadow write also exists
- SQLite snapshots remain the truth source

Impact:

- external drift detection and rollout discipline still matter
- it is easy to overstate stage-3 maturity as “already migrated to Postgres”

Desired direction:

- keep shadow mode / primary mode boundaries explicit
- add stronger drift reporting and eventual cutover / rollback discipline before any primary-store switch

## 4. Trae automation gateway handler、HTTP server 和 session-store 已共享，剩余债务集中在外部 adapter 层

已确认情况：

- `@tingrudeng/automation-gateway-core` 已提供共享 `handleAutomationGatewayRequest`，统一处理 `GET /ready`、session 查询 / release / prepare 和 `POST /v1/chat`
- `@tingrudeng/automation-gateway-core` 已提供共享 `startAutomationGatewayHttpServer`，统一处理 Node HTTP server、JSON body 读取、错误响应和 server close
- `@tingrudeng/automation-gateway-core` 已提供共享 `createPersistentAutomationSessionStore`，统一处理 session 持久化、重启中断、TTL 清理、request fingerprint / target 解析和 public shape 裁剪
- 脚本侧 `scripts/lib/trae-automation-gateway.ts` 与 packaged runtime `packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts` 都已委托共享 handler 和共享 HTTP server adapter，只保留 debug logger 与 driver adapter
- 脚本侧 `scripts/lib/trae-automation-session-store.ts` 与 packaged runtime `packages/trae-beta-runtime/src/runtime/trae-automation-session-store.ts` 都已委托共享 session-store，只保留默认目录、时间格式和类型兼容薄适配
- 脚本侧已经对齐 packaged runtime 的持久化 session 解析、`POST /v1/chat` 元数据透传和结构化 debugLog 关键事件
- packaged runtime 已补齐脚本侧 `POST /v1/chat` 的 completed-session cache、running-session conflict、request fingerprint conflict、progress touch 和 soft-timeout 保持 running 语义

影响：

- 默认 session-store 路径、持久化解析和 chat 调用关键行为已经对齐
- route / session / chat 语义、HTTP JSON IO 和持久化 session-store 已经集中到共享 core；后续 handler、request IO 或 session 文件语义修复不应再分别修改脚本侧和 packaged runtime
- 剩余漂移风险主要来自 adapter 层：debug logger 组装、driver 创建和发布前 dist / workspace 依赖同步

期望方向：

- 后续继续收敛 adapter 层，优先把 debug logger 和 driver 创建归一化为共享小模块，而不是重新在两侧扩写 route handler、HTTP request IO 或 session-store 逻辑

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

影响：

- dispatcher 管理的 task 生命周期已经有 repo/branch/session lease ownership
- dispatcher 外部脚本直接操作同一 repo、branch 或 Trae session store 仍不受该 lease 保护

期望方向：

- 如果要覆盖 dispatcher 外部脚本，需要新增统一入口或 operator-level lock，而不是误用 runtime task lease

## 8. vNext runtime reliability 目标契约已接入 worker mutation 主链

当前情况：

- `packages/worker-protocol` 提供 Worker Protocol v1、TaskAttempt、RuntimeEvent 和 ArtifactBundle 的目标 schema
- `packages/task-schema` 已接纳当前 dispatcher runtime 使用的 `trae` pool、Task/Worker 扩展字段和 AssignmentPayload 形态
- `packages/worker-protocol` 已提供当前 runtime 事件名到 vNext RuntimeEvent taxonomy 的 normalize helper
- `packages/worker-protocol` 已提供 start/result payload helper，统一第三方 worker adapter 需要回写的 envelope 字段
- dispatcher runtime state 已有 `taskAttempts[]`，SQLite `task_attempts` projection 会保存 synthetic attempt
- dispatcher start/result mutation 已强制完整 v1 envelope，并会拒绝缺少 active attempt、缺字段或携带历史终态 `attemptId` 的 stale result
- 通用 dispatcher worker start/result 会校验 `protocolVersion`、`traceId` 和 `idempotencyKey` 与 active attempt 一致
- Trae 兼容主链的 `fetch-task` / `start-task` / `submit-result` 已回显并校验 `protocolVersion`、`traceId`、`idempotencyKey`、`attemptId` 和 `leaseToken`
- dispatcher runtime state 已有 `artifactBundles[]`，SQLite `artifact_bundles` projection 会保存 ArtifactBundle 摘要、refs、结构化 trajectory 和可选 retainedContent 正文片段
- reconcile 支持 `maxTaskAttempts` retry policy，默认仍是 2 次 attempt
- task-level `terminationPolicy.maxAttempts`、`attemptLeaseTimeoutMs`、`heartbeatTimeoutMs`、`assignmentTimeoutMs` 已接入 retry / lease / offline / assignment 回收主链
- HITL 已有 dispatcher 级 `waiting_for_input` / `resumePayload` 基础协议，HTTP interrupt/resume 和 worker result `waitingForInput` 都会释放 worker / lease 并 checkpoint active attempt

影响：

- 代码审查和文档阅读时容易把 vNext 目标契约误读为当前已执行的 runtime 保护
- 空 envelope / 无 active attempt 的 worker mutation 已被拒绝，历史夹具或迁移脚本必须先补 claim / attempt 语义
- ArtifactBundle 已支持结构化 `trajectory` 和受限 `retainedContent`，dispatcher 会把 trajectory / retained diff / log / test result 写入本地 artifact store，并通过 manifest、retention 和 `/api/artifacts/:bundleId/files/:fileName` 支持按需读取
- Console 任务详情可通过摘要 / 引用 / 正文 / 轨迹 tabs 查看审查证据，轨迹 tab 支持按步骤前后回放结构化 step，并可从当前 step 的 `artifactRef` 直接展开或下载对应观察文件；任务处于 `review` 状态时可直接提交带 `reasonCode`、`mustFix[]`、重驱动策略和高风险确认的 `merge` / `rework` / `block` 决策；Console 审查队列支持对多个 `review` 任务批量提交共享证据的 `merge` / `rework` / `block` 决策，批量 merge 会要求确认已选高风险任务，批量提交结果会在队列内展示成功数和逐项 taskId / error 明细；审查队列也会单独列出 `waiting_for_input` 任务供点击定位；`waiting_for_input` 任务可在 Console 详情页按 `resumePayloadSchema` 提交结构化恢复输入，未提供 schema 时保留 JSON fallback
- HITL 当前已接通 dispatcher 状态语义、worker 主动 `waitingForInput`、Console schema 驱动 resume payload 编辑和 beta runtime assignment package 消费；`resumePayloadSchema` 已支持 `string` / `number` / `integer` / `boolean` / `array`、textarea、范围和数组数量校验，Console 会在页面内展示校验文案，Codex / Gemini worker prompt 已写入共享 schema 子集约束

期望方向：

- Console refs tab 和 trajectory step artifactRef 已支持 manifest 文件按需展开和下载，trajectory tab 已支持当前 bundle 内的 step 前后回放；Artifact Review Workbench 已支持跨任务 artifact 筛选、review reasonCode / risk / mustFix 证据联动、reasonCode / risk 计数对比摘要、差异高亮、跨任务并排详情，并可跳转到对应任务；审查队列已支持批量 `merge` / `rework` / `block`

## 9. Shadow path has drift gate, reconciliation, cutover drill, and approval gate, but external primary ops remain deferred

Current situation:

- `saveRuntimeState()` writes SQLite snapshot/projection first
- Postgres / queue shadow sync runs asynchronously
- `runtime-state-shadow.ts:readRuntimeStateShadowWriteStatus` exposes last shadow attempt status through `/api/dr/status`
- shadow write status is also persisted to `runtime-state-shadow-status.json`
- backup / restore scripts include `runtime-state-shadow-status.json`
- backup / restore scripts include `shadow-cutover-approval.json`
- backup / restore scripts include `shadow-cutover-revocation.json`
- shadow write failures now append `shadow_write_failed` system events and feed metrics / SLO
- `scripts/check-shadow-drift.mjs` compares SQLite expected counts with Postgres projection / queue shadow counts
- `scripts/check-shadow-drift.mjs --max-mismatches <n> --max-delta <n>` emits a stable `alert` summary with `none` / `warning` / `critical` levels; rollout / release environments can also set `DISPATCHER_SHADOW_DRIFT_MAX_MISMATCHES` and `DISPATCHER_SHADOW_DRIFT_MAX_DELTA`
- `scripts/check-shadow-drift.mjs <stateDir> --reconcile` replays current SQLite truth into the configured shadow projection / queue and checks drift again
- `scripts/check-shadow-drift.mjs <stateDir> --record-alert` can append a `shadow_drift_detected` system event when drift is present
- `DISPATCHER_SHADOW_DRIFT_AUTO_RECONCILE=1` and `pnpm verify:shadow-drift:reconcile` provide an explicit automatic reconciliation cadence hook without changing the default read-only gate
- `pnpm verify:shadow-cutover` is a strict production cutover preflight: shadow must be configured and zero-drift under `--max-mismatches 0 --max-delta 0`, and the primary backend must be configured as `RUNTIME_STATE_BACKEND=postgres` with `DISPATCHER_PRIMARY_POSTGRES_URL`
- `pnpm verify:shadow-cutover:drill` runs drift gate, explicit reconcile + alert recording, and strict cutover preflight as one production rehearsal command; `pnpm verify:shadow-cutover:drill:evidence` writes the same phase payload to `.forgeflow-dispatcher/shadow-cutover-drill.json`
- `pnpm verify:shadow-cutover:approve` validates archived drill evidence and writes `.forgeflow-dispatcher/shadow-cutover-approval.json`
- `pnpm verify:shadow-cutover:revoke` archives the approval marker and writes `.forgeflow-dispatcher/shadow-cutover-revocation.json` for rollback / aborted change windows
- `RUNTIME_STATE_BACKEND=postgres` refuses primary snapshot load/save until `shadow-cutover-approval.json` exists, has `approved=true`, records `cutoverReason=cutover_ready`, and includes a drill evidence SHA-256; it also refuses primary snapshot load/save when `shadow-cutover-revocation.json` exists
- `DISPATCHER_SHADOW_MODE=primary` is still explicitly rejected as `primary_store_not_implemented`; it is not the primary-store switch
- `@forgeflow/dispatcher-store-postgres` now has primary snapshot primitives (`dispatcher_runtime_state`, JSONB load/save), and dispatcher HTTP routes plus `/api/query/*` use the async runtime-state path for state mutations / reads
- `pnpm verify:stage3` 和 release workflow 都会执行 `pnpm verify:shadow-drift` 作为 rollout / release gate

Impact:

- process restart keeps both the last shadow health record and runtime event history
- shadow-write rollout / release 已有 drift gate、阈值告警摘要、显式自动 reconciliation cadence hook、strict cutover preflight、production cutover drill、cutover evidence file、primary approval marker、rollback revocation marker、primary-mode 硬拒绝、Postgres primary snapshot 原语、HTTP route async state path 和 `/api/query/*` Postgres primary snapshot reads；真正 primary-store 切换仍需要外部存储运维确认和真实生产变更窗口

Desired direction:

- require `pnpm verify:shadow-cutover:drill:evidence` and `pnpm verify:shadow-cutover:approve` before any primary-store switch, then retain `.forgeflow-dispatcher/shadow-cutover-drill.json` and `.forgeflow-dispatcher/shadow-cutover-approval.json` as change evidence; use `pnpm verify:shadow-cutover:revoke` to retain rollback evidence when aborting or reverting a cutover window
- keep the event / metric / SLO contract stable while shadow remains best-effort

## 10. Live dispatcher DR drill covers local failure scenarios, but production cutover is still deferred

Current situation:

- `scripts/verify-stage3-dr.mjs` creates a real SQLite `runtime-state.db`
- it writes multiple `snapshots` rows while the SQLite connection remains open in WAL mode
- it verifies that backup / restore includes `runtime-state.db-wal`, then validates `PRAGMA integrity_check`, snapshot count, latest sequence, and checksum
- `scripts/verify-live-dispatcher-dr.mjs` starts a real dispatcher HTTP server, writes through live endpoints, backs up while the server is still open, then restores and validates SQLite integrity
- the live drill also starts a dispatcher child process, writes / backs up during live traffic, kills it with `SIGKILL`, restores the backup into a second state directory, and restarts dispatcher against the restored state
- the live drill corrupts the current runtime SQLite files before restore and verifies the restored database passes `PRAGMA integrity_check`
- the live drill restores the same backup into two independent state directories, starts both dispatchers, and checks task / event counts stay consistent

Impact:

- `pnpm verify:stage3` proves the source DR script path, WAL-backed restore, and restored SQLite queryability
- `pnpm verify:stage3:live` proves the live dispatcher HTTP write path, WAL restore, SIGKILL replacement recovery, local disk-corruption restore, and two-node restore consistency can be exercised locally
- it is not yet a full production exercise for physical power loss, quorum fencing, DNS cutover, or cross-host storage failure

Desired direction:

- keep the source DR script as the fast gate and run the live drill before risky runtime releases
- add real cross-host failover, quorum restore, and cutover runbooks if production RTO / RPO requirements tighten

## 11. Manual release recovery is tracked, but still manual

Current situation:

- `.github/workflows/release.yml` manual path publishes to npm before committing the release version and tag
- if `npm publish` fails, git history no longer advances ahead of npm
- if `npm publish` succeeds but the later commit / tag / push step fails, npm can contain a version that still needs a matching git record
- the workflow writes an Actions summary and opens a recovery issue when that post-publish git record step fails

Impact:

- operators still need to reconcile a published npm version with a missing release commit/tag
- retry or manual git record repair must be explicit to avoid confusing maintainers

Desired direction:

- keep the release runbook recovery path current
- consider an automated repair workflow only if post-publish git record failures become common

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

## 13. codex/gemini 解封：pool 契约 / gemini 包 / 构建可重建已落地，daemon 去重（P2）仍待迁移

当前情况：

- worker pool 契约已统一为通用 string（`apps/dispatcher/src/modules/runtime/types.ts`、`tasks/service.ts`、`dispatch/service.ts`、`workers/service.ts`），与 `runtime-state.ts` 既有 string 对齐；`task-schema` 的 `WorkerPoolSchema(codex|gemini|trae)` 作为校验边界保留。
- gemini 已有对等远程运行时包 `@tingrudeng/gemini-beta-runtime`（镜像 codex-beta-runtime），与 codex/trae 三者在“远程 worker 运行时包”层面并列。
- generic worker daemon 现在会上报 `progress_reported` 运行阶段事件（worktree_prepared / execution_completed），与 Trae 的进度可观测性对齐。
- `scripts/lib/worker-daemon.ts` 的 register / heartbeat / claim / start / completed submitResult 主循环、dispatcher HTTP / state-dir client plumbing 已委托给 `apps/dispatcher/src/modules/server/runtime-glue-dispatcher-client.ts`；worktree、child worker execution、Codex/Gemini launch builder、commit/push、PR 创建、cleanup live executor、执行期 managed heartbeat / metrics hooks 和失败 fallback result 已下沉到 `packages/beta-runtime-core/src/runtime/*`；dispatcher / beta runtime dist bootstrap 与 assignment runtime factory freshness 检查已收敛到 `scripts/lib/runtime-bootstrap.ts`，脚本侧本地 logger / metrics hook 组装已拆到 `scripts/lib/worker-daemon-hooks.ts`，dispatcher client adapter 已拆到 `scripts/lib/worker-daemon-dispatcher-client.ts`，task executor adapter 已拆到 `scripts/lib/worker-daemon-task-executor.ts`，公开类型已拆到 `scripts/lib/worker-daemon-types.ts`。

仍存在的债务：

- **`scripts/lib` 构建可重建已修复（P0 完成）**：`scripts/lib/review-memory.ts` 的 type-only re-export 改从 `apps/dispatcher/dist` 的 `.d.ts` 取（消除 rootDir 违规），`worker-daemon.ts` 的 `startTime` 已提到 try 外（修复 latent ReferenceError），`scripts/lib/tsconfig.json` 改为非严格并排除 `*.test.ts`。现在 `tsc -p scripts/lib/tsconfig.json` 可干净、幂等地 emit；committed `.js` 已与 `.ts` 对齐（含此前缺失从未提交的 `logger.js` / `metrics.js` / `dispatcher-auth.js` 运行时依赖）。CI 新增 `Verify scripts/lib build is in sync` 步骤（`tsc` + `git diff --exit-code`）防止再次漂移。`.ts` 现在是真相源。
- **daemon 主循环、dispatcher client、assignment runner、launch builder、managed executor、live executor 与失败回写已收敛到共享 runtime core（P2 主体完成）**：`scripts/lib/worker-daemon.ts` 已复用 `runtime-glue` 的 `runWorkerDaemonCycle`，completed submitResult retry / delivery_failed 事件由 shared cycle 负责；dispatcher HTTP / state-dir client lazy adapter 已拆到 `worker-daemon-dispatcher-client.ts`，claimed task execution / failed result fallback adapter 已拆到 `worker-daemon-task-executor.ts`；`run-worker-assignment` 的 prompt 拼接、verification shell / nvm 包装、执行 timeout、workspace dependency symlink、Codex/Gemini launch builder、worker-result 文件写入已下沉到 `packages/beta-runtime-core/src/runtime/run-worker-assignment.ts` 与 `run-worker-assignment-cli.ts`；执行期 heartbeat、完成/失败 callbacks 和失败 result 回写已下沉到 `executeManagedWorkerTask`；worktree / commit / push / PR / cleanup live executor 已下沉到 `executeLiveWorkerTask`；失败 result 构建、落盘、submitResult retry 和 evidence 分类已下沉到 `submitFailedWorkerResult`。root `scripts/run-worker-assignment.ts` 只保留 env / CLI wiring，beta-runtime-core dist、dispatcher runtime factory dist 和 src/dist freshness 检查都由 `scripts/lib/runtime-bootstrap.ts` 负责；`@tingrudeng/codex-beta-runtime` / `@tingrudeng/gemini-beta-runtime` 只保留 provider CLI launch wrapper。

影响：

- codex/gemini 已可作为受支持 worker 接入方式与 Trae 并列；worker-daemon 主循环、dispatcher client、assignment runner、managed executor、live executor、失败回写、dist bootstrap、本地 hook adapter、dispatcher client adapter 和 task executor adapter 边界已对齐到共享 runtime core / runtime-bootstrap / worker-daemon-* adapters。`worker-daemon.ts` 已降为 under-budget thin cycle adapter。
- 任何对 generic worker daemon 的后续改动，应优先扩展 `packages/beta-runtime-core` adapter，而不是重新在脚本侧扩写主循环或 live executor。

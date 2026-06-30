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

## 4. Trae automation gateway 仍有重复实现和剩余行为漂移

已确认情况：

- 两套实现都已经暴露 `POST /v1/sessions/:sessionId/release`
- 两套实现都已经在 `POST /v1/sessions/prepare` 中创建会话，并在 prepare 成功后标记为 `running`
- 脚本侧已经对齐 packaged runtime 的持久化 session 解析、`POST /v1/chat` 元数据透传和结构化 debugLog 关键事件

影响：

- 默认 session-store 路径、持久化解析和 chat 调用关键行为已经对齐
- 由于源码脚本与 packaged runtime 仍是两套实现，后续修复仍可能只落到其中一套实现

期望方向：

- 继续减少重复实现，或把共享兼容测试扩展到所有 gateway 关键路由

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
- dispatcher runtime state 已有 `artifactBundles[]`，SQLite `artifact_bundles` projection 会保存 ArtifactBundle 摘要、refs 和可选 retainedContent 正文片段
- reconcile 支持 `maxTaskAttempts` retry policy，默认仍是 2 次 attempt

影响：

- 代码审查和文档阅读时容易把 vNext 目标契约误读为当前已执行的 runtime 保护
- 空 envelope / 无 active attempt 的 worker mutation 已被拒绝，历史夹具或迁移脚本必须先补 claim / attempt 语义
- ArtifactBundle 已支持受限 `retainedContent`，dispatcher 会把 retained diff / log / test result 写入本地 artifact store，并通过 manifest、retention 和 `/api/artifacts/:bundleId/files/:fileName` 支持按需读取
- Console 任务详情可通过摘要 / 引用 / 正文 tabs 查看审查证据，并可在 `review` 状态直接提交 `merge` / `rework` / `block` 决策

期望方向：

- 继续接入 Console 侧 artifact 文件按需展开 / 下载体验，以及更细粒度的 review reason / must-fix 表单

## 9. Shadow path has drift gate and reconciliation entry, but primary cutover is still deferred

Current situation:

- `saveRuntimeState()` writes SQLite snapshot/projection first
- Postgres / queue shadow sync runs asynchronously
- `runtime-state-shadow.ts:readRuntimeStateShadowWriteStatus` exposes last shadow attempt status through `/api/dr/status`
- shadow write status is also persisted to `runtime-state-shadow-status.json`
- backup / restore scripts include `runtime-state-shadow-status.json`
- shadow write failures now append `shadow_write_failed` system events and feed metrics / SLO
- `scripts/check-shadow-drift.mjs` compares SQLite expected counts with Postgres projection / queue shadow counts
- `scripts/check-shadow-drift.mjs --max-mismatches <n> --max-delta <n>` emits a stable `alert` summary with `none` / `warning` / `critical` levels
- `scripts/check-shadow-drift.mjs <stateDir> --reconcile` replays current SQLite truth into the configured shadow projection / queue and checks drift again
- `scripts/check-shadow-drift.mjs <stateDir> --record-alert` can append a `shadow_drift_detected` system event when drift is present
- `pnpm verify:stage3` 和 release workflow 都会执行 `pnpm verify:shadow-drift` 作为 rollout / release gate

Impact:

- process restart keeps both the last shadow health record and runtime event history
- shadow-write rollout / release 已有 drift gate、阈值告警摘要和 operator reconciliation 入口，但仍需要生产阈值演练后才能进入任何 primary-store cutover

Desired direction:

- define production thresholds and automatic reconciliation cadence for persistent drift
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

仍存在的债务：

- **`scripts/lib` 构建可重建已修复（P0 完成）**：`scripts/lib/review-memory.ts` 的 type-only re-export 改从 `apps/dispatcher/dist` 的 `.d.ts` 取（消除 rootDir 违规），`worker-daemon.ts` 的 `startTime` 已提到 try 外（修复 latent ReferenceError），`scripts/lib/tsconfig.json` 改为非严格并排除 `*.test.ts`。现在 `tsc -p scripts/lib/tsconfig.json` 可干净、幂等地 emit；committed `.js` 已与 `.ts` 对齐（含此前缺失从未提交的 `logger.js` / `metrics.js` / `dispatcher-auth.js` 运行时依赖）。CI 新增 `Verify scripts/lib build is in sync` 步骤（`tsc` + `git diff --exit-code`）防止再次漂移。`.ts` 现在是真相源。
- **两套 daemon + 闲置 runtime 抽象未收敛（P2 未完成）**：`scripts/lib/worker-daemon.ts`（重型 live）与 `runtime-glue` 的 `runWorkerDaemonCycle`（可注入轻量）职责重叠；`apps/dispatcher/src/modules/runtime/codex.ts|gemini.ts|assignment.ts` 的干净抽象已支持 model 覆盖 / extraArgs（迁移 step1），但尚未接入 live 启动路径（`run-worker-assignment.ts` 仍内联重写启动逻辑，含 `FORGEFLOW_CODEX_MODEL` 覆盖、nvm-wrapped verification 等硬化行为）。
  - 期望方向：把硬化行为补进 `runtime/*` 抽象，再让 live 启动路径与远程包统一复用，消除重复；可进一步把 generic worker 执行下沉到 `apps/dispatcher/src` + thin bootstrap。这是 P0 已不再阻塞的纯代码整洁度改进，可作为独立后续。

影响：

- codex/gemini 已可作为受支持 worker 接入方式与 Trae 并列；但 worker-daemon 源码的可维护性（构建可重建、单一实现）仍弱于 dispatcher 主链。
- 任何对 generic worker daemon 的后续改动，应优先推进上面的下沉/收敛迁移，而不是继续手改 committed `.js`。

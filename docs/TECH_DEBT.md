# forgeflow-platform Technical Debt

Only confirmed, still-active debt belongs here.

## 目的

记录已经确认仍存在、不能被误当成主线完成能力的技术债和迁移边界。

## 适合读者

适合规划阶段修复、代码审查、发布风险评估、文档同步和多 agent 任务拆分时阅读。

## 一分钟摘要

- 本文件只写仍然存在的债务，不写愿望清单。
- 当前债务集中在 runtime bridge、持久化多形态、shadow 可观测性、Trae gateway 重复实现和 Stage 3 边界。
- 近期审查确认非 assignment lease、DR drill 深度和手动发布版本落账仍需后续修复。
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

## 4. Trae automation gateway has duplicated implementations with behavior drift

Verified drift:

- packaged runtime exposes `POST /v1/sessions/:sessionId/release`
- `scripts/lib/` gateway does not
- default session-store paths differ

Impact:

- docs can overclaim parity
- fixes land in one implementation but not the other

Desired direction:

- reduce duplication or add an explicit sync rule and shared compatibility test coverage

## 5. Stable agent-facing docs were previously concentrated in rule/nav docs but lacked a durable knowledge layer

Impact:

- agents had to infer architecture, persistence, and HTTP boundaries from scattered files
- repeated rediscovery risk was high

Current status:

- partially addressed by the docs added in this pass

Remaining need:

- keep these docs synced whenever runtime boundaries or API surfaces change

## 6. Stage 3 ecosystem wave is intentionally deferred

Current situation:

- stage-3 core platform waves are now in place
- external API / SDK / third-party admission remains intentionally postponed

Impact:

- internal platform maturity is ahead of public integration maturity
- consumers should not assume stable public API/SDK guarantees yet

Desired direction:

- keep Wave 5 explicitly out of “already supported” docs until governance and compatibility policy are finalized

## 7. Repo / branch / session lease guards 仍是后续工作

当前情况：

- `leases.ts` 当前只支持 assignment resource type
- `runtime-state.ts` 将 acquisition/release helper 接入 assignment 执行路径
- repo/branch/session 当前不是活跃 lease resource type

影响：

- repo/branch/session 并发尚未由 dispatcher lease ownership 保护

期望方向：

- 如果 worktree branch 冲突需要 dispatcher 层预防，优先实现具体 branch lease 获取点
- repo/session 语义需要单独定义清楚，再加回 lease type model

## 8. vNext runtime reliability 目标契约尚未接入运行时

当前情况：

- `packages/worker-protocol` 提供 Worker Protocol v1、TaskAttempt、RuntimeEvent 和 ArtifactBundle 的目标 schema
- `packages/task-schema` 已接纳当前 dispatcher runtime 使用的 `trae` pool、Task/Worker 扩展字段和 AssignmentPayload 形态
- `packages/worker-protocol` 已提供当前 runtime 事件名到 vNext RuntimeEvent taxonomy 的 normalize helper
- dispatcher runtime state 已有 `taskAttempts[]`，SQLite `task_attempts` projection 会保存 synthetic attempt
- dispatcher v0 start/result mutation 已支持可选 `attemptId` / `leaseToken` 校验，并会拒绝携带历史终态 `attemptId` 的 stale result
- 通用 dispatcher worker start/result 在声明 v1 envelope 时，会校验 `protocolVersion`、`traceId` 和 `idempotencyKey` 与 active attempt 一致
- Trae 兼容主链的 `fetch-task` / `start-task` / `submit-result` 已回显并校验 `protocolVersion`、`traceId`、`idempotencyKey`、`attemptId` 和 `leaseToken`
- dispatcher runtime state 已有 `artifactBundles[]`，SQLite `artifact_bundles` projection 会保存 ArtifactBundle 摘要和 refs
- Trae runtime 当前仍走现有兼容路径，但已在 `fetch-task` / `start-task` / `submit-result` 主链携带完整 v1 envelope 字段

影响：

- 代码审查和文档阅读时容易把 vNext 目标契约误读为当前已执行的 runtime 保护
- 后续 LeaseToken enforcement 仍需要把空 envelope 的 v0 worker 兼容路径、CLI / Console 剩余入口收紧为完整 v1 envelope
- ArtifactBundle 当前不保存 diff / log 正文，只保存 refs；artifact retention 仍未实现

期望方向：

- 继续接入 review workflow、artifact retention 和 Console artifact tabs

## 9. Shadow path failures have durable health, but not first-class runtime events

Current situation:

- `saveRuntimeState()` writes SQLite snapshot/projection first
- Postgres / queue shadow sync runs asynchronously
- `runtime-state-shadow.ts:readRuntimeStateShadowWriteStatus` exposes last shadow attempt status through `/api/dr/status`
- shadow write status is also persisted to `runtime-state-shadow-status.json`
- backup / restore scripts include `runtime-state-shadow-status.json`
- shadow errors are still not persisted as first-class `RuntimeState.events[]` audit records

Impact:

- process restart keeps the last shadow health record, but event timelines still do not show shadow failures as runtime events
- shadow-write rollout still needs external alerting before any primary-store cutover

Desired direction:

- decide whether shadow sync failures should also become first-class runtime events
- add an operator-visible shadow drift check before treating shadow write as rollout-ready

## 10. Source DR drill is still a minimal SQLite recovery proof

Current situation:

- `scripts/verify-stage3-dr.mjs` creates a real SQLite `runtime-state.db`
- it writes a `snapshots` row, backs up and restores the DB, then validates `PRAGMA integrity_check` and snapshot checksum
- it does not simulate a long-running dispatcher with concurrent writes, large WAL growth, or mid-write crash recovery

Impact:

- `pnpm verify:stage3` proves the source DR script path and restored SQLite queryability
- it is not yet a full production DR exercise for live WAL pressure, lock contention, or crash consistency

Desired direction:

- add a heavier live-dispatcher DR drill that runs writes during backup and validates restore under WAL pressure
- keep the current script as the fast source-level DR gate

## 11. Manual release can leave git ahead of npm when publish fails

Current situation:

- `.github/workflows/release.yml` manual path bumps package version, commits it, creates a release tag, and pushes before `npm publish`
- if `npm publish` fails after the push, git history can contain a package version that was not published to npm

Impact:

- operators may need to reconcile an already-pushed release commit/tag with a failed npm publish
- retry or rollback must be explicit to avoid confusing package consumers

Desired direction:

- document the failed-publish recovery path in release runbooks
- consider a two-phase release marker or automatic GitHub issue when publish fails

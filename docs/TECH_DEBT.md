# forgeflow-platform Technical Debt

Only confirmed, still-active debt belongs here.

## 目的

记录已经确认仍存在、不能被误当成主线完成能力的技术债和迁移边界。

## 适合读者

适合规划阶段修复、代码审查、发布风险评估、文档同步和多 agent 任务拆分时阅读。

## 一分钟摘要

- 本文件只写仍然存在的债务，不写愿望清单。
- 当前债务集中在 runtime bridge、持久化多形态、shadow 可观测性、Trae gateway 重复实现和 Stage 3 边界。
- 近期审查确认 read-only matcher、非 assignment lease、DR drill 深度和手动发布版本落账仍需后续修复。
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

## 7. Read-only mode still depends on an incomplete route classifier

Current situation:

- `DISPATCHER_READ_ONLY_MODE=1` is enforced through `dispatcher-server.ts:isMutationRequest`
- the classifier is a hand-maintained list of POST routes
- some state-changing route shapes can drift unless tests cover every mutation endpoint

Impact:

- DR or repair docs can overclaim a hard write freeze
- operators may trust read-only mode more than the current implementation justifies

Desired direction:

- move mutation classification closer to the route table or make all write routes explicitly registered
- add regression tests that prove every state-changing route returns `503 read_only_mode`

## 8. Repo / branch / session lease guards 仍是后续工作

当前情况：

- `leases.ts` 当前只支持 assignment resource type
- `runtime-state.ts` 将 acquisition/release helper 接入 assignment 执行路径
- repo/branch/session 当前不是活跃 lease resource type

影响：

- repo/branch/session 并发尚未由 dispatcher lease ownership 保护

期望方向：

- 如果 worktree branch 冲突需要 dispatcher 层预防，优先实现具体 branch lease 获取点
- repo/session 语义需要单独定义清楚，再加回 lease type model

## 9. Shadow path failures are not yet first-class operational state

Current situation:

- `saveRuntimeState()` writes SQLite snapshot/projection first
- Postgres / queue shadow sync runs asynchronously
- shadow errors are caught without being persisted as runtime events or exposed by `/api/dr/status`

Impact:

- shadow-write rollout can drift while the SQLite main path still appears healthy

Desired direction:

- surface shadow sync failures through runtime events or DR status
- add an operator-visible shadow health check before treating shadow write as rollout-ready

## 10. Source DR drill is file-copy validation, not full SQLite recovery proof

Current situation:

- `scripts/verify-stage3-dr.mjs` creates a text file named `runtime-state.db`
- it verifies backup / restore file copying and manifest behavior
- it does not exercise a real SQLite database with WAL integrity semantics

Impact:

- `pnpm verify:stage3` can pass while real database recovery behavior is still under-validated

Desired direction:

- extend the drill to create a real SQLite DB and validate restored queryability
- keep the current script documented as a minimal copy-path smoke until then

## 11. Manual release can publish a version not represented in git history

Current situation:

- `.github/workflows/release.yml` manual path runs `npm version --no-git-tag-version`
- the changed package version is published from the runner without a corresponding commit or tag

Impact:

- a published npm version may not map cleanly to a repository commit containing the same `package.json` version

Desired direction:

- require a tagged commit for manual release versions
- or make manual release publish an already-committed version only

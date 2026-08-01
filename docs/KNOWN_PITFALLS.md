# forgeflow-platform Known Pitfalls

Only code-backed or implementation-backed pitfalls belong here.

## 目的

记录已经被代码、测试、运行日志或历史反复问题验证过的高风险误读点。

## 适合读者

适合修改 dispatcher、worker、Trae runtime、发布流程、文档和运维 runbook 的维护者、AI 代理和审查者。

## 一分钟摘要

- 这里不写泛化最佳实践，只写本仓库当前仍会误导开发或运维的事实。
- `scripts/lib/*` bridge、Trae 双 gateway、worktree、review memory、release 和 Stage 3 边界都容易被误读。
- 近期审查确认 read-only、repo / branch / session lease、shadow failure 和源码 DR 脚本仍有实现边界。
- 新坑点必须附带代码、测试、配置或可复现命令证据。

```yaml
ai_summary:
  authority: "当前已验证的仓库坑点、局部例外和高风险误读"
  scope: "dispatcher runtime、Trae automation、worktree、review memory、release、Stage 3 边界"
  read_when:
    - "准备修改高风险运行时路径"
    - "审查 worker、dispatcher、release 或 DR 变更"
    - "文档与代码看起来冲突时"
  verify_with:
    - "apps/dispatcher/src/modules/server/dispatcher-server.ts"
    - "apps/dispatcher/src/modules/server/runtime-state.ts"
    - "apps/dispatcher/src/modules/server/runtime-state-sqlite.ts"
    - "scripts/backup-runtime-state.mjs"
  stale_when:
    - "列出的坑点被代码修复、路径迁移或 runbook 变更消除"
```

## 权威边界

本文件只记录已验证坑点，不替代 `TECH_DEBT.md` 的债务治理，也不替代 `ARCHITECTURE.md` 的系统说明。某个坑点修复后，应在同一变更中删除或改写对应条目。

## 如何验证

- 用 `rg` 定位每个坑点提到的函数、路由、脚本或配置项。
- 对 dispatcher 事实优先核对 `apps/dispatcher/src/modules/server/*` 和对应测试。
- 对脚本事实核对 `scripts/*.mjs`、`scripts/lib/*.ts` 和 package runtime 源码。
- 运行 `pnpm docs:validate` 检查本文结构和链接。

## 1. Do not create standalone dispatcher schema constants outside the live persistence module

Current mainline runtime state is loaded through `scripts/lib/dispatcher-state.js`, which bootstraps the dispatcher-owned implementation in `apps/dispatcher/dist/modules/server/runtime-state.js`. SQLite remains the default backend (`.forgeflow-dispatcher/runtime-state.db`), and JSON is only an explicit fallback/import path.

Do not treat JSON rescue and first-run import as the same operation. If an existing SQLite database is unreadable, `FORGEFLOW_ALLOW_STATE_FALLBACK_JSON=1` only reads `runtime-state.json` without replacing the database. Automatic JSON-to-SQLite import happens only when `runtime-state.db` is absent; permanent recovery must follow the stopped-writer backup/restore procedure.

If you change dispatcher persistence, update `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts` and its tests. Standalone schema constants were removed because they were not the active runtime path.

Control-layer `--state-dir` mutations must go through the local dispatcher bridge. Do not read and rewrite `runtime-state.json` directly: SQLite is the default truth source, and route-local state transitions omit dispatcher validation, audit events, lease release, and risk gates.

## 2. Do not collapse dispatcher APIs and Trae automation gateway APIs into one generic API story

Dispatcher and automation gateway are separate services with different responsibilities and response envelopes.

- dispatcher: task orchestration and review state
- automation gateway: local Trae desktop control

Treating them as one API surface leads to wrong client assumptions.

## 3. The two Trae automation gateway implementations are not identical

Verified divergence today:

- packaged runtime gateway and `scripts/lib/` gateway both expose `POST /v1/sessions/:sessionId/release`
- both paths now align on persistent session parsing, chat metadata passthrough and key debugLog events
- they are still two implementations, so default paths, launch wiring and future route behavior can drift again

When you touch one gateway implementation, check the other one in the same task.

## 4. Worktree creation hard-fails on missing remote baseline

When creating a new worktree, the active implementation in `packages/beta-runtime-core/src/runtime/task-worktree.ts` (re-exported by `apps/dispatcher` and `scripts/lib/task-worktree.js`) always does:

- `git fetch origin <defaultBranch>`
- resolve `origin/<defaultBranch>`
- `git worktree add`

If fetch or ref resolution fails, task materialization fails immediately.

Do not document worktree creation as best-effort. It is strict.

## 5. Review memory is selective injection, not a generic memory layer

Review-memory injection only happens when lessons match repo/scope/worker criteria during dispatch creation.

Do not assume every historical lesson is always injected into every task.

## 6. Startup helpers must not become parallel rulebooks

`AGENTS.md` owns workflow rules.
`docs/README.md` owns navigation.
Startup prompts should point back to those files instead of restating the same rules.

If a helper prompt starts drifting into a second rule source, trim it back.

## 7. Dispatcher TypeScript bridges must not trust a pre-existing `dist` blindly

Some live dispatcher paths now bridge from `scripts/lib/` into `apps/dispatcher/dist`.

If a bridge only checks whether `dist` exists, a non-fresh checkout can keep importing stale build output and silently run old logic.

When you touch dispatcher live bridges, verify behavior both:

- in a fresh checkout with no prebuilt `dist`
- in a repo state where `apps/dispatcher/dist` already exists but is outdated

## 8. Duplicate worker processes with the same `worker-id` can corrupt heartbeat and result reporting

If two worker processes run concurrently with the same `worker-id`, dispatcher-side behavior becomes unstable:

- heartbeats can interleave
- task claim/execution ownership becomes ambiguous
- final result submission can appear flaky even when the UI already finished

When diagnosing worker/reporting issues, verify there is only one live process per `worker-id` before assuming the runtime logic is wrong.

## 9. Newly published Trae runtime dependencies may lag on mirrored npm registries

`@tingrudeng/trae-beta-runtime` depends on the separately published packages
`@tingrudeng/automation-gateway-core` and `@tingrudeng/beta-runtime-core`.

When a fresh runtime version is published, mirrored registries such as
`https://registry.npmmirror.com` may expose the runtime package before they expose the
new shared dependency. In that state:

- `npm view @tingrudeng/trae-beta-runtime@<version>` can already succeed
- `npm install -g @tingrudeng/trae-beta-runtime@<version>` can still fail with dependency `404`
- the missing package may be `@tingrudeng/automation-gateway-core@<version>` or `@tingrudeng/beta-runtime-core@<version>`

If installation or `forgeflow-trae-beta update` fails right after a release on a mirrored
registry, do not assume the publish itself is broken first. Retry against the official npm
registry:

- `npm install -g @tingrudeng/trae-beta-runtime@<version> --registry=https://registry.npmjs.org/`

Document install/upgrade guidance accordingly whenever a runtime release introduces a new
shared dependency version.

## 10. Worker assignment child processes no longer inherit generic parent secrets by default

`scripts/lib/worker-daemon.js` now starts assignment execution with an env allowlist.

Do not assume secrets from the parent worker process automatically exist inside the task process.

In particular, values such as:

- `GITHUB_TOKEN`
- `DISPATCHER_API_TOKEN`
- ad-hoc local secrets

should be treated as absent unless they are explicitly added to `FORGEFLOW_WORKER_ENV_ALLOWLIST`.

Execution policy variables are an exception: `FORGEFLOW_EXECUTION_PROFILE` and its container settings are always forwarded, even when a legacy custom allowlist omits them. This prevents an isolated daemon from silently downgrading its assignment child to host execution.

Provider keys are narrower than the generic allowlist: Codex assignment 只接收 `OPENAI_API_KEY`，Gemini assignment 只接收 `GEMINI_API_KEY`，verification command 两者都不接收。不要通过自定义 allowlist 把另一 provider 或控制面 secret 重新引入任务进程。

## 10.1 Container isolation is explicit and does not imply domain-level egress control

Codex / Gemini default to `trusted-host`. `isolated-container` only activates when the operator sets both `FORGEFLOW_EXECUTION_PROFILE=isolated-container` and an existing `FORGEFLOW_EXECUTION_CONTAINER_IMAGE`.

The image must contain the provider CLI, `/bin/sh`, Git, and every verification tool. Provider binary overrides refer to paths inside that image. Missing runtime or image readiness fails closed and never falls back to the host.

Docker `bridge` is broad default container networking, not a hostname allowlist. `FORGEFLOW_EXECUTION_NETWORK=none` disables all container networking and therefore blocks normal provider API access. Do not claim domain-filtered egress, microVM isolation, or an untrusted multi-tenant boundary from this profile alone.

## 11. Automatic PR creation is opt-in, not implied by `GITHUB_TOKEN`

`worker-daemon` no longer treats a parent-side `GITHUB_TOKEN` as enough to open PRs.

Automatic draft PR creation now requires explicit opt-in via `FORGEFLOW_WORKER_CREATE_PR=1`.

If a worker should push changes but must not create PRs, leaving `GITHUB_TOKEN` set is no longer sufficient to trigger PR creation by accident.

## 12. GitHub OIDC release workflow is not sufficient by itself to publish `@tingrudeng/*`

`release.yml` now uses npm Trusted Publishing with GitHub OIDC, but npm still has to trust the
current GitHub repository identity first.

If npm has not been configured to trust `TingRuDeng/forgeflow-platform` for the target package,
the release job can build successfully, sign provenance successfully, and still fail at the final
`npm publish` step.

The repository now keeps push-triggered auto release behind the explicit variable
`NPM_TRUSTED_PUBLISHING_ENABLED=true`, validates package metadata, and runs lint / docs validation /
typecheck / tests / shadow drift gate before publish.

Do not treat a green OIDC/provenance setup in GitHub Actions as proof that npm-side trusted
publisher configuration is complete.

## 12.1 Trusted Publishing does not maintain npm dist-tags outside publish

The release workflow publishes prerelease versions with the npm `beta` dist-tag. An older
`latest` tag can still remain on the package, and an unqualified install such as
`npm install -g @tingrudeng/codex-beta-runtime` resolves that stale `latest` instead of the newly
published beta.

npm Trusted Publishing authorizes `npm publish` and `npm stage publish`; it does not authorize
separate `npm dist-tag add` or `npm dist-tag rm` commands. Those mutations still require the
maintainer's interactive npm authentication and OTP when `auth-and-writes` 2FA is enabled.

While the provider runtimes remain prerelease packages:

- install dispatcher, the control-layer CLI, Codex, Gemini, and Trae with an explicit `@beta` suffix
- keep prerelease self-update defaults on the `beta` dist-tag; stable versions switch to `latest`
- treat `beta` as the only prerelease release pointer and do not use interactive `npm dist-tag add`
  to mirror it into `latest`
- use `pnpm verify:runtime-packages:published` for runtime package/version/dependency/tag checks;
  a stale `latest` value is expected until a stable release replaces it

## 13. Control-plane failure metrics are event-backed and some worker-side signals are best-effort

`/api/metrics` now exposes counts such as:

- `submitResultRetryCount`
- `deliveryFailedCount`
- `cleanupFailureCount`
- `sessionInterruptionCount`
- `stateLockTimeoutCount`

These counts are built from the retained dispatcher runtime-event window plus a small in-process timeout counter. `/api/metrics.eventWindow` reports the exact window boundary; the runtime state keeps at most 500 events.

Implications:

- dispatcher-side audit events are durably appended in SQLite/PostgreSQL and can be paged through `/api/query/events`
- `/api/metrics` is a recent-window view, not a lifetime counter; use the audit query for older history
- worker-side event reporting is still best-effort
- a zero count does not prove that no worker-side failure happened anywhere outside dispatcher reachability

When debugging suspected delivery problems, check both:

- dispatcher `/api/metrics` and recent events
- worker-side logs / failed artifacts under `.worktrees/failed/`

## 14. Read-only mode freezes dispatcher HTTP API writes only

`DISPATCHER_READ_ONLY_MODE=1` is enforced by `apps/dispatcher/src/modules/server/dispatcher-server.ts:isMutationRequest`.

Current matcher behavior defaults to rejecting `POST` / `PUT` / `PATCH` / `DELETE` under `/api/`, so known dispatcher HTTP mutation routes such as worker claim/start/result, review decisions, task cancellation and future `/api` write routes are covered by the freeze.

Do not describe read-only mode as an infrastructure-wide write barrier: direct runtime-state file edits, external database writes or writes that bypass dispatcher HTTP are outside this switch and must be controlled by the operator workflow.

## 15. Repo / branch / session lease 只覆盖 dispatcher task claim 生命周期

`apps/dispatcher/src/modules/server/leases.ts` 当前定义 `assignment`、`repo`、`branch` 和 `session`。

`apps/dispatcher/src/modules/server/runtime-state.ts` 当前通过 `acquireTaskResourceLeases()` 和 `releaseTaskResourceLeases()` 在 task 被 worker claim、start、result、cancel、review decision 或 worker offline 时获取和释放资源。

不要把它描述成全局 Git 仓库互斥锁：它约束 dispatcher 管理的 task 生命周期，不覆盖 dispatcher 外部脚本直接操作同一 repo、branch 或 Trae session 的情况。

不要因为其他位置存在 worktree 检查、Trae session 文件锁和 repo concurrency 指标，就假定 repo、branch 或 session ownership 已经是全局硬并发保护。`sessions.json.lock` 只串行化同一状态目录内的本机文件变更，不提供跨主机 ownership。

## 16. Source DR scripts and packaged dispatcher CLI have different argument shapes

The source scripts use positional arguments:

- `node scripts/backup-runtime-state.mjs <stateDir> [backupDir]`
- `node scripts/restore-runtime-state.mjs <backupDir> <stateDir>`

The packaged runtime CLI exposes flags such as `forgeflow-dispatcher backup --backup-dir ...`.

Do not copy package CLI examples into source-script runbooks without checking the actual script parser.

## 17. Shadow write failure is best-effort, but must be checked through DR health

`apps/dispatcher/src/modules/server/runtime-state-sqlite.ts:saveRuntimeState` calls `syncRuntimeStateShadowAndPersistStatus()` asynchronously and does not surface shadow errors to the mutating HTTP response.

Shadow write status is persisted to `runtime-state-shadow-status.json` and exposed through `/api/dr/status.shadowWrite`. Automatic reconciliation status is persisted to `shadow-reconciler-status.json` and exposed through `/api/dr/status.shadowReconciler`.

Do not treat a green SQLite write as proof that Postgres / queue shadow stores are healthy; check `/api/dr/status.shadowWrite` and `/api/dr/status.shadowReconciler` before shadow rollout or DR cutover decisions.

Shadow projection / queue synchronization is ordered by the persisted SQLite snapshot revision. Replaying an older snapshot is a no-op, and reusing one revision with different content is a conflict; do not fabricate `sourceRevision` values in repair scripts. PostgreSQL primary writes also use a separate storage revision CAS. A `409 runtime_state_revision_conflict` means another writer committed first: reload the latest state and reapply the intended mutation instead of retrying the stale full snapshot.

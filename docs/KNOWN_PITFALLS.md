# forgeflow-platform Known Pitfalls

Only code-backed or implementation-backed pitfalls belong here.

## 1. Do not mistake `apps/dispatcher/src/db/schema.ts` for the live dispatcher truth source

Current mainline runtime state is loaded through `scripts/lib/dispatcher-state.js`, with SQLite as the default backend (`.forgeflow-dispatcher/runtime-state.db`) and JSON only as an explicit fallback/import path.

If you change dispatcher behavior and only update the SQLite schema constants, you have not updated the active runtime path.

## 2. Do not collapse dispatcher APIs and Trae automation gateway APIs into one generic API story

Dispatcher and automation gateway are separate services with different responsibilities and response envelopes.

- dispatcher: task orchestration and review state
- automation gateway: local Trae desktop control

Treating them as one API surface leads to wrong client assumptions.

## 3. The two Trae automation gateway implementations are not identical

Verified divergence today:

- packaged runtime gateway has `POST /v1/sessions/:sessionId/release`
- `scripts/lib/` gateway does not
- session-store default paths also differ

When you touch one gateway implementation, check the other one in the same task.

## 4. Worktree creation hard-fails on missing remote baseline

`scripts/lib/task-worktree.js` always does:

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

`@tingrudeng/trae-beta-runtime` now depends on the separately published package
`@tingrudeng/automation-gateway-core`.

When a fresh runtime version is published, mirrored registries such as
`https://registry.npmmirror.com` may expose the runtime package before they expose the
new shared dependency. In that state:

- `npm view @tingrudeng/trae-beta-runtime@<version>` can already succeed
- `npm install -g @tingrudeng/trae-beta-runtime@<version>` can still fail with dependency `404`
- the missing package is usually `@tingrudeng/automation-gateway-core@<version>`

If installation or `forgeflow-trae-beta update` fails right after a release on a mirrored
registry, do not assume the publish itself is broken first. Retry against the official npm
registry:

- `npm install -g @tingrudeng/trae-beta-runtime@<version> --registry=https://registry.npmjs.org/`

Document install/upgrade guidance accordingly whenever a runtime release introduces a new
shared dependency version.

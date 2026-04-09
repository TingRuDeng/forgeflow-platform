# Stage 3 Minimum Execution Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break phase three into a minimal execution order that preserves the Trae-first control-plane mainline while moving from single-node truth to scalable control-plane primitives.

**Architecture:** Phase three is too broad to execute as one feature branch. The safest path is to split it into wave-sized changes that each preserve the current dispatcher truth model, introduce one new scale primitive at a time, and keep a rollback window through shadow write, read-only fallback, and explicit migration gates.

**Tech Stack:** TypeScript, Node.js, dispatcher runtime, SQLite-to-Postgres migration path, queue abstraction, GitHub Actions, docs/runbooks, npm package release workflow.

---

## Scope Check

Stage three spans multiple independent subsystems:

- multi-instance lease / lock and shared session ownership
- query-first structured state storage
- external DB / queue evolution
- SLO / burn-rate / DR and operational governance
- third-party access policy and public API / SDK
- deployment model unification and compatibility cleanup

Do not implement stage three as one branch or one PR. Execute it as six waves. Each wave should produce a working, testable, reversible checkpoint on its own.

The execution order is intentionally split into:

- stage-three core platform waves: Wave 1, Wave 2, Wave 3, Wave 4, Wave 6
- ecosystem opening wave: Wave 5

Wave 5 is deliberately deferred until the internal state model, storage evolution path, production governance, and deployment topology are all stable enough to support external contracts.

## File Structure

These are the primary files and directories that stage three work will likely touch. Use them as the stable boundary map when writing wave-specific plans.

- Modify: `apps/dispatcher/src/modules/server/runtime-state.ts`
  - task, assignment, review, session truth model and reconciliation rules
- Modify: `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
  - current single-node persistence adapter and migration seam
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
  - operator APIs, query APIs, health and metrics endpoints
- Modify: `apps/dispatcher/src/modules/server/runtime-dispatcher-server.ts`
  - runtime-facing HTTP behavior and server glue
- Modify: `packages/result-contracts/src/index.ts`
  - public worker result and blocker contract evolution
- Create: `packages/dispatcher-store-*`
  - storage abstraction and external backend adapters
- Create: `packages/dispatcher-queue-*`
  - queue abstraction and queue backend adapter
- Modify: `.github/workflows/release.yml`
  - package and deployment gate evolution
- Create: `docs/runbooks/*`
  - DR, backup, restore, rollout, rollback, capacity and SLO operations
- Create: `docs/contracts/*`
  - external API and SDK stability contracts
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/onboarding.md`

## Wave Order

### Recommended Execution Order

1. Wave 1: S3-R1 Multi-Instance Lease / Lock Foundation
2. Wave 2: S3-A1 Query-First Structured State Store
3. Wave 3: S3-A2 External DB / Queue Shadow Path
4. Wave 4: S3-E1 + S3-R2 Production Governance and DR
5. Wave 6: S3-T1 + S3-T2 + S3-T3 Packaging, Deployment, Cleanup
6. Wave 5: S3-R3 + S3-A3 Ecosystem Access Governance

Rationale:

- Wave 5 creates external compatibility and governance costs, so it should not run before ownership, state query shape, storage migration, DR, and deployment topology are stable.
- Wave 6 belongs before Wave 5 because external API and SDK exposure should build on a cleaned-up provider model and a stable deployment/configuration surface.

### Wave 1: S3-R1 Multi-Instance Lease / Lock Foundation

**Files:**
- Modify: `apps/dispatcher/src/modules/server/runtime-state.ts`
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
- Create: `apps/dispatcher/src/modules/server/leases.ts`
- Test: `apps/dispatcher/tests/modules/server/runtime-state.test.ts`
- Test: `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts`

- [ ] Define lease subjects and lock scope in code and docs: `session`, `repo`, `branch`, `assignment-claim`
- [ ] Introduce a storage-backed lease interface behind the dispatcher truth layer instead of encoding lease semantics in ad hoc file locks
- [ ] Add idempotent lease acquisition and release semantics with owner token, TTL, renewal, and stale reclaim rules
- [ ] Keep SQLite as the initial lease backend so behavior is proven before any external DB cutover
- [ ] Add multi-process tests for double claim, stale owner reclaim, duplicate submit, and restart recovery
- [ ] Add operator-visible lease metrics and events so every timeout or forced reclaim leaves audit evidence
- [ ] Document the single-write/multi-executor rollout mode before allowing broader multi-instance topology

**Verification:**
- `pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state.test.ts tests/modules/server/dispatcher-server.test.ts`
- `pnpm --filter @forgeflow/dispatcher typecheck`
- `git diff --check`

**Exit Gate:**
- no double claim under concurrent workers
- stale owner reclaim is deterministic
- every lease timeout or reclaim is observable from dispatcher APIs and metrics

### Wave 2: S3-A1 Query-First Structured State Store

**Files:**
- Modify: `apps/dispatcher/src/modules/server/runtime-state.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- Create: `apps/dispatcher/src/modules/server/runtime-state-query-store.ts`
- Create: `docs/contracts/state-query-model.md`
- Test: `apps/dispatcher/tests/modules/server/runtime-state-sqlite.test.ts`
- Test: `apps/dispatcher/tests/modules/server/runtime-state.test.ts`

- [ ] Design normalized entities for `tasks`, `assignments`, `reviews`, `events`, and `sessions`
- [ ] Add structured shadow tables while preserving the current snapshot blob as rollback insurance
- [ ] Dual-write from the dispatcher truth layer to both snapshot and structured tables
- [ ] Add read-only query endpoints that serve dashboard and audit views from structured entities
- [ ] Keep mutating flows on the existing truth path until structured reads are proven stable
- [ ] Add consistency checks that compare snapshot-derived and structured-derived views
- [ ] Document the rollback switch that disables structured reads without data loss

**Verification:**
- `pnpm --filter @forgeflow/dispatcher test tests/modules/server/runtime-state-sqlite.test.ts tests/modules/server/runtime-state.test.ts`
- `pnpm --filter @forgeflow/dispatcher typecheck`
- `git diff --check`

**Exit Gate:**
- dashboard and audit can query structured entities directly
- snapshot rollback remains available
- structured reads match snapshot-derived truth in regression tests

### Wave 3: S3-A2 External DB / Queue Shadow Path

**Files:**
- Create: `packages/dispatcher-store-core/src/index.ts`
- Create: `packages/dispatcher-store-postgres/src/index.ts`
- Create: `packages/dispatcher-queue-core/src/index.ts`
- Create: `packages/dispatcher-queue-postgres/src/index.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state-sqlite.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-dispatcher-server.ts`
- Create: `docs/runbooks/shadow-postgres-queue.md`
- Test: `packages/dispatcher-store-postgres/tests/*.test.ts`
- Test: `packages/dispatcher-queue-postgres/tests/*.test.ts`

- [ ] Extract a store interface from the current SQLite adapter without changing dispatcher domain rules
- [ ] Add a shadow Postgres store adapter for structured entities only
- [ ] Add a queue abstraction for assignment delivery and retry bookkeeping
- [ ] Run shadow writes to Postgres and queue metadata without switching mainline reads or writes
- [ ] Add reconciliation tooling to compare SQLite truth against Postgres shadow state
- [ ] Add rollout flags for `disabled`, `shadow-write`, `shadow-read`, and `primary`
- [ ] Document the cutover and rollback sequence before any production use

**Verification:**
- `pnpm test --filter dispatcher-store-postgres`
- `pnpm test --filter dispatcher-queue-postgres`
- `pnpm typecheck`
- `git diff --check`

**Exit Gate:**
- shadow path can run without affecting mainline
- reconciliation reports drift deterministically
- cutover and rollback are documented and rehearsable

### Wave 4: S3-E1 + S3-R2 Production Governance and DR

**Files:**
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- Modify: `apps/dispatcher/src/modules/server/runtime-state.ts`
- Create: `scripts/verify-stage3-dr.ts`
- Create: `docs/runbooks/disaster-recovery.md`
- Create: `docs/runbooks/slo-and-burn-rate.md`
- Create: `.github/workflows/stage3-drill.yml`
- Test: `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts`

- [ ] Define target SLOs for task success, delivery success, assignment lag, restore time, and recovery point
- [ ] Add burn-rate friendly metrics and alert thresholds for the critical dispatcher and worker paths
- [ ] Formalize read-only degradation mode and restore path in code and operator docs
- [ ] Add repeatable backup, restore, and integrity verification scripts for both snapshot and structured stores
- [ ] Add quarterly DR drill workflow and evidence collection path
- [ ] Add regression coverage for read-only degrade mode and post-restore integrity checks
- [ ] Document RTO/RPO commitments and how operators validate them

**Verification:**
- `pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-server.test.ts`
- `pnpm typecheck`
- `git diff --check`

**Exit Gate:**
- RTO and RPO are explicit
- restore drill is scripted and repeatable
- burn-rate metrics exist with clear operator thresholds

### Wave 5: S3-R3 + S3-A3 Ecosystem Access Governance (Deferred Until After Core Stage-Three Platform Work)

**Files:**
- Modify: `apps/dispatcher/src/modules/server/dispatcher-server.ts`
- Modify: `packages/result-contracts/src/index.ts`
- Create: `docs/contracts/public-api-readonly.md`
- Create: `docs/contracts/public-api-write-tier.md`
- Create: `docs/runbooks/provider-admission.md`
- Create: `templates/rfc/third-party-provider.md`
- Test: `apps/dispatcher/tests/modules/server/dispatcher-server.test.ts`
- Test: `packages/result-contracts/tests/index.test.ts`

- [ ] Define third-party provider admission policy, revocation model, and audit subject requirements
- [ ] Open read-only external APIs first and keep mutating APIs behind explicit allowlists
- [ ] Version external response contracts before exposing SDK entry points
- [ ] Add provider identity, allowlist checks, and audit events to all third-party entry points
- [ ] Create minimal SDK examples only after readonly API contracts are frozen
- [ ] Document compatibility, deprecation windows, and breaking-change process
- [ ] Add tests that prove rejected providers cannot mutate dispatcher truth

**Verification:**
- `pnpm --filter @forgeflow/dispatcher test tests/modules/server/dispatcher-server.test.ts`
- `pnpm --filter @tingrudeng/result-contracts test`
- `pnpm typecheck`
- `git diff --check`

**Exit Gate:**
- external readonly API is versioned
- third-party providers are allowlisted and revocable
- mutating access remains gated behind explicit policy

### Wave 6: S3-T1 + S3-T2 + S3-T3 Packaging, Deployment, Cleanup

**Files:**
- Modify: `packages/trae-beta-runtime/src/*`
- Modify: `packages/worker-review-orchestrator-cli/src/*`
- Modify: `.github/workflows/release.yml`
- Create: `deploy/compose/*`
- Create: `deploy/helm/*`
- Create: `docs/runbooks/reference-deployments.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [ ] Finish provider abstraction so Trae-first remains the mainline and fallback paths stay explicitly secondary
- [ ] Unify deployment config, environment layering, and secret injection for single-node and multi-node topologies
- [ ] Publish official reference deployment shapes: single-node, single-write/multi-executor, multi-instance
- [ ] Remove already-migrated compatibility shims only after deprecation windows are documented
- [ ] Tie deployment docs and release docs to tagged versions instead of floating branch state
- [ ] Add release checks for deprecated entry points and configuration drift
- [ ] Document final migration path from stage-two topology to stage-three topology

**Verification:**
- `pnpm test`
- `pnpm typecheck`
- `git diff --check`

**Exit Gate:**
- official deployment shapes are documented and reproducible
- deprecated compatibility paths have explicit removal windows
- Trae-first remains the only mainline expression

## First Execution Recommendation

Start with Wave 1 only. Do not start query-first storage or external DB work before multi-instance lease semantics are stable. The first implementation PR should be limited to:

- lease/lock interface introduction
- SQLite-backed lease persistence
- dispatcher concurrency and reclaim tests
- metrics/events for lease contention and reclaim
- operator docs for single-write/multi-executor rollout

## Stage 3 Core Platform Completion Criteria

- [ ] Multi-instance lease / lock semantics are real, observable, and regression-tested
- [ ] Structured query state exists and can serve dashboard/audit reads
- [ ] External DB / queue path exists behind shadow and rollback gates
- [ ] SLO, burn-rate, DR, restore, and rollback are scripted and documented
- [ ] Deployment and compatibility model is unified and stable

## Stage 3 Ecosystem Completion Criteria

- [ ] Third-party access is allowlisted, audited, and versioned
- [ ] External readonly APIs are versioned before broader SDK exposure
- [ ] SDK/API openness does not outrun internal contract stability

## Self-Review

- Coverage against `docs/external/4、项目迭代规划与路线图.md`: stage three risk, capability, tech-debt, engineering, and documentation tracks are all mapped to a wave
- Placeholder scan: no `TODO` or undefined implementation waves remain
- Naming consistency: wave names and IDs align with `S3-R1/R2/R3`, `S3-A1/A2/A3`, `S3-T1/T2/T3`, and `S3-E1`

Plan complete and saved to `docs/superpowers/plans/2026-04-08-stage3-minimum-execution-checklist.md`.

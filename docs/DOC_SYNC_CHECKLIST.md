# Doc Sync Checklist

Every code task must either update the affected docs or explicitly record `no doc impact` with a reason.

## 1. Rule of Completion

A task is not complete until one of these is true:

- the impacted docs were updated in the same change
- the task summary explicitly says `no doc impact` and explains why

Do not silently skip this check.

## 2. Update Map

Update `README.md` when:

- the main supported runtime path changes
- startup commands change
- worker positioning changes
- Trae path positioning changes

Update `docs/README.md` when:

- document authority changes
- reading order changes
- new stable docs are added
- documents are archived, renamed, or removed from the active path

Update `docs/onboarding.md` when:

- business-repo onboarding steps change
- required templates, workflows, or repo prerequisites change
- the recommended execution path for new adopters changes

Update `docs/ARCHITECTURE.md` when:

- runtime ownership changes
- new services or long-lived processes are added
- control-flow boundaries shift
- persistence authority changes

Update `docs/API_ENDPOINTS.md` when:

- dispatcher HTTP routes change
- Trae automation gateway routes change
- response envelopes or endpoint ownership changes

Update `docs/DATABASE_SCHEMA.md` when:

- dispatcher state shape changes
- review-memory shape changes
- session-store shape or storage path changes
- any real database-backed persistence becomes active

Update `docs/KNOWN_PITFALLS.md` when:

- a repeated implementation trap is verified in code, config, logs, or recurring failures
- a listed pitfall is no longer true

Update `docs/TECH_DEBT.md` when:

- confirmed architectural mismatches are introduced
- a listed debt item is materially reduced or removed

Update local module `README.md` files when:

- module ownership changes
- active entrypoints move
- local non-obvious constraints change

## 3. Archive Rules

If a doc is no longer authoritative:

- move it under `docs/archive/` if it still has historical value
- remove dead references from active docs
- do not leave it in the active root path looking current

## 4. Completion Note Template

Use one of these in summaries or PR notes:

- `doc impact: updated README.md, docs/README.md, docs/API_ENDPOINTS.md`
- `no doc impact: changed test-only assertions in apps/dispatcher without changing runtime behavior or interfaces`

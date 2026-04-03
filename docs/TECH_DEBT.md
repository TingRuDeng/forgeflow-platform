# ForgeFlow Technical Debt

Only confirmed, still-active debt belongs here.

## 1. Dispatcher runtime ownership is still split across `apps/dispatcher/` and `scripts/lib/`

Current situation:

- `apps/dispatcher/` now contains the TypeScript runtime foundations for dispatcher server/state, worker-daemon client glue, and review-decision glue
- live entrypoints still start from `scripts/lib/` and import `apps/dispatcher/dist`
- some remaining runtime glue is still script-owned

Impact:

- contributors still need to understand both the TS foundation layer and the live script adapter layer
- bootstrap/freshness bugs can appear at the boundary between source and built `dist`

Desired direction:

- either converge further toward one clearer ownership boundary
- or keep the adapter split but enforce explicit bridge contracts and dist freshness rules

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

## 3. Trae automation gateway has duplicated implementations with behavior drift

Verified drift:

- packaged runtime exposes `POST /v1/sessions/:sessionId/release`
- `scripts/lib/` gateway does not
- default session-store paths differ

Impact:

- docs can overclaim parity
- fixes land in one implementation but not the other

Desired direction:

- reduce duplication or add an explicit sync rule and shared compatibility test coverage

## 4. Stable agent-facing docs were previously concentrated in rule/nav docs but lacked a durable knowledge layer

Impact:

- agents had to infer architecture, persistence, and HTTP boundaries from scattered files
- repeated rediscovery risk was high

Current status:

- partially addressed by the docs added in this pass

Remaining need:

- keep these docs synced whenever runtime boundaries or API surfaces change

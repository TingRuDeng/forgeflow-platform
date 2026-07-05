# @tingrudeng/automation-gateway-core

Shared protocol helpers for ForgeFlow automation gateway runtimes.

Current scope:
- parse final report fields emitted by Trae automation tasks
- detect template-marker reports before they are accepted as real output
- validate whether a reported task id still matches the dispatcher task being processed
- provide shared Trae automation gateway request handling, HTTP JSON IO, and persistent session-store primitives

This package is intentionally small:
- parsing, validation, gateway protocol, and local JSON session-store helpers only
- no network client, DOM driver, or worker lifecycle logic
- suitable for reuse by both the packaged Trae runtime and any future gateway-side validation paths

## Exports

```ts
import {
  getLastReportFieldValue,
  createPersistentAutomationSessionStore,
  isEquivalentReportedTaskId,
  isPlaceholderTaskId,
  looksLikeTemplatePlaceholderReport,
} from "@tingrudeng/automation-gateway-core";
```

## Repository-local usage

```bash
pnpm --filter @tingrudeng/automation-gateway-core test
pnpm --filter @tingrudeng/automation-gateway-core typecheck
pnpm --filter @tingrudeng/automation-gateway-core build
```

## Notes

- This is a library package, not a direct machine entrypoint.
- The current primary consumer is `@tingrudeng/trae-beta-runtime`.
- Release steps are documented in `PUBLISHING.md`.

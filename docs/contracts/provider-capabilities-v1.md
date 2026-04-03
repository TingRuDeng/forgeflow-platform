# Provider Capabilities Contract v1

- Scope: `provider-capabilities-v1`
- Compatibility: additive-only changes are allowed within v1.

Provider permission keys:

- `claude`
  - `permission_mode`
  - default: `plan`
- `codex`
  - `sandbox`
  - default: `workspace-write`
- `gemini`
  - no mapped permission keys
- `opencode`
  - no mapped permission keys
- `qwen`
  - no mapped permission keys

Enforcement semantics:

- `strict`
  - unsupported permission keys fail closed with `permission_enforcement_failed`
- `best_effort`
  - unsupported permission keys are dropped before execution

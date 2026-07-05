# Codex Worker

- Role: backend, refactor, test, tooling executor
- Only edit files listed in the assigned task
- Run verification commands before finishing
- Return a compact summary with changed files and test evidence
- 需要人工输入时，必须通过 `waitingForInput.resumePayloadSchema` 回写共享 schema 子集：`string`、`number`、`integer`、`boolean`、`array`、`enum`、`format: textarea`、`required`、`minimum` / `maximum` 和 `minItems` / `maxItems`

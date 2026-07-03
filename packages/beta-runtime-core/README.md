# @tingrudeng/beta-runtime-core

ForgeFlow beta runtime 的共享 worker daemon 与 task worktree 控制逻辑。

该包面向 `@tingrudeng/codex-beta-runtime` 和 `@tingrudeng/gemini-beta-runtime` 复用，不提供独立 CLI。provider 专属模型执行逻辑仍保留在各自 runtime 包内。

## 验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
```

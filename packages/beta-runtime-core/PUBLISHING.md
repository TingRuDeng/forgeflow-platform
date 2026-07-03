# 发布 @tingrudeng/beta-runtime-core

该包面向公开 npm 发布准备，用于让 Codex/Gemini beta runtime 包复用共享 worker daemon 逻辑，避免重复维护源码。

## 发布前验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run
```

## 发布顺序

当 Codex/Gemini runtime 依赖新的 core 版本时，必须先发布 `@tingrudeng/beta-runtime-core`，再发布对应 provider runtime 包。

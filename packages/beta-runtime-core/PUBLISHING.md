# 发布 @tingrudeng/beta-runtime-core

该包面向公开 npm 发布准备，用于让 Codex/Gemini beta runtime 包复用共享 worker daemon 逻辑，避免重复维护源码。

正式发布唯一入口是 `.github/workflows/release.yml`。workflow 使用 npm Trusted Publishing + GitHub OIDC，生成并发布一个 `--ignore-scripts` 的精确 tarball，再从 registry 下载产物核对 dist-tag、integrity、完整文件集和安装结果；本地 `release-package.js` 仅做预览。

## 发布前验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run
```

## 发布顺序

当 Codex/Gemini runtime 依赖新的 core 版本时，必须先发布 `@tingrudeng/beta-runtime-core`，再发布对应 provider runtime 包。

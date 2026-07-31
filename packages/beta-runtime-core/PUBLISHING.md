# 发布 @tingrudeng/beta-runtime-core

该包面向公开 npm 发布准备，用于让 Codex/Gemini beta runtime 包复用共享 worker daemon 逻辑，避免重复维护源码。

正式发布唯一入口是 `.github/workflows/release.yml`。本地 `release-package.js` 默认预览，显式 `--prepare` 只修改目标 manifest 的版本字段；版本 PR 通过 CI 并合入受保护 `main` 后，package manifest push 自动触发 workflow。workflow 使用 npm Trusted Publishing + GitHub OIDC，生成并发布一个 `--ignore-scripts` 的精确 tarball，再从 registry 下载产物核对 dist-tag、integrity、完整文件集和安装结果；独立低权限 job 在验证成功后记录幂等 release tag，workflow 不写 `main`。

## 发布前验证

```bash
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run
node scripts/release-package.js --package beta-runtime-core --bump prerelease --prepare
```

第二条命令只在确认预览结果后运行。随后检查版本单行 diff，提交版本 PR，等待 CI 通过并合入 `main`；不要添加 `[skip actions]`，也不要手动 dispatch Release workflow。

## 发布顺序

当 Codex/Gemini runtime 依赖新的 core 版本时，必须先发布 `@tingrudeng/beta-runtime-core`，再发布对应 provider runtime 包。

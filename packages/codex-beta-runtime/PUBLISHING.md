# 发布 @tingrudeng/codex-beta-runtime

该包面向 **公开 beta npm 发布**准备，正式入口是 `.github/workflows/release.yml` 的 GitHub Actions Trusted Publishing。

## 前置条件

- Node 22+
- 已安装 pnpm
- 具备发布 `@tingrudeng` scope 的 npm 权限
- 使用干净的 ForgeFlow 仓库 checkout

## 发布前验证

```bash
pnpm --filter @tingrudeng/codex-beta-runtime test
pnpm --filter @tingrudeng/codex-beta-runtime typecheck
pnpm --filter @tingrudeng/codex-beta-runtime build
node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run
node scripts/release-package.js --package codex-beta-runtime --bump prerelease --dry-run
```

首次公开 beta 发布前，还要在真实远端机器上跑一次 smoke check：

```bash
node packages/codex-beta-runtime/dist/cli.js init ...
node packages/codex-beta-runtime/dist/cli.js doctor
node packages/codex-beta-runtime/dist/cli.js start worker --once
node packages/codex-beta-runtime/dist/cli.js status
```

如果发布前需要完整仓库级信心，再运行：

```bash
pnpm test
pnpm typecheck
git diff --check
```

## 包发布范围

该包配置为公开发布：

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

## 发布流程

先用本地 helper 预览 core 与 provider 的版本。确认后，对本次确实要发布的包分别运行 `--prepare`，提交版本 PR；PR 通过 CI 并合入受保护 `main` 后，package manifest push 自动触发 Release workflow：

```bash
node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run
node scripts/release-package.js --package codex-beta-runtime --bump prerelease --dry-run
node scripts/release-package.js --package codex-beta-runtime --bump prerelease --prepare
```

当 Codex runtime 依赖新的 core 版本时，必须先单独合并并发布 `@tingrudeng/beta-runtime-core`，确认 registry 版本存在后再准备 provider 版本 PR。Release workflow 会生成唯一 tarball，把 `workspace:*` runtime 依赖改写为具体版本，以 OIDC + provenance 发布该 tarball，并从 registry 下载精确产物复核 integrity、内容与安装结果；独立 job 再记录 release tag。不要手动 dispatch workflow，也不要给版本提交添加 `[skip actions]`。

## 远端机器安装流程

发布后，预期安装形态如下：

```bash
pnpm add -g @tingrudeng/codex-beta-runtime@beta
forgeflow-codex-beta init
forgeflow-codex-beta doctor
forgeflow-codex-beta start worker
forgeflow-codex-beta status
forgeflow-codex-beta stop worker
forgeflow-codex-beta update
```

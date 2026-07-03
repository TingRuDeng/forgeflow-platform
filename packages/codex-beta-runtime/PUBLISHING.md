# 发布 @tingrudeng/codex-beta-runtime

该包面向 **公开 beta npm 发布**准备，但不会由本仓库自动发布。

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

从仓库根目录执行：

```bash
pnpm --filter @tingrudeng/beta-runtime-core build
pnpm --filter @tingrudeng/beta-runtime-core publish --access public --no-git-checks
pnpm --filter @tingrudeng/codex-beta-runtime build
pnpm --filter @tingrudeng/codex-beta-runtime publish --access public --no-git-checks
```

当 Codex runtime 依赖新的 core 版本时，必须先发布 `@tingrudeng/beta-runtime-core`。Codex 包会在 `prepublishOnly` 阶段把 `workspace:*` runtime 依赖重写为具体 npm 版本，避免发布包携带 workspace 协议。

## 远端机器安装流程

发布后，预期安装形态如下：

```bash
pnpm add -g @tingrudeng/codex-beta-runtime
forgeflow-codex-beta init
forgeflow-codex-beta doctor
forgeflow-codex-beta start worker
forgeflow-codex-beta status
forgeflow-codex-beta stop worker
forgeflow-codex-beta update
```

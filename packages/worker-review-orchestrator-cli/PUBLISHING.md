# Publishing @tingrudeng/worker-review-orchestrator-cli

## Release Gate

Before publishing:

```bash
pnpm --filter @tingrudeng/worker-review-orchestrator-cli typecheck
pnpm --filter @tingrudeng/worker-review-orchestrator-cli test
pnpm --filter @tingrudeng/worker-review-orchestrator-cli build
git diff --check
```

If the package behavior depends on live dispatcher flows, also run the relevant focused dispatcher tests from the repository root.

## Publish

Preview from the repository root, then prepare the version-only pull request:

```bash
node scripts/release-package.js --package worker-review-orchestrator-cli --bump prerelease --dry-run
node scripts/release-package.js --package worker-review-orchestrator-cli --bump prerelease --prepare
```

After CI passes, merge the version PR to protected `main`. The package manifest push automatically starts `.github/workflows/release.yml`; there is no manual dispatch release path. The workflow publishes one prepared tarball and verifies the exact npm registry artifact before a separate least-privilege job records the release tag. It never writes to `main`; do not add `[skip actions]` to the version commit.

## Intended Install Shape

After publish, users should be able to install the CLI globally with:

```bash
npm install -g @tingrudeng/worker-review-orchestrator-cli
forgeflow-review-orchestrator --help
```

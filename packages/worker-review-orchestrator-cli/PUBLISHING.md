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

Preview from the repository root, then use `.github/workflows/release.yml` for the formal OIDC release:

```bash
node scripts/release-package.js --package worker-review-orchestrator-cli --bump prerelease --dry-run
```

The workflow publishes one prepared tarball and verifies the exact npm registry artifact before reporting success.

## Intended Install Shape

After publish, users should be able to install the CLI globally with:

```bash
npm install -g @tingrudeng/worker-review-orchestrator-cli
forgeflow-review-orchestrator --help
```

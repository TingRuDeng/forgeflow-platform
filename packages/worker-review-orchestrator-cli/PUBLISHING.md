# Publishing @tingrudeng/worker-review-orchestrator-cli

## Release Gate

Before publishing:

```bash
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core build
pnpm --filter @tingrudeng/worker-review-orchestrator-cli typecheck
pnpm --filter @tingrudeng/worker-review-orchestrator-cli test
pnpm --filter @tingrudeng/worker-review-orchestrator-cli build
git diff --check
```

If the package behavior depends on live dispatcher flows, also run the relevant focused dispatcher tests from the repository root.

This CLI imports `@tingrudeng/beta-runtime-core/runtime/secure-config-file.js`. When that
subpath or its behavior changes, publish the matching `beta-runtime-core` version first,
then prepare the CLI version pull request. The release preflight rejects an unpublished
workspace dependency version, but the dependency order must still be preserved across the
separate one-package release merges.

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
npm install -g @tingrudeng/worker-review-orchestrator-cli@beta
forgeflow-review-orchestrator --help
```

Prerelease publishes advance `beta`; `latest` is reserved for a future stable version and is not
manually mirrored after publish.

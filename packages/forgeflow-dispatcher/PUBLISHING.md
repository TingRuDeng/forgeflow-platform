# Publishing @tingrudeng/forgeflow-dispatcher

This package is prepared for public npm publishing as the installable ForgeFlow dispatcher/control-plane runtime.

## Verification Before Publish

Run:

```bash
pnpm --filter @tingrudeng/forgeflow-dispatcher test
pnpm --filter @tingrudeng/forgeflow-dispatcher typecheck
pnpm --filter @tingrudeng/forgeflow-dispatcher build
pnpm --filter @tingrudeng/forgeflow-dispatcher pack
pnpm test
pnpm typecheck
git diff --check
```

## Install Smoke Check

After a release, verify:

```bash
npm install -g @tingrudeng/forgeflow-dispatcher
forgeflow-dispatcher init
forgeflow-dispatcher doctor
forgeflow-dispatcher version
```

## Publishing Model

This repository uses GitHub Actions Trusted Publishing for `@tingrudeng/*` public packages.

Normal path:
- merge the versioned `packages/forgeflow-dispatcher/package.json` change to `main`
- let `.github/workflows/release.yml` auto-detect and publish the exact version

Manual path:

```bash
node scripts/release-package.js --package forgeflow-dispatcher --bump prerelease --tag beta --publish --ci
```

## Notes

- This package bundles dispatcher runtime code from the repository source-of-truth implementation; `apps/dispatcher` itself remains private.
- Keep the package README, root README, docs/README, and `docs/runbooks/single-machine-deployment.md` aligned when changing package behavior.

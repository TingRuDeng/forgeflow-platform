# Publishing @tingrudeng/automation-gateway-core

This package is prepared for public npm publishing so `@tingrudeng/trae-beta-runtime` can depend on it without a source checkout.

The repository release path is GitHub Actions only:

- workflow: `.github/workflows/release.yml`
- auth model: npm Trusted Publishing via GitHub OIDC
- repo-side enable gate: repository/org variable `NPM_TRUSTED_PUBLISHING_ENABLED=true`
- npm CLI: `11.5.1+` required, workflow currently upgrades to `11.12.1`

## Preconditions

- Node 22+
- pnpm installed
- npm access to publish the `@tingrudeng` scope
- a clean checkout of the ForgeFlow repository
- npm must already trust GitHub repo `TingRuDeng/forgeflow-platform` as a Trusted Publisher for `@tingrudeng/automation-gateway-core`

## Validate before publish

```bash
pnpm install
pnpm --filter @tingrudeng/automation-gateway-core test
pnpm --filter @tingrudeng/automation-gateway-core typecheck
pnpm --filter @tingrudeng/automation-gateway-core build
pnpm --filter @tingrudeng/automation-gateway-core pack
```

If the consuming runtime changed in the same release train, also validate:

```bash
pnpm --filter @tingrudeng/trae-beta-runtime test
pnpm --filter @tingrudeng/trae-beta-runtime typecheck
pnpm --filter @tingrudeng/trae-beta-runtime pack
```

## Publish flow

Preferred path:

1. Configure npm Trusted Publisher for `@tingrudeng/automation-gateway-core` and repo `TingRuDeng/forgeflow-platform`
2. Set repository/org variable `NPM_TRUSTED_PUBLISHING_ENABLED=true`
3. Trigger `.github/workflows/release.yml`

From the repository root:

```bash
pnpm --filter @tingrudeng/automation-gateway-core build
pnpm --filter @tingrudeng/automation-gateway-core publish --access public --no-git-checks
```

When a new `@tingrudeng/trae-beta-runtime` version depends on a new core version, publish this package first.

## Notes

- This package only contains shared report-parsing helpers.
- It should stay small and dependency-light.
- It is not intended to become a second runtime package.

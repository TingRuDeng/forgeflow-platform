# Publishing @tingrudeng/trae-beta-runtime

This package is prepared for **public beta npm publishing**.

The repository release path is GitHub Actions only:

- workflow: `.github/workflows/release.yml`
- auth model: npm Trusted Publishing via GitHub OIDC
- repo-side enable gate: repository/org variable `NPM_TRUSTED_PUBLISHING_ENABLED=true`
- npm CLI: `11.5.1+` required, workflow currently upgrades to `11.12.1`

## Preconditions

- Node 22+
- pnpm installed
- the npm package name and Trusted Publisher binding for the `@tingrudeng` scope
- a clean checkout of the ForgeFlow repository
- npm must already trust GitHub repo `TingRuDeng/forgeflow-platform` as a Trusted Publisher for `@tingrudeng/trae-beta-runtime`

## Validate before publish

```bash
pnpm install
pnpm --filter @tingrudeng/trae-beta-runtime test
pnpm --filter @tingrudeng/trae-beta-runtime typecheck
pnpm --filter @tingrudeng/trae-beta-runtime build
pnpm --filter @tingrudeng/trae-beta-runtime pack
```

Because `@tingrudeng/trae-beta-runtime` depends on two shared packages, verify both when either changes in the same release train:

```bash
pnpm --filter @tingrudeng/automation-gateway-core test
pnpm --filter @tingrudeng/automation-gateway-core typecheck
pnpm --filter @tingrudeng/automation-gateway-core build
pnpm --filter @tingrudeng/automation-gateway-core pack
pnpm --filter @tingrudeng/beta-runtime-core test
pnpm --filter @tingrudeng/beta-runtime-core typecheck
pnpm --filter @tingrudeng/beta-runtime-core build
pnpm --filter @tingrudeng/beta-runtime-core pack
```

Before the first public beta publish, also run one real remote-machine smoke check:

```bash
node packages/trae-beta-runtime/dist/cli.js init ...
node packages/trae-beta-runtime/dist/cli.js doctor
node packages/trae-beta-runtime/dist/cli.js start launch
node packages/trae-beta-runtime/dist/cli.js start gateway
node packages/trae-beta-runtime/dist/cli.js start worker
```

The minimum gate is:
- `doctor` passes on the remote machine
- `start launch` can attach to Trae with remote debugging enabled
- `start gateway` binds at the configured automation URL host/port
- `start worker` registers in dispatcher and reaches `idle`
- repeated `start gateway` / `start worker` calls reuse the existing managed process unless `--force` is used
- `start launch/gateway/worker --detach --log-file <path>` runs the process in the background and writes logs to the specified file

If you want full repository confidence before cutting a package version:

```bash
pnpm test
pnpm typecheck
git diff --check
```

## Package scope

The package is configured for public publish:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

## Publish flow

Preferred path:

1. Configure npm Trusted Publisher for `@tingrudeng/trae-beta-runtime` and repo `TingRuDeng/forgeflow-platform`
2. Set repository/org variable `NPM_TRUSTED_PUBLISHING_ENABLED=true`
3. Trigger `.github/workflows/release.yml`

Preview the version changes from the repository root:

```bash
node scripts/release-package.js --package automation-gateway-core --bump prerelease --dry-run
node scripts/release-package.js --package beta-runtime-core --bump prerelease --dry-run
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --dry-run
```

If a shared core did not change for this release and the referenced dependency version already exists on npm, you can skip republishing it. When versions change together, publish `automation-gateway-core` and `beta-runtime-core` before `trae-beta-runtime`.
The workflow prepares one tarball, publishes that exact file with OIDC provenance, then verifies npm `dist.integrity`, `dist.shasum`, contents, bin links, and installability before the release is complete.

## Install flow on a remote machine

After publish, the intended install shape is:

```bash
pnpm add -g @tingrudeng/trae-beta-runtime
forgeflow-trae-beta init
forgeflow-trae-beta doctor
forgeflow-trae-beta start launch
forgeflow-trae-beta start gateway
forgeflow-trae-beta start worker
forgeflow-trae-beta update
forgeflow-trae-beta version
forgeflow-trae-beta --version
forgeflow-trae-beta status
forgeflow-trae-beta stop gateway
forgeflow-trae-beta stop worker
```

To replace an already-running managed local process:

```bash
forgeflow-trae-beta start gateway --force
forgeflow-trae-beta start worker --force
```

`status` reports the local runtime config and the current gateway/worker process state.
`stop gateway` and `stop worker` stop the local processes created by ForgeFlow's
`dist/runtime/run-trae-automation-gateway.js` and `dist/runtime/worker.js` entrypoints.
They stop those exact local processes rather than trying to infer intent from the package name.

This package no longer requires a local ForgeFlow checkout on the remote machine.
The remote machine still needs a local checkout of the target project repository that Trae will open and execute tasks against.

## Recommended first public beta release gate

Do not cut the first public beta release until all of the following are true:

1. The package builds and passes package-local verification
2. `pnpm pack` succeeds for `@tingrudeng/trae-beta-runtime` and both shared core packages when either dependency changed
3. The full repository still passes `pnpm test` and `pnpm typecheck`
4. A real remote-machine smoke run passes with:
   - local target project checkout present
   - Trae desktop installed
   - dispatcher reachable
   - worker visible in dispatcher after `start worker`
5. The current README still matches the real install/start flow

## Notes

- This package only covers the remote Trae runtime.
- The ForgeFlow dispatcher remains a separate control-plane deployment.
- The package assumes the remote machine has a local checkout of the target project repository to execute tasks against.
- The package does not require a local ForgeFlow checkout.
- The package depends on `@tingrudeng/automation-gateway-core` and `@tingrudeng/beta-runtime-core`; publish changed dependency versions before the Trae runtime.
- The repository and package are intended to be distributed under Apache-2.0.

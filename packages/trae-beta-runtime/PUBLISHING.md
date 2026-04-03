# Publishing @tingrudeng/trae-beta-runtime

This package is prepared for **public beta npm publishing**, but is not published automatically from this repository.

## Preconditions

- Node 22+
- pnpm installed
- npm access to publish the `@tingrudeng` scope
- a clean checkout of the ForgeFlow repository

## Validate before publish

```bash
pnpm --filter @tingrudeng/trae-beta-runtime test
pnpm --filter @tingrudeng/trae-beta-runtime typecheck
pnpm --filter @tingrudeng/trae-beta-runtime build
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

From the repository root:

```bash
pnpm --filter @tingrudeng/trae-beta-runtime build
pnpm --filter @tingrudeng/trae-beta-runtime publish --access public --no-git-checks
```

If your registry requires an explicit host, configure npm/pnpm auth first and then publish with the registry your environment expects.

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
2. The full repository still passes `pnpm test` and `pnpm typecheck`
3. A real remote-machine smoke run passes with:
   - local target project checkout present
   - Trae desktop installed
   - dispatcher reachable
   - worker visible in dispatcher after `start worker`
4. The current README still matches the real install/start flow

## Notes

- This package only covers the remote Trae runtime.
- The ForgeFlow dispatcher remains a separate control-plane deployment.
- The package assumes the remote machine has a local checkout of the target project repository to execute tasks against.
- The package does not require a local ForgeFlow checkout.
- The repository and package are intended to be distributed under Apache-2.0.

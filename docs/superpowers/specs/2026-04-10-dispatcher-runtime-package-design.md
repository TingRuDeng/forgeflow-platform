# Dispatcher Runtime Package Design

> Historical note: this spec defines the first public npm package that lets users run ForgeFlow dispatcher/control-plane behavior without cloning the source repository.

## Goal

Ship a globally installable npm package that exposes dispatcher/control-plane runtime capabilities through a stable CLI, so external users can:

- `npm install -g` one package
- initialize runtime config
- start a single-node SQLite dispatcher
- run health/config checks
- back up and restore runtime state

without needing a local checkout of `forgeflow-platform`.

## Chosen Shape

We will **not** publish `apps/dispatcher` directly. Instead, we will add a new product/runtime package:

- package name: `@tingrudeng/forgeflow-dispatcher`
- command name: `forgeflow-dispatcher`

This package is a runtime product, not a reusable library. `apps/dispatcher` remains the private source-of-truth implementation.

## Scope

### Included in v1

- `init`
- `start`
- `doctor`
- `status`
- `backup`
- `restore`
- `version`

Default deployment mode is single-node SQLite.

### Explicitly deferred

- process supervisor / detached lifecycle manager
- full multi-instance deployment UX
- Postgres primary mode
- public library-style exports for dispatcher internals

## Packaging Strategy

The runtime package must work without access to private workspace packages. To achieve that, its build step will bundle the dispatcher runtime graph into package-local output.

Approach:

- add a new package under `packages/forgeflow-dispatcher`
- package CLI sources import dispatcher source modules from `apps/dispatcher/src/...`
- package build uses `esbuild` to bundle the CLI and dispatcher runtime into self-contained `dist/*.js`
- internal workspace modules are bundled into the final artifact instead of being installed as registry dependencies

This keeps `apps/dispatcher` private while producing an installable runtime package.

## Runtime Model

Configuration lives outside the repository at:

- `~/.forgeflow-dispatcher/config.json`

Default config values:

- `host=127.0.0.1`
- `port=8787`
- `stateDir=~/.forgeflow-dispatcher/state`
- `persistenceBackend=sqlite`
- `authMode=token`

`init` writes config. `start` reads config and launches the dispatcher in the foreground. `doctor` validates config, state-dir writability, and optional local `/health`. `backup` and `restore` operate on the configured runtime state directory.

## Docs and Release

This package becomes a new public runtime entrypoint and therefore must update:

- `README.md`
- `docs/README.md`
- `docs/runbooks/single-machine-deployment.md`
- package-local `README.md`
- package-local `PUBLISHING.md`

Release should ride the existing package auto-publish workflow by adding `packages/forgeflow-dispatcher/package.json` with an initial beta version.

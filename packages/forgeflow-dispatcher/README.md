# @tingrudeng/forgeflow-dispatcher

Self-contained ForgeFlow dispatcher/control-plane runtime package for single-node SQLite deployments.

This package is for users who want dispatcher/control-plane behavior without cloning the `forgeflow-platform` source repository.

Current scope:
- initialize local runtime config
- start a foreground dispatcher server
- inspect local runtime health/config
- back up runtime state
- restore runtime state

This package is intentionally a runtime product, not a reusable dispatcher library. The source of truth implementation still lives in `apps/dispatcher` inside the main repository.

## Install

```bash
npm install -g @tingrudeng/forgeflow-dispatcher@beta
```

The package is currently prerelease, so `beta` is the supported install channel. `latest` is
reserved for a future stable release and may point to an older prerelease.

## Quick Start

```bash
forgeflow-dispatcher init
forgeflow-dispatcher doctor
forgeflow-dispatcher start
```

The default runtime config is stored at:

```text
~/.forgeflow-dispatcher/config.json
```

Default values:
- `host=127.0.0.1`
- `port=8787`
- `stateDir=~/.forgeflow-dispatcher/state`
- `persistenceBackend=sqlite`
- `authMode=token`

`init` generates and saves a token by default when `authMode=token`.
The secure config entrypoints support Unix-like platforms (macOS / Linux) only and fail closed elsewhere. The default config directory and file are owner-only (`0700` / `0600`). Writes use a private temporary file in the same directory and atomic replacement. Reads reject symbolic links in the config file or user-controlled directory path, insecure permissions, and directory ancestors that another user can replace; file contents are read from the same descriptor whose identity and permissions were validated. Rerun `init` to repair permissions created by an older package version without dropping the saved token.

## Commands

```bash
forgeflow-dispatcher init
forgeflow-dispatcher init --host 127.0.0.1 --port 8787 --state-dir ~/.forgeflow-dispatcher/state --auth-mode token
forgeflow-dispatcher doctor
forgeflow-dispatcher status
forgeflow-dispatcher start
forgeflow-dispatcher backup
forgeflow-dispatcher restore --backup-dir /abs/path/to/backup
forgeflow-dispatcher version
```

Command notes:
- `start` runs the dispatcher in the foreground
- `doctor` validates config, auth expectations, state-dir writability, and optional local `/health`
- `status` prints configured base URL and best-effort local health reachability
- `backup` shares the repository backup core: it serializes with dispatcher mutations, copies SQLite/WAL/SHM, JSON rescue, shadow/reconciler status, and cutover evidence files, then writes a v1 manifest with file size/SHA-256 and a validated SQLite snapshot watermark
- `restore` verifies the complete v1 manifest before changing `stateDir`, stages replacements, rolls back a failed apply, and removes stale runtime sidecars absent from the backup; stop the dispatcher and direct file/SQLite writers before a production restore

## Authentication

Supported auth modes:
- `token` (default)
- `legacy`
- `open`

Examples:

```bash
printf '%s' "$DISPATCHER_API_TOKEN" \
  | forgeflow-dispatcher init --auth-mode token --token-stdin
forgeflow-dispatcher init --auth-mode open
```

The legacy `--token` argument is rejected so credentials do not enter process arguments or shell history. `init --token-stdin` persists the token; `start --token-stdin` applies it only to that foreground process.

## Limits

This package currently targets:
- single-node SQLite dispatcher deployments
- local control-plane operators
- foreground process management

It does not yet provide:
- a detached process supervisor
- multi-instance orchestration
- Postgres primary mode
- public dispatcher library exports

## Notes

- Node 22+ is required.
- The package is self-contained and does not require a local checkout of `forgeflow-platform`.
- For source-repo operation and development workflows, the repository-local path in the main `README.md` is still supported.
- Release steps are documented in [`PUBLISHING.md`](./PUBLISHING.md).

# Publishing @tingrudeng/gemini-beta-runtime

This package is prepared for **public beta npm publishing**, but is not published automatically from this repository.

## Preconditions

- Node 22+
- pnpm installed
- npm access to publish the `@tingrudeng` scope
- a clean checkout of the ForgeFlow repository

## Validate before publish

```bash
pnpm --filter @tingrudeng/gemini-beta-runtime test
pnpm --filter @tingrudeng/gemini-beta-runtime typecheck
pnpm --filter @tingrudeng/gemini-beta-runtime build
```

Before the first public beta publish, also run one real remote-machine smoke check:

```bash
node packages/gemini-beta-runtime/dist/cli.js init ...
node packages/gemini-beta-runtime/dist/cli.js doctor
node packages/gemini-beta-runtime/dist/cli.js start worker --once
node packages/gemini-beta-runtime/dist/cli.js status
```

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
pnpm --filter @tingrudeng/gemini-beta-runtime build
pnpm --filter @tingrudeng/gemini-beta-runtime publish --access public --no-git-checks
```

## Install flow on a remote machine

After publish, the intended install shape is:

```bash
pnpm add -g @tingrudeng/gemini-beta-runtime
forgeflow-gemini-beta init
forgeflow-gemini-beta doctor
forgeflow-gemini-beta start worker
forgeflow-gemini-beta status
forgeflow-gemini-beta stop worker
forgeflow-gemini-beta update
```

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

Build and publish from the repository root:

```bash
pnpm --filter @tingrudeng/worker-review-orchestrator-cli build
pnpm --filter @tingrudeng/worker-review-orchestrator-cli publish --access public --no-git-checks
```

## Intended Install Shape

After publish, users should be able to install the CLI globally with:

```bash
npm install -g @tingrudeng/worker-review-orchestrator-cli
forgeflow-review-orchestrator --help
```

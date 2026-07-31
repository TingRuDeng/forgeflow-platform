---
name: package-release
description: Use when previewing or preparing ForgeFlow npm package version PRs. Formal publishing starts automatically after the version PR reaches main.
---

# Package Release Helper

## Install

Install this skill globally at the user level:

```bash
npx skills add https://github.com/TingRuDeng/forgeflow-platform/skills --skill package-release -g -y
```

This skill does not ship a separate npm CLI. After installing the skill, run the repository script from a forgeflow-platform checkout.


Use this skill when you need to release or version-bump ForgeFlow npm packages.

## Safety Semantics

This helper is **preview-or-prepare only**:

- **Normal invocation**: Shows what would happen, and never modifies package.json or npm
- **With `--prepare`**: Changes only the target package's version field for a protected-branch pull request
- **With `--publish` flag**: Fails closed; there is no second script-based publish path
- **Formal publish**: Merging the version PR triggers `.github/workflows/release.yml`, which prepares and uploads one exact tarball with OIDC provenance
- **Git record**: A separate least-privilege workflow job records an idempotent release tag after publish verification succeeds
- **Publish command**: Uses `npm publish <prepared-tarball> --ignore-scripts` so lifecycle scripts cannot repack or change the payload
- **Dist-tag policy**: prerelease versions use `beta`; stable versions use `latest`

This prevents local registry writes and keeps every version change behind normal review and branch protection.

## CLI Usage

### Dry-run (Default)

Preview what would be published without making any changes:

```bash
node scripts/release-package.js --package trae-beta-runtime --bump prerelease
```

This will show:
- Current version
- New version that would be created
- Commands that would be executed
- No actual changes to package.json or npm registry

### Prepare the version PR

After reviewing the preview, update only the target manifest version:

```bash
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --prepare
```

Review the diff, commit it on a release branch, open a pull request, wait for CI, and merge it to `main`. The resulting package manifest push automatically starts the Release workflow. There is no manual `workflow_dispatch` release path.

The workflow will:
1. Detect exact package versions that do not yet exist in npm
2. Build and validate the package at the merged commit
3. Prepare and publish one exact tarball with Trusted Publishing and provenance
4. Download `dist.tarball` and verify the expected dist-tag, integrity, exact contents, bin links, and installability
5. Record `release/<package>@<version>` in a separate idempotent tag job

### Explicit Dry-run

You can also be explicit about dry-run mode:

```bash
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --dry-run
```

## Required Parameters

- `--package <name>`: Package name (without @tingrudeng/ prefix)
  - Example: `trae-beta-runtime`, `worker-review-orchestrator-cli`
- `--bump <type>`: Version bump type
  - `major`: Breaking changes (1.0.0 → 2.0.0)
  - `minor`: New features (1.0.0 → 1.1.0)
  - `patch`: Bug fixes (1.0.0 → 1.0.1)
  - `prerelease`: Beta releases (1.0.0 → 1.0.1-beta.1 or 1.0.1-beta.1 → 1.0.1-beta.2)

## Optional Parameters

- `--publish`: Deprecated and always rejected
- `--prepare`: Update only the target manifest version for a pull request
- `--tag <name>`: Must be `beta` for prereleases or `latest` for stable versions
- `--dry-run`: Explicit dry-run mode (default behavior)
- `--help`: Show help message

## Workflow

1. **Always start with dry-run**: Preview the release first
   ```bash
   node scripts/release-package.js --package <name> --bump <type>
   ```

2. **Verify the output**: Check that the version bump is correct

3. **Prepare the version change**:
   ```bash
   node scripts/release-package.js --package <name> --bump <type> --prepare
   ```

4. **Release through the protected branch**: Commit the version-only diff, open a pull request, pass CI, and merge it to `main`. The merge push starts the formal release automatically.

Prepare and merge only one package version at a time. When a provider depends on a new shared core, release and verify the core first, then create the provider version PR from the updated `main`.

## Prerelease Versioning

For prerelease versions, the helper follows this pattern:

- If current version is `1.0.0`:
  - `--bump prerelease` → `1.0.0-beta.1`
- If current version is `1.0.0-beta.1`:
  - `--bump prerelease` → `1.0.0-beta.2`
- If current version is `1.0.0-beta.5`:
  - `--bump prerelease` → `1.0.0-beta.6`

## Safety Guarantees

1. **No accidental modifications**: Preview mode never changes package.json; `--prepare` changes only its version field
2. **Single publish path**: Every helper publish attempt fails before package discovery or mutation
3. **Exact artifact**: The uploaded tarball is created once and compared with npm registry integrity metadata after publish
4. **No workspace protocol leaks**: Packed dependency metadata cannot retain `workspace:`
5. **Clear preview**: Dry-run shows exactly what would happen
6. **Protected version history**: Formal release requires a version PR to reach `main`; the workflow never pushes to `main`
7. **Least-privilege tags**: npm OIDC publishing and Git tag writes run in separate jobs
8. **No partial release matrix**: The workflow rejects more than one unpublished package version before any npm write

## Integration with PUBLISHING.md

This helper aligns with the package-level PUBLISHING.md files:

- `packages/trae-beta-runtime/PUBLISHING.md`
- `packages/worker-review-orchestrator-cli/PUBLISHING.md`

The helper previews or prepares the version decision; the GitHub workflow automates registry and release-tag state changes after merge.

## Common Mistakes to Avoid

1. **Don't forget to preview first**: Run without `--prepare` first
2. **Don't skip the build**: The Release workflow builds before packing
3. **Don't create a second publish path**: Use `--prepare` for the version PR and the Release workflow for npm writes
4. **Don't publish a source directory**: The release path publishes the prepared tarball only
5. **Don't bypass registry verification**: A publish is not complete until exact tarball verification passes
6. **Don't add `[skip actions]`**: The merge push is the release trigger

## Error Handling

If preview validation fails, the helper exits non-zero without changing files. If `--prepare` cannot preserve the manifest formatting, it also fails without rewriting the file. If the Release workflow fails, it:
- exits with a non-zero status
- prints a clear error
- writes a recovery summary when npm succeeded but registry verification or release-tag recording failed

## Examples

### Release a new beta version

```bash
# Preview
node scripts/release-package.js --package trae-beta-runtime --bump prerelease

# Prepare the version PR; merge it after CI passes
node scripts/release-package.js --package trae-beta-runtime --bump prerelease --prepare
```

### Release a patch version

```bash
# Preview
node scripts/release-package.js --package worker-review-orchestrator-cli --bump patch

# Prepare the version PR; merge it after CI passes
node scripts/release-package.js --package worker-review-orchestrator-cli --bump patch --prepare
```

### Release a minor version

```bash
# Preview
node scripts/release-package.js --package trae-beta-runtime --bump minor

# Prepare the version PR; merge it after CI passes
node scripts/release-package.js --package trae-beta-runtime --bump minor --prepare
```

## Response Pattern

When using this skill, report in this order:

1. Package name and current version
2. New version to be released
3. Mode: preview, version PR preparation, or automatic GitHub workflow publish
4. If publishing: merged commit, workflow run, prepared tarball integrity, publish result, release tag, and registry tarball verification
5. Final status: success or failure

Keep the output clear and actionable. If there's an error, explain what went wrong and what to do next.

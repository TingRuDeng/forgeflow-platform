---
name: package-release
description: Use when previewing or releasing ForgeFlow npm packages. The local helper is preview-only; formal publishing runs exclusively through the GitHub Release workflow.
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

This helper is **preview-only**:

- **Normal invocation**: Shows what would happen, and never modifies package.json or npm
- **With `--publish` flag**: Fails closed; there is no second script-based publish path
- **Formal publish**: `.github/workflows/release.yml` prepares and uploads one exact tarball with OIDC provenance
- **Publish command**: Uses `npm publish <prepared-tarball> --ignore-scripts` so lifecycle scripts cannot repack or change the payload
- **Dist-tag policy**: prerelease versions use `beta`; stable versions use `latest`

This prevents accidental version bumps and ensures you can preview changes before committing to them.

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

### Actually Publish

Dispatch `.github/workflows/release.yml` from `main`:

```bash
gh workflow run release.yml --ref main -f package=trae-beta-runtime -f bump=prerelease -f tag=beta
```

The workflow will:
1. Update package.json with the new version
2. Build the package
3. Prepare and validate one exact tarball
4. Publish that tarball with Trusted Publishing and provenance
5. Download `dist.tarball` from npm and verify the expected dist-tag, integrity, exact contents, bin links, and installability

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
- `--tag <name>`: Must be `beta` for prereleases or `latest` for stable versions
- `--dry-run`: Explicit dry-run mode (default behavior)
- `--help`: Show help message

## Workflow

1. **Always start with dry-run**: Preview the release first
   ```bash
   node scripts/release-package.js --package <name> --bump <type>
   ```

2. **Verify the output**: Check that the version bump is correct

3. **Publish through GitHub Actions**: Dispatch the Release workflow from `main`:
   ```bash
   gh workflow run release.yml --ref main -f package=<name> -f bump=<type> -f tag=<beta|latest>
   ```

## Prerelease Versioning

For prerelease versions, the helper follows this pattern:

- If current version is `1.0.0`:
  - `--bump prerelease` → `1.0.0-beta.1`
- If current version is `1.0.0-beta.1`:
  - `--bump prerelease` → `1.0.0-beta.2`
- If current version is `1.0.0-beta.5`:
  - `--bump prerelease` → `1.0.0-beta.6`

## Safety Guarantees

1. **No accidental modifications**: The helper never changes package.json
2. **Single publish path**: Every helper publish attempt fails before package discovery or mutation
3. **Exact artifact**: The uploaded tarball is created once and compared with npm registry integrity metadata after publish
4. **No workspace protocol leaks**: Packed dependency metadata cannot retain `workspace:`
5. **Clear preview**: Dry-run shows exactly what would happen
6. **Explicit action**: Formal release requires dispatching the protected GitHub workflow

## Integration with PUBLISHING.md

This helper aligns with the package-level PUBLISHING.md files:

- `packages/trae-beta-runtime/PUBLISHING.md`
- `packages/worker-review-orchestrator-cli/PUBLISHING.md`

The helper previews the release decision; the GitHub workflow automates the state-changing steps documented in those files.

## Common Mistakes to Avoid

1. **Don't forget to preview first**: Always run without `--publish` first
2. **Don't skip the build**: The Release workflow builds before packing
3. **Don't create a second publish path**: Use the Release workflow for version bumps and npm writes
4. **Don't publish a source directory**: The release path publishes the prepared tarball only
5. **Don't bypass registry verification**: A publish is not complete until exact tarball verification passes

## Error Handling

If preview validation fails, the helper exits non-zero without changing files. If the Release workflow fails, it:
- exits with a non-zero status
- prints a clear error
- creates a recovery summary and issue when npm succeeded but the post-publish git record failed

## Examples

### Release a new beta version

```bash
# Preview
node scripts/release-package.js --package trae-beta-runtime --bump prerelease

# Publish
gh workflow run release.yml --ref main -f package=trae-beta-runtime -f bump=prerelease -f tag=beta
```

### Release a patch version

```bash
# Preview
node scripts/release-package.js --package worker-review-orchestrator-cli --bump patch

# Publish
gh workflow run release.yml --ref main -f package=worker-review-orchestrator-cli -f bump=patch -f tag=latest
```

### Release a minor version

```bash
# Preview
node scripts/release-package.js --package trae-beta-runtime --bump minor

# Publish
gh workflow run release.yml --ref main -f package=trae-beta-runtime -f bump=minor -f tag=latest
```

## Response Pattern

When using this skill, report in this order:

1. Package name and current version
2. New version to be released
3. Mode: preview or GitHub workflow publish
4. If publishing: workflow run, prepared tarball integrity, publish result, and registry tarball verification
5. Final status: success or failure

Keep the output clear and actionable. If there's an error, explain what went wrong and what to do next.

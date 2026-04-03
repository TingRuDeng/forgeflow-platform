---
name: package-release
description: Use when releasing ForgeFlow npm packages. This skill provides a safe, dry-run-by-default release helper that prevents accidental package.json modifications and ensures proper publish flags.
---

# Package Release Helper

Use this skill when you need to release or version-bump ForgeFlow npm packages.

## Safety Semantics

This helper is designed with **dry-run by default**:

- **Without `--publish` flag**: Shows what would happen, does NOT modify package.json or publish
- **With `--publish` flag**: Actually updates package.json version AND publishes to npm
- **Publish command**: Always uses `--no-git-checks` to avoid git state conflicts

This prevents accidental version bumps and ensures you can preview changes before committing to them.

## CLI Usage

### Dry-run (Default)

Preview what would be published without making any changes:

```bash
node scripts/release-package.mjs --package trae-beta-runtime --bump prerelease
```

This will show:
- Current version
- New version that would be created
- Commands that would be executed
- No actual changes to package.json or npm registry

### Actually Publish

When you're ready to publish for real:

```bash
node scripts/release-package.mjs --package trae-beta-runtime --bump prerelease --publish
```

This will:
1. Update package.json with the new version
2. Build the package
3. Publish to npm with `--access public --no-git-checks`

### Explicit Dry-run

You can also be explicit about dry-run mode:

```bash
node scripts/release-package.mjs --package trae-beta-runtime --bump prerelease --dry-run
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

- `--publish`: Actually publish (default: dry-run only)
- `--dry-run`: Explicit dry-run mode (default behavior)
- `--help`: Show help message

## Workflow

1. **Always start with dry-run**: Preview the release first
   ```bash
   node scripts/release-package.mjs --package <name> --bump <type>
   ```

2. **Verify the output**: Check that the version bump is correct

3. **Publish when ready**: Add `--publish` flag
   ```bash
   node scripts/release-package.mjs --package <name> --bump <type> --publish
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

1. **No accidental modifications**: Without `--publish`, package.json is never modified
2. **No git check failures**: Publish always uses `--no-git-checks`
3. **Clear preview**: Dry-run shows exactly what would happen
4. **Explicit action**: Must pass `--publish` to make real changes

## Integration with PUBLISHING.md

This helper aligns with the package-level PUBLISHING.md files:

- `packages/trae-beta-runtime/PUBLISHING.md`
- `packages/worker-review-orchestrator-cli/PUBLISHING.md`

The helper automates the manual steps documented in those files while adding safety checks.

## Common Mistakes to Avoid

1. **Don't forget to preview first**: Always run without `--publish` first
2. **Don't skip the build**: The helper runs build automatically, don't skip it
3. **Don't manually edit package.json**: Let the helper handle version bumps
4. **Don't forget --no-git-checks**: The helper includes this automatically

## Error Handling

If any step fails (build, publish), the helper will:
- Exit with non-zero status code
- Print clear error messages
- For publish failures: note that package.json was already updated

## Examples

### Release a new beta version

```bash
# Preview
node scripts/release-package.mjs --package trae-beta-runtime --bump prerelease

# Publish
node scripts/release-package.mjs --package trae-beta-runtime --bump prerelease --publish
```

### Release a patch version

```bash
# Preview
node scripts/release-package.mjs --package worker-review-orchestrator-cli --bump patch

# Publish
node scripts/release-package.mjs --package worker-review-orchestrator-cli --bump patch --publish
```

### Release a minor version

```bash
# Preview
node scripts/release-package.mjs --package trae-beta-runtime --bump minor

# Publish
node scripts/release-package.mjs --package trae-beta-runtime --bump minor --publish
```

## Response Pattern

When using this skill, report in this order:

1. Package name and current version
2. New version to be released
3. Mode: dry-run or publish
4. If publish: result of build and publish steps
5. Final status: success or failure

Keep the output clear and actionable. If there's an error, explain what went wrong and what to do next.

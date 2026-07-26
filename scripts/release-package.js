#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
const args = process.argv.slice(2);
const parsedArgs = {};
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
            parsedArgs[key] = args[i + 1];
            i++;
        }
        else {
            parsedArgs[key] = true;
        }
    }
}
function showHelp() {
    console.log(`
Package Release Helper

Usage:
  node scripts/release-package.js --package <package-name> --bump <version-type> [options]

Options:
  --package <name>       Package name to release (required)
  --bump <type>          Version bump type: major, minor, patch, prerelease (required)
  --tag <name>           npm dist-tag to publish with (optional)
  --publish              Deprecated and rejected; formal publishing only runs through the Release workflow
  --dry-run              Explicit dry-run mode (default behavior)
  --help                 Show this help message

Behavior:
  - Always previews the version and exact-tarball release steps
  - Never modifies package.json or publishes
  - Formal publishing is owned exclusively by .github/workflows/release.yml

Examples:
  # Dry-run: see what version would be published
  node scripts/release-package.js --package codex-beta-runtime --bump prerelease
  node scripts/release-package.js --package trae-beta-runtime --bump prerelease

  # Explicit dry-run
  node scripts/release-package.js --package trae-beta-runtime --bump prerelease --dry-run
`);
}
if (parsedArgs.help) {
    showHelp();
    process.exit(0);
}
if (!parsedArgs.package) {
    console.error('Error: --package is required');
    showHelp();
    process.exit(1);
}
if (!parsedArgs.bump) {
    console.error('Error: --bump is required (major, minor, patch, prerelease)');
    showHelp();
    process.exit(1);
}
const packageName = parsedArgs.package;
const bumpType = parsedArgs.bump;
const shouldPublish = parsedArgs.publish === true;
const distTag = typeof parsedArgs.tag === "string" ? parsedArgs.tag : "";
const DIST_TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
function runCommand(command, commandArgs, options = {}) {
    const result = execFileSync(command, commandArgs, {
        encoding: "utf-8",
        cwd: workspacePath,
        ...options,
    });
    return typeof result === "string" ? result : result?.toString("utf-8") ?? "";
}
function validateDistTag(tag) {
    if (!tag) {
        return;
    }
    if (!DIST_TAG_PATTERN.test(tag)) {
        console.error(`Error: invalid dist-tag "${tag}"`);
        process.exit(1);
    }
}
validateDistTag(distTag);
if (shouldPublish) {
    console.error("Error: release-package is preview-only. Dispatch .github/workflows/release.yml for formal publishing.");
    process.exit(1);
}
const workspacePath = resolve(process.cwd());
let packagePath;
try {
    const pnpmListOutput = runCommand("pnpm", ["list", "--filter", `@tingrudeng/${packageName}`, "--json", "--depth", "-1"]);
    const packages = JSON.parse(pnpmListOutput);
    if (!packages || packages.length === 0) {
        throw new Error(`Package @tingrudeng/${packageName} not found`);
    }
    packagePath = packages[0].path;
}
catch (error) {
    console.error(`Error: Could not locate package @tingrudeng/${packageName}`);
    console.error(error.message);
    process.exit(1);
}
const packageJsonPath = resolve(packagePath, 'package.json');
let packageJson;
try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
}
catch (error) {
    console.error(`Error: Could not read package.json at ${packageJsonPath}`);
    console.error(error.message);
    process.exit(1);
}
const currentVersion = packageJson.version;
const versionParts = currentVersion.split('.');
let newVersion;
if (bumpType === 'prerelease') {
    if (currentVersion.includes('-beta.')) {
        const [base, prerelease] = currentVersion.split('-beta.');
        const prereleaseNum = parseInt(prerelease, 10);
        newVersion = `${base}-beta.${prereleaseNum + 1}`;
    }
    else {
        newVersion = `${currentVersion}-beta.1`;
    }
}
else {
    let [major, minor, patch] = versionParts.map(Number);
    if (currentVersion.includes('-beta.')) {
        [major, minor, patch] = currentVersion.split('-beta.')[0].split('.').map(Number);
    }
    switch (bumpType) {
        case 'major':
            major++;
            minor = 0;
            patch = 0;
            break;
        case 'minor':
            minor++;
            patch = 0;
            break;
        case 'patch':
            patch++;
            break;
        default:
            console.error(`Error: Unknown bump type: ${bumpType}`);
            process.exit(1);
    }
    newVersion = `${major}.${minor}.${patch}`;
}
const expectedDistTag = newVersion.includes("-") ? "beta" : "latest";
if (distTag && distTag !== expectedDistTag) {
    console.error(`Error: dist-tag mismatch for @tingrudeng/${packageName}@${newVersion}: expected ${expectedDistTag}, got ${distTag}`);
    process.exit(1);
}
const publishDistTag = distTag || expectedDistTag;
console.log(`\nPackage: @tingrudeng/${packageName}`);
console.log(`Current version: ${currentVersion}`);
console.log(`New version: ${newVersion}`);
console.log('Mode: PREVIEW (no changes will be made)');
console.log('\n[PREVIEW] The Release workflow will perform the following actions:');
console.log(`  1. Update ${packageJsonPath}`);
console.log(`     "version": "${currentVersion}" → "${newVersion}"`);
console.log(`  2. Build the package:`);
console.log(`     pnpm --filter @tingrudeng/${packageName} build`);
console.log(`  3. Prepare and publish one exact tarball (with Trusted Publishing):`);
console.log(`     npm publish <prepared-tarball> --ignore-scripts --access public --provenance --tag ${publishDistTag}`);
console.log(`  4. Download registry dist.tarball and verify dist-tag, integrity, exact contents, and installability`);
console.log('\nFormal publishing is available only through .github/workflows/release.yml');

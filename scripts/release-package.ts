#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

interface ParsedArgs {
  [key: string]: string | boolean;
}

const args = process.argv.slice(2);
const parsedArgs: ParsedArgs = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      parsedArgs[key] = args[i + 1];
      i++;
    } else {
      parsedArgs[key] = true;
    }
  }
}

function showHelp(): void {
  console.log(`
Package Release Helper

Usage:
  node scripts/release-package.js --package <package-name> --bump <version-type> [options]

Options:
  --package <name>       Package name to release (required)
  --bump <type>          Version bump type: major, minor, patch, prerelease (required)
  --publish              Actually publish to npm (default: dry-run only)
  --dry-run              Explicit dry-run mode (default behavior)
  --help                 Show this help message

Behavior:
  - Without --publish: Shows what would happen, does NOT modify package.json or publish
  - With --publish: Updates package.json version AND publishes to npm
  - Publish command uses --no-git-checks to avoid git state conflicts

Examples:
  # Dry-run: see what version would be published
  node scripts/release-package.js --package trae-beta-runtime --bump prerelease

  # Actually publish
  node scripts/release-package.js --package trae-beta-runtime --bump prerelease --publish

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

const packageName = parsedArgs.package as string;
const bumpType = parsedArgs.bump as string;
const shouldPublish = parsedArgs.publish === true;
const isDryRun = !shouldPublish;

const workspacePath = resolve(process.cwd());
let packagePath: string;

try {
  const pnpmListOutput = execSync(
    `pnpm list --filter @tingrudeng/${packageName} --json --depth -1`,
    { encoding: 'utf-8', cwd: workspacePath }
  );
  const packages = JSON.parse(pnpmListOutput);
  if (!packages || packages.length === 0) {
    throw new Error(`Package @tingrudeng/${packageName} not found`);
  }
  packagePath = packages[0].path;
} catch (error) {
  console.error(`Error: Could not locate package @tingrudeng/${packageName}`);
  console.error((error as Error).message);
  process.exit(1);
}

const packageJsonPath = resolve(packagePath, 'package.json');
let packageJson: { version: string; [key: string]: any };

try {
  const content = readFileSync(packageJsonPath, 'utf-8');
  packageJson = JSON.parse(content);
} catch (error) {
  console.error(`Error: Could not read package.json at ${packageJsonPath}`);
  console.error((error as Error).message);
  process.exit(1);
}

const currentVersion = packageJson.version;
const versionParts = currentVersion.split('.');
let newVersion: string;

if (bumpType === 'prerelease') {
  if (currentVersion.includes('-beta.')) {
    const [base, prerelease] = currentVersion.split('-beta.');
    const prereleaseNum = parseInt(prerelease, 10);
    newVersion = `${base}-beta.${prereleaseNum + 1}`;
  } else {
    newVersion = `${currentVersion}-beta.1`;
  }
} else {
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

console.log(`\nPackage: @tingrudeng/${packageName}`);
console.log(`Current version: ${currentVersion}`);
console.log(`New version: ${newVersion}`);
console.log(`Mode: ${isDryRun ? 'DRY-RUN (no changes will be made)' : 'PUBLISH (will update package.json and publish)'}`);

if (isDryRun) {
  console.log('\n[DRY-RUN] Would perform the following actions:');
  console.log(`  1. Update ${packageJsonPath}`);
  console.log(`     "version": "${currentVersion}" → "${newVersion}"`);
  console.log(`  2. Build the package:`);
  console.log(`     pnpm --filter @tingrudeng/${packageName} build`);
  console.log(`  3. Publish to npm:`);
  console.log(`     pnpm --filter @tingrudeng/${packageName} publish --access public --no-git-checks`);
  console.log('\nTo actually publish, add --publish flag');
  process.exit(0);
}

console.log('\nUpdating package.json...');
packageJson.version = newVersion;

try {
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  console.log(`✓ Updated ${packageJsonPath}`);
} catch (error) {
  console.error('Error: Failed to write package.json');
  console.error((error as Error).message);
  process.exit(1);
}

console.log('\nBuilding package...');
try {
  execSync(`pnpm --filter @tingrudeng/${packageName} build`, {
    stdio: 'inherit',
    cwd: workspacePath
  });
  console.log('✓ Build completed');
} catch (error) {
  console.error('Error: Build failed');
  process.exit(1);
}

console.log('\nPublishing to npm...');
try {
  execSync(`pnpm --filter @tingrudeng/${packageName} publish --access public --no-git-checks`, {
    stdio: 'inherit',
    cwd: workspacePath
  });
  console.log(`✓ Successfully published @tingrudeng/${packageName}@${newVersion}`);
} catch (error) {
  console.error('Error: Publish failed');
  console.error('Note: package.json has already been updated with the new version');
  process.exit(1);
}

console.log('\nRelease completed successfully!');
console.log(`Package: @tingrudeng/${packageName}@${newVersion}`);

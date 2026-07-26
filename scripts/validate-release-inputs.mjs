#!/usr/bin/env node

import path from "node:path";

import { RUNTIME_PACKAGES } from "./lib/runtime-package-specs.mjs";

const DIST_TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const runtimePackageNames = new Set(
  RUNTIME_PACKAGES.map((spec) => path.basename(spec.dir)),
);
const releasePackageNames = new Set([
  ...runtimePackageNames,
  "forgeflow-dispatcher",
  "worker-review-orchestrator-cli",
]);

const [packageName, distTag] = process.argv.slice(2);

if (!packageName || !distTag) {
  console.error("usage: validate-release-inputs.mjs <runtime-package> <npm-dist-tag>");
  process.exit(1);
}

if (!releasePackageNames.has(packageName)) {
  console.error(
    `unsupported release package "${packageName}"; expected one of: ${[...releasePackageNames].join(", ")}`,
  );
  process.exit(1);
}

if (!DIST_TAG_PATTERN.test(distTag)) {
  console.error(`invalid npm dist-tag "${distTag}"`);
  process.exit(1);
}

console.log(`release inputs valid: @tingrudeng/${packageName} (${distTag})`);

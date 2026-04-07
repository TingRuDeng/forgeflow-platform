#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
      continue;
    }

    parsed[key] = true;
  }
  return parsed;
}

function setGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const packageDir = typeof args["package-dir"] === "string" ? args["package-dir"] : "";
const expectedRepo = typeof args["expected-repo"] === "string" ? args["expected-repo"] : "";
const requireTrustedPublishing = args["require-trusted-publishing"] === true;

if (!packageDir) {
  console.error("Error: --package-dir is required");
  process.exit(1);
}

if (!expectedRepo) {
  console.error("Error: --expected-repo is required");
  process.exit(1);
}

const packageJsonPath = resolve(process.cwd(), packageDir, "package.json");
let packageJson;

try {
  packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
} catch (error) {
  console.error(`Error: failed to read ${packageJsonPath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const normalizedPackageDir = packageDir.replace(/\\/g, "/").replace(/^\.\//, "");
const expectedRepositoryUrl = `git+https://github.com/${expectedRepo}.git`;
const expectedHomepage = `https://github.com/${expectedRepo}/tree/main/${normalizedPackageDir}`;
const expectedBugsUrl = `https://github.com/${expectedRepo}/issues`;
const issues = [];

if (packageJson.private !== false) {
  issues.push(`package ${packageJson.name} must stay public ("private": false) for npm release`);
}

if (packageJson.repository?.type !== "git") {
  issues.push(`repository.type must be "git" for ${packageJson.name}`);
}

if (packageJson.repository?.url !== expectedRepositoryUrl) {
  issues.push(
    `repository.url mismatch for ${packageJson.name}: expected ${expectedRepositoryUrl}, got ${packageJson.repository?.url ?? "<missing>"}`,
  );
}

if (packageJson.repository?.directory !== normalizedPackageDir) {
  issues.push(
    `repository.directory mismatch for ${packageJson.name}: expected ${normalizedPackageDir}, got ${packageJson.repository?.directory ?? "<missing>"}`,
  );
}

if (packageJson.homepage !== expectedHomepage) {
  issues.push(
    `homepage mismatch for ${packageJson.name}: expected ${expectedHomepage}, got ${packageJson.homepage ?? "<missing>"}`,
  );
}

if (packageJson.bugs?.url !== expectedBugsUrl) {
  issues.push(
    `bugs.url mismatch for ${packageJson.name}: expected ${expectedBugsUrl}, got ${packageJson.bugs?.url ?? "<missing>"}`,
  );
}

const publishEnabled = process.env.NPM_TRUSTED_PUBLISHING_ENABLED === "true";
if (requireTrustedPublishing && !publishEnabled) {
  issues.push(
    `trusted publishing gate is disabled. Set repository/org variable NPM_TRUSTED_PUBLISHING_ENABLED=true only after npm package ${packageJson.name} trusts GitHub repo ${expectedRepo}.`,
  );
}

const distTag = typeof packageJson.version === "string" && packageJson.version.includes("-") ? "beta" : "latest";

setGithubOutput("package_name", packageJson.name);
setGithubOutput("package_version", packageJson.version);
setGithubOutput("dist_tag", distTag);
setGithubOutput("publish_enabled", publishEnabled ? "true" : "false");

if (issues.length > 0) {
  console.error(`Release preflight failed for ${packageJson.name} (${packageJsonPath})`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`Release preflight passed for ${packageJson.name}@${packageJson.version}`);
console.log(`- expected repo: ${expectedRepo}`);
console.log(`- publish dist-tag: ${distTag}`);
console.log(`- trusted publishing gate: ${publishEnabled ? "enabled" : "disabled"}`);

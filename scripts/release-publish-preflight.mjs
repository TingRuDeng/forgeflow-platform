#!/usr/bin/env node

import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

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
const requirePackageExists = args["require-package-exists"] === true;
const requirePublishedWorkspaceDeps = args["require-published-workspace-deps"] === true;
const requireVersionAvailable = args["require-version-available"] === true;
const expectedDistTag = typeof args["expected-dist-tag"] === "string" ? args["expected-dist-tag"] : "";
const registryUrl = typeof args["registry-url"] === "string"
  ? args["registry-url"]
  : "https://registry.npmjs.org";
const needsRegistryQuery = requirePackageExists
  || requirePublishedWorkspaceDeps
  || requireVersionAvailable;
const npmCacheDir = needsRegistryQuery
  ? mkdtempSync(resolve(tmpdir(), "forgeflow-npm-view-"))
  : "";
const npmEnv = npmCacheDir
  ? { ...process.env, NPM_CONFIG_CACHE: npmCacheDir }
  : process.env;

if (npmCacheDir) {
  process.on("exit", () => {
    rmSync(npmCacheDir, { recursive: true, force: true });
  });
}

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

function readPublishedPackageVersion(packageName) {
  return readPublishedPackageTargetVersion(packageName, "");
}

function readPublishedPackageTargetVersion(packageName, version) {
  const target = version ? `${packageName}@${version}` : packageName;
  try {
    const output = execFileSync("npm", ["view", target, "version", "--registry", registryUrl], {
      encoding: "utf8",
      env: npmEnv,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    return { status: "published", version: output.trim() };
  } catch (error) {
    const stderr = error?.stderr?.toString("utf8") ?? "";
    if (stderr.includes("E404")) {
      return { status: "missing", version: "" };
    }
    if (error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT") {
      return { status: "error", version: "", error: `${target} npm view query timed out` };
    }
    return { status: "error", version: "", error: stderr.trim() || String(error) };
  }
}

function readWorkspacePackageVersion(packageName) {
  const packageSlug = packageName.split("/").pop();
  if (!packageSlug) {
    return { status: "missing", version: "" };
  }
  try {
    const workspacePackage = JSON.parse(readFileSync(resolve(process.cwd(), "packages", packageSlug, "package.json"), "utf8"));
    if (workspacePackage.name !== packageName) {
      return { status: "missing", version: "" };
    }
    return { status: "found", version: workspacePackage.version };
  } catch {
    return { status: "missing", version: "" };
  }
}

function workspaceDependencyEntries(pkg) {
  return Object.entries({
    ...(pkg.dependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  }).filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"));
}

const publishedPackage = requirePackageExists
  ? readPublishedPackageVersion(packageJson.name)
  : { status: "not_checked", version: "" };

if (requirePackageExists && publishedPackage.status !== "published") {
  const message = publishedPackage.status === "missing"
    ? `${packageJson.name} must exist on npm before this workflow can publish. Create the package name and configure npm Trusted Publisher for repo ${expectedRepo} first.`
    : `${packageJson.name} npm package existence check failed: ${publishedPackage.error}`;
  issues.push(message);
}

const publishedTargetVersion = requireVersionAvailable
  ? readPublishedPackageTargetVersion(packageJson.name, packageJson.version)
  : { status: "not_checked", version: "" };

if (requireVersionAvailable && publishedTargetVersion.status !== "missing") {
  const message = publishedTargetVersion.status === "published"
    ? `${packageJson.name}@${packageJson.version} already exists on npm. Increment the package version before releasing.`
    : `${packageJson.name}@${packageJson.version} availability check failed: ${publishedTargetVersion.error}`;
  issues.push(message);
}

if (requirePublishedWorkspaceDeps) {
  for (const [dependencyName] of workspaceDependencyEntries(packageJson)) {
    const workspaceVersion = readWorkspacePackageVersion(dependencyName);
    if (workspaceVersion.status !== "found" || !workspaceVersion.version) {
      issues.push(`${packageJson.name} depends on ${dependencyName} via workspace:* but no matching workspace package.json was found`);
      continue;
    }
    const publishedDependency = readPublishedPackageTargetVersion(dependencyName, workspaceVersion.version);
    if (publishedDependency.status !== "published") {
      const reason = publishedDependency.status === "missing"
        ? `${dependencyName}@${workspaceVersion.version} is not published`
        : publishedDependency.error;
      issues.push(`${packageJson.name} requires published workspace dependency ${dependencyName}@${workspaceVersion.version} before publish: ${reason}`);
    }
  }
}

const distTag = typeof packageJson.version === "string" && packageJson.version.includes("-") ? "beta" : "latest";
if (expectedDistTag && expectedDistTag !== distTag) {
  issues.push(
    `dist-tag mismatch for ${packageJson.name}@${packageJson.version}: expected ${distTag}, got ${expectedDistTag}`,
  );
}

setGithubOutput("package_name", packageJson.name);
setGithubOutput("package_version", packageJson.version);
setGithubOutput("dist_tag", distTag);
setGithubOutput("publish_enabled", publishEnabled ? "true" : "false");
setGithubOutput("package_exists", publishedPackage.status === "published" ? "true" : "false");

if (issues.length > 0) {
  console.error(`Release preflight failed for ${packageJson.name} (${packageJsonPath})`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`Release preflight passed for ${packageJson.name}@${packageJson.version}`);
console.log(`- expected repo: ${expectedRepo}`);
console.log(`- registry: ${registryUrl}`);
console.log(`- publish dist-tag: ${distTag}`);
console.log(`- trusted publishing gate: ${publishEnabled ? "enabled" : "disabled"}`);
console.log(`- package exists on npm: ${publishedPackage.status === "published" ? `yes (${publishedPackage.version})` : publishedPackage.status}`);

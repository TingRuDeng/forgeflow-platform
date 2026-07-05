#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  decideRegistryAction,
  parsePositiveInteger,
  queryPackageRegistry,
  readRegistryFixture,
} from "./lib/npm-registry-status.mjs";
import { RUNTIME_PACKAGES, readJson } from "./lib/runtime-package-specs.mjs";

const PROVIDER_GROUPS = {
  codex: findProvider("forgeflow-codex-beta"),
  gemini: findProvider("forgeflow-gemini-beta"),
  trae: findProvider("forgeflow-trae-beta"),
};

const PROVIDER_PACKAGE_TO_GROUP = Object.fromEntries(
  Object.entries(PROVIDER_GROUPS).map(([groupName, spec]) => [spec.name, groupName]),
);

function findProvider(binName) {
  const spec = RUNTIME_PACKAGES.find((candidate) => candidate.bin === binName);
  if (!spec) {
    throw new Error(`unknown runtime provider bin: ${binName}`);
  }
  return spec;
}

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
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function resolveGroups(input) {
  if (!input) {
    return Object.keys(PROVIDER_GROUPS);
  }
  const groupNames = input.split(",").map((name) => name.trim()).filter(Boolean);
  for (const groupName of groupNames) {
    if (!PROVIDER_GROUPS[groupName]) {
      throw new Error(`unknown published runtime smoke group: ${groupName}`);
    }
  }
  return groupNames;
}

function normalizePackageName(input) {
  if (!input) {
    return "";
  }
  return input.startsWith("@tingrudeng/") ? input : `@tingrudeng/${input}`;
}

function resolveGroupsFromPackage(input) {
  const packageName = normalizePackageName(input);
  if (!packageName) {
    return null;
  }
  const groupName = PROVIDER_PACKAGE_TO_GROUP[packageName];
  if (!groupName) {
    return [];
  }
  return [groupName];
}

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function buildRows(rootDir, groupNames, options) {
  const rows = [];
  for (const groupName of groupNames) {
    const spec = PROVIDER_GROUPS[groupName];
    const packageJson = readJson(path.join(rootDir, spec.dir, "package.json"));
    const registry = await queryPackageRegistry({ name: spec.name, version: packageJson.version }, options);
    const action = decideRegistryAction(registry.packageStatus, registry.versionStatus);
    rows.push({ action, groupName, packageName: spec.name, spec, version: packageJson.version });
  }
  return rows;
}

function installProvider(row, installDir, options) {
  const npmEnv = { NPM_CONFIG_CACHE: path.join(installDir, ".npm-cache") };
  const packageSpec = `${row.packageName}@${row.version}`;
  run("npm", [
    "install",
    "--prefix",
    installDir,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry",
    options.registryUrl,
    packageSpec,
  ], options.rootDir, npmEnv);
}

function resolveBinPath(installDir, binName) {
  const binPath = path.join(installDir, "node_modules", ".bin", binName);
  if (fs.existsSync(binPath)) {
    return binPath;
  }
  const cmdPath = `${binPath}.cmd`;
  return fs.existsSync(cmdPath) ? cmdPath : binPath;
}

function verifyProvider(row, installDir) {
  const packageJsonPath = path.join(installDir, "node_modules", row.packageName, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`${row.packageName} was not installed from registry`);
  }
  const binPath = resolveBinPath(installDir, row.spec.bin);
  if (!fs.existsSync(binPath)) {
    throw new Error(`${row.packageName} did not install bin ${row.spec.bin}`);
  }
  const versionOutput = run(binPath, ["--version"], installDir).trim();
  if (!versionOutput.includes(row.version)) {
    throw new Error(`${row.spec.bin} --version should include ${row.version}, got ${versionOutput || "<empty>"}`);
  }
  const helpOutput = run(binPath, ["--help"], installDir);
  if (!helpOutput.includes(row.spec.bin)) {
    throw new Error(`${row.spec.bin} --help did not mention the command name`);
  }
}

function handleUnavailable(row, options, issues, warnings) {
  const message = `${row.packageName}@${row.version} registry action=${row.action}`;
  if (options.requirePublished) {
    issues.push(message);
  } else {
    warnings.push(message);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const options = {
    fixture: readRegistryFixture(typeof args["registry-fixture"] === "string" ? args["registry-fixture"] : ""),
    registryUrl: typeof args["registry-url"] === "string" ? args["registry-url"] : "https://registry.npmjs.org/",
    requirePublished: args["require-published"] === true,
    rootDir,
    timeoutMs: parsePositiveInteger(args["registry-timeout-ms"], 15000),
  };
  const packageGroups = resolveGroupsFromPackage(typeof args.package === "string" ? args.package : "");
  if (packageGroups?.length === 0) {
    console.log(`published runtime smoke skipped: package ${normalizePackageName(args.package)} is not a provider runtime`);
    return;
  }
  const groupNames = packageGroups ?? resolveGroups(typeof args.groups === "string" ? args.groups : "");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-published-runtime-smoke-"));
  const issues = [];
  const warnings = [];
  try {
    const rows = await buildRows(rootDir, groupNames, options);
    for (const row of rows) {
      if (row.action !== "up_to_date") {
        handleUnavailable(row, options, issues, warnings);
        continue;
      }
      const installDir = path.join(tempDir, row.groupName);
      fs.mkdirSync(installDir, { recursive: true });
      installProvider(row, installDir, options);
      verifyProvider(row, installDir);
      console.log(`published runtime smoke passed: ${row.groupName} ${row.packageName}@${row.version}`);
    }
  } finally {
    if (args["keep-temp"] === true) {
      console.log(`kept temp dir: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }
  if (issues.length > 0) {
    console.error("Published runtime smoke failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
  console.log("Published runtime smoke completed.");
}

main();

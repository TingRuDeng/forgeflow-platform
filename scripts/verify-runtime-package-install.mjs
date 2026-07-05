#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RUNTIME_PACKAGE_GROUPS,
  readJson,
  readWorkspaceVersions,
  rewriteWorkspaceDependencies,
} from "./lib/runtime-package-specs.mjs";

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

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function copyDir(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function resolveGroups(input) {
  if (!input) {
    return Object.keys(RUNTIME_PACKAGE_GROUPS);
  }
  const names = input.split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!RUNTIME_PACKAGE_GROUPS[name]) {
      throw new Error(`unknown runtime install smoke group: ${name}`);
    }
  }
  return names;
}

function stagePackage(rootDir, tempDir, spec, versions) {
  const sourceDir = path.join(rootDir, spec.dir);
  const stagedDir = path.join(tempDir, "stage", spec.dir);
  fs.mkdirSync(stagedDir, { recursive: true });
  for (const fileName of ["README.md", "PUBLISHING.md"]) {
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(stagedDir, fileName));
  }
  copyDir(path.join(sourceDir, "dist"), path.join(stagedDir, "dist"));
  const packageJson = rewriteWorkspaceDependencies(readJson(path.join(sourceDir, "package.json")), versions);
  delete packageJson.scripts;
  fs.writeFileSync(path.join(stagedDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  return stagedDir;
}

function buildPackages(rootDir, specs) {
  const seen = new Set();
  for (const spec of specs) {
    if (seen.has(spec.name)) {
      continue;
    }
    seen.add(spec.name);
    run("pnpm", ["--filter", spec.name, "build"], rootDir);
  }
}

function packPackage(stagedDir, packDir, rootDir, npmEnv) {
  const output = run("npm", ["pack", stagedDir, "--json", "--pack-destination", packDir], rootDir, npmEnv);
  const [packed] = JSON.parse(output);
  if (!packed?.filename) {
    throw new Error(`npm pack did not return a tarball for ${stagedDir}`);
  }
  return path.join(packDir, packed.filename);
}

function assertInstalledPackage(installDir, spec) {
  const packageJsonPath = path.join(installDir, "node_modules", spec.name, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`${spec.name} was not installed`);
  }
  const packageJson = readJson(packageJsonPath);
  for (const version of Object.values(packageJson.dependencies || {})) {
    if (version === "workspace:*") {
      throw new Error(`${spec.name} leaked workspace:* dependency into installed package`);
    }
  }
  if (spec.bin && !fs.existsSync(path.join(installDir, "node_modules", ".bin", spec.bin))) {
    throw new Error(`${spec.name} did not install bin ${spec.bin}`);
  }
}

function verifyGroup(rootDir, tempDir, groupName, options) {
  const specs = RUNTIME_PACKAGE_GROUPS[groupName];
  if (!options.skipBuild) {
    buildPackages(rootDir, specs);
  }
  const versions = readWorkspaceVersions(rootDir);
  const packDir = path.join(tempDir, "packs", groupName);
  const installDir = path.join(tempDir, "install", groupName);
  const npmEnv = { NPM_CONFIG_CACHE: path.join(tempDir, "npm-cache", groupName) };
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  const tarballs = specs.map((spec) => packPackage(stagePackage(rootDir, tempDir, spec, versions), packDir, rootDir, npmEnv));
  run("npm", ["install", "--prefix", installDir, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], rootDir, npmEnv);
  for (const spec of specs) {
    assertInstalledPackage(installDir, spec);
  }
  console.log(`runtime package install smoke passed: ${groupName}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const groupNames = resolveGroups(typeof args.groups === "string" ? args.groups : "");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-runtime-install-"));
  const options = { skipBuild: args["skip-build"] === true };
  try {
    for (const groupName of groupNames) {
      verifyGroup(rootDir, tempDir, groupName, options);
    }
    console.log("Runtime package install smoke passed.");
  } finally {
    if (args["keep-temp"] === true) {
      console.log(`kept temp dir: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main();

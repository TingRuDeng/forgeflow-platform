#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { assertSafeReleaseFilePath } from "./lib/release-tarball-policy.mjs";
import { readJson, readWorkspaceVersions } from "./lib/runtime-package-specs.mjs";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

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

function requireStringArg(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function rewriteWorkspaceProtocols(packageJson, workspaceVersions) {
  const next = structuredClone(packageJson);
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = next[field];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) {
        continue;
      }
      const version = workspaceVersions[name];
      if (!version) {
        throw new Error(`${packageJson.name} cannot resolve workspace dependency ${name}`);
      }
      if (range === "workspace:*") {
        dependencies[name] = version;
        continue;
      }
      if (range === "workspace:^") {
        dependencies[name] = `^${version}`;
        continue;
      }
      if (range === "workspace:~") {
        dependencies[name] = `~${version}`;
        continue;
      }
      throw new Error(`${packageJson.name} has unsupported workspace range ${name}=${range}`);
    }
  }
  return next;
}

function assertNoWorkspaceProtocols(packageJson) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(packageJson[field] || {})) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        throw new Error(`${packageJson.name} tarball leaked ${field}.${name}=${range}`);
      }
    }
  }
}

function assertDeclaredFiles(packageJson, fileNames) {
  for (const declared of packageJson.files || []) {
    const normalized = declared.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!fileNames.some((fileName) => fileName === normalized || fileName.startsWith(`${normalized}/`))) {
      throw new Error(`${packageJson.name} tarball is missing declared files entry ${declared}`);
    }
  }
}

function normalizeBin(bin) {
  if (typeof bin === "string") {
    return { bin: bin };
  }
  return bin && typeof bin === "object" ? bin : {};
}

function assertBinTargets(packageJson, fileNames) {
  for (const [name, target] of Object.entries(normalizeBin(packageJson.bin))) {
    if (typeof target !== "string" || !fileNames.includes(target.replace(/\\/g, "/").replace(/^\.\//, ""))) {
      throw new Error(`${packageJson.name} tarball is missing bin ${name} target ${target}`);
    }
  }
}

function readPackedPackageJson(tarball, cwd) {
  const output = run("tar", ["-xOf", tarball, "package/package.json"], cwd);
  return JSON.parse(output);
}

function parsePackRows(output) {
  const end = output.lastIndexOf("]");
  if (end < 0) {
    throw new Error("npm pack did not emit a JSON array");
  }
  for (let start = output.lastIndexOf("[", end); start >= 0; start = output.lastIndexOf("[", start - 1)) {
    try {
      const parsed = JSON.parse(output.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Lifecycle scripts may write arbitrary logs before npm's final JSON array.
    }
  }
  throw new Error("npm pack JSON result could not be parsed");
}

function prepareTarball(rootDir, packageDir, outputDir, manifestPath) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const originalPackageJsonText = fs.readFileSync(packageJsonPath, "utf8");
  const originalPackageJson = JSON.parse(originalPackageJsonText);
  if (typeof originalPackageJson.name !== "string" || typeof originalPackageJson.version !== "string") {
    throw new Error(`${packageJsonPath} must declare name and version`);
  }

  const publishPackageJson = rewriteWorkspaceProtocols(originalPackageJson, readWorkspaceVersions(rootDir));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const npmEnv = { NPM_CONFIG_CACHE: path.join(outputDir, ".npm-cache") };
  let packOutput;
  try {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(publishPackageJson, null, 2)}\n`);
    packOutput = run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", outputDir],
      packageDir,
      npmEnv,
    );
  } finally {
    fs.writeFileSync(packageJsonPath, originalPackageJsonText);
  }

  const packRows = parsePackRows(packOutput);
  if (!Array.isArray(packRows) || packRows.length !== 1 || !packRows[0]?.filename) {
    throw new Error(`npm pack did not return exactly one tarball for ${originalPackageJson.name}`);
  }
  const packed = packRows[0];
  const tarball = path.resolve(outputDir, packed.filename);
  if (!fs.existsSync(tarball)) {
    throw new Error(`npm pack reported missing tarball ${tarball}`);
  }
  if (!packed.integrity || !packed.shasum) {
    throw new Error(`npm pack did not report integrity and shasum for ${originalPackageJson.name}`);
  }

  const files = (packed.files || []).map((entry) =>
    assertSafeReleaseFilePath(entry.path, "release tarball")
  );
  const packedPackageJson = readPackedPackageJson(tarball, rootDir);
  if (packedPackageJson.name !== originalPackageJson.name || packedPackageJson.version !== originalPackageJson.version) {
    throw new Error(
      `packed manifest mismatch: expected ${originalPackageJson.name}@${originalPackageJson.version}, `
      + `got ${packedPackageJson.name}@${packedPackageJson.version}`,
    );
  }
  assertNoWorkspaceProtocols(packedPackageJson);
  assertDeclaredFiles(packedPackageJson, files);
  assertBinTargets(packedPackageJson, files);

  const manifest = {
    packageName: packedPackageJson.name,
    version: packedPackageJson.version,
    tarball,
    filename: path.basename(tarball),
    integrity: packed.integrity,
    shasum: packed.shasum,
    files: files.sort(),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`release tarball prepared: ${manifest.packageName}@${manifest.version}`);
  console.log(`- tarball: ${manifest.tarball}`);
  console.log(`- integrity: ${manifest.integrity}`);
  console.log(`- files: ${manifest.files.length}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const packageDir = path.resolve(rootDir, requireStringArg(args, "package-dir"));
  const outputDir = path.resolve(requireStringArg(args, "output-dir"));
  const manifestPath = path.resolve(requireStringArg(args, "manifest"));
  prepareTarball(rootDir, packageDir, outputDir, manifestPath);
}

try {
  main();
} catch (error) {
  console.error(`Release tarball preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

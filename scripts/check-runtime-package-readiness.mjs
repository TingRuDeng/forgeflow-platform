#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { RUNTIME_PACKAGES, readWorkspaceVersions } from "./lib/runtime-package-specs.mjs";

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

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readPackageJson(rootDir, packageDir, issues) {
  const packageJsonPath = path.join(rootDir, packageDir, "package.json");
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    issues.push(`${packageJsonPath} 读取失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expectArrayIncludes(arrayValue, value, label, issues) {
  if (!Array.isArray(arrayValue) || !arrayValue.includes(value)) {
    issues.push(`${label} 必须包含 ${value}`);
  }
}

function validatePackageMetadata(rootDir, spec, packageJson, issues) {
  if (packageJson.name !== spec.name) {
    issues.push(`${spec.dir}/package.json name 应为 ${spec.name}`);
  }
  if (packageJson.private !== false) {
    issues.push(`${spec.name} 必须保持 "private": false`);
  }
  if (packageJson.publishConfig?.access !== "public") {
    issues.push(`${spec.name} 必须配置 publishConfig.access=public`);
  }
  for (const fileName of ["README.md", "PUBLISHING.md"]) {
    if (!fs.existsSync(path.join(rootDir, spec.dir, fileName))) {
      issues.push(`${spec.name} 缺少 ${fileName}`);
    }
    expectArrayIncludes(packageJson.files, fileName, `${spec.name} files`, issues);
  }
  expectArrayIncludes(packageJson.files, "dist", `${spec.name} files`, issues);
}

function validatePackageScripts(spec, packageJson, issues) {
  for (const scriptName of ["build", "typecheck", "test"]) {
    if (typeof packageJson.scripts?.[scriptName] !== "string") {
      issues.push(`${spec.name} 缺少 scripts.${scriptName}`);
    }
  }
  if (spec.rewriteScript && packageJson.scripts?.prepublishOnly !== spec.rewriteScript) {
    issues.push(`${spec.name} 必须在 prepublishOnly 中重写 workspace:* 依赖`);
  }
}

function validatePackageDependencies(spec, packageJson, issues) {
  for (const dependencyName of spec.dependencies) {
    if (packageJson.dependencies?.[dependencyName] !== "workspace:*") {
      issues.push(`${spec.name} 必须以 workspace:* 依赖源码内 ${dependencyName}`);
    }
  }
  if (spec.bin && !packageJson.bin?.[spec.bin]?.startsWith("dist/")) {
    issues.push(`${spec.name} 必须暴露 dist 下的 ${spec.bin} CLI`);
  }
}

function queryNpmView(packageName, field, timeoutMs) {
  try {
    const args = ["view", packageName, field];
    if (field !== "version") {
      args.push("--json");
    }
    const output = execFileSync("npm", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return { status: "published", value: output.trim() };
  } catch (error) {
    const stderr = error?.stderr?.toString("utf8") ?? "";
    if (stderr.includes("E404")) {
      return { status: "missing", value: "" };
    }
    if (error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT") {
      return { status: "error", value: "", error: `${packageName} npm view 查询超时` };
    }
    return { status: "error", value: "", error: stderr.trim() || String(error) };
  }
}

function queryNpmVersion(packageName, timeoutMs) {
  const result = queryNpmView(packageName, "version", timeoutMs);
  return { ...result, version: result.value };
}

function queryNpmDependencies(packageName, timeoutMs) {
  const result = queryNpmView(packageName, "dependencies", timeoutMs);
  if (result.status !== "published") {
    return { ...result, dependencies: {} };
  }
  if (!result.value) {
    return { ...result, dependencies: {} };
  }
  try {
    return { ...result, dependencies: JSON.parse(result.value) };
  } catch (error) {
    return { status: "error", value: result.value, dependencies: {}, error: `dependencies JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

function buildExpectedPublishedDependencies(packageJson, workspaceVersions) {
  const expected = {};
  for (const [name, version] of Object.entries(packageJson.dependencies || {})) {
    expected[name] = version === "workspace:*" ? workspaceVersions[name] : version;
  }
  return expected;
}

function validatePublishedDependencies(spec, packageJson, workspaceVersions, options, issues) {
  if (!options.checkPublishedMetadata) {
    return;
  }
  const packageName = `${spec.name}@${packageJson.version}`;
  const result = queryNpmDependencies(packageName, options.registryTimeoutMs);
  if (result.status !== "published") {
    issues.push(`${packageName} published dependencies 查询失败：${result.error || result.status}`);
    return;
  }
  const expected = buildExpectedPublishedDependencies(packageJson, workspaceVersions);
  for (const [name, version] of Object.entries(expected)) {
    if (result.dependencies?.[name] !== version) {
      issues.push(`${packageName} published dependency ${name} 应为 ${version}，实际为 ${result.dependencies?.[name] ?? "<missing>"}`);
    }
  }
}

function validateRegistry(spec, packageJson, options, issues, warnings) {
  if (!options.checkRegistry) {
    return { status: "not_checked", version: "", versionStatus: "not_checked" };
  }
  const packageStatus = queryNpmVersion(spec.name, options.registryTimeoutMs);
  if (packageStatus.status !== "published") {
    const message = packageStatus.status === "missing"
      ? `${spec.name} 尚未在 npm registry 创建`
      : `${spec.name} npm registry 查询失败：${packageStatus.error}`;
    if (options.requirePublished) {
      issues.push(message);
    } else {
      warnings.push(message);
    }
    return { ...packageStatus, versionStatus: packageStatus.status };
  }
  const versionStatus = queryNpmVersion(`${spec.name}@${packageJson.version}`, options.registryTimeoutMs);
  if (versionStatus.status !== "published") {
    const message = versionStatus.status === "missing"
      ? `${spec.name}@${packageJson.version} 尚未发布`
      : `${spec.name}@${packageJson.version} npm registry 查询失败：${versionStatus.error}`;
    if (options.requirePublished) {
      issues.push(message);
    } else {
      warnings.push(message);
    }
  }
  return { ...packageStatus, versionStatus: versionStatus.status };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const options = {
    checkRegistry: args["check-registry"] === true,
    checkPublishedMetadata: args["check-published-metadata"] === true,
    requirePublished: args["require-published"] === true,
    registryTimeoutMs: parsePositiveInteger(args["registry-timeout-ms"], 15000),
  };
  const issues = [];
  const warnings = [];
  const rows = [];
  const workspaceVersions = readWorkspaceVersions(rootDir);

  for (const spec of RUNTIME_PACKAGES) {
    const packageJson = readPackageJson(rootDir, spec.dir, issues);
    if (!packageJson) {
      continue;
    }
    validatePackageMetadata(rootDir, spec, packageJson, issues);
    validatePackageScripts(spec, packageJson, issues);
    validatePackageDependencies(spec, packageJson, issues);
    const registry = validateRegistry(spec, packageJson, options, issues, warnings);
    if (registry.versionStatus === "published") {
      validatePublishedDependencies(spec, packageJson, workspaceVersions, options, issues);
    }
    rows.push({ name: spec.name, role: spec.role, version: packageJson.version, registry });
  }

  console.log("Runtime package readiness:");
  for (const row of rows) {
    const registryText = row.registry.version
      ? `${row.registry.status}:${row.registry.version}`
      : row.registry.status;
    console.log(`- ${row.name}@${row.version} role=${row.role} registry=${registryText}`);
  }

  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }
  if (issues.length > 0) {
    console.error("Runtime package readiness failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
  console.log("Runtime package readiness passed.");
}

main();

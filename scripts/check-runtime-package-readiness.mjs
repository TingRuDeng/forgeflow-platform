#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RUNTIME_PACKAGES = [
  {
    dir: "packages/automation-gateway-core",
    name: "@tingrudeng/automation-gateway-core",
    role: "trae-support-core",
    dependencies: [],
  },
  {
    dir: "packages/beta-runtime-core",
    name: "@tingrudeng/beta-runtime-core",
    role: "codex-gemini-support-core",
    dependencies: [],
  },
  {
    bin: "forgeflow-codex-beta",
    dir: "packages/codex-beta-runtime",
    name: "@tingrudeng/codex-beta-runtime",
    role: "codex-remote-runtime",
    dependencies: ["@tingrudeng/beta-runtime-core"],
    rewriteScript: "node ../../scripts/rewrite-workspace-deps.mjs package.json",
  },
  {
    bin: "forgeflow-gemini-beta",
    dir: "packages/gemini-beta-runtime",
    name: "@tingrudeng/gemini-beta-runtime",
    role: "gemini-remote-runtime",
    dependencies: ["@tingrudeng/beta-runtime-core"],
    rewriteScript: "node ../../scripts/rewrite-workspace-deps.mjs package.json",
  },
  {
    bin: "forgeflow-trae-beta",
    dir: "packages/trae-beta-runtime",
    name: "@tingrudeng/trae-beta-runtime",
    role: "trae-remote-runtime",
    dependencies: ["@tingrudeng/automation-gateway-core"],
  },
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

function queryNpmVersion(packageName, timeoutMs) {
  try {
    const output = execFileSync("npm", ["view", packageName, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return { status: "published", version: output.trim() };
  } catch (error) {
    const stderr = error?.stderr?.toString("utf8") ?? "";
    if (stderr.includes("E404")) {
      return { status: "missing", version: "" };
    }
    if (error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT") {
      return { status: "error", version: "", error: `${packageName} npm view 查询超时` };
    }
    return { status: "error", version: "", error: stderr.trim() || String(error) };
  }
}

function validateRegistry(spec, packageJson, options, issues, warnings) {
  if (!options.checkRegistry) {
    return { status: "not_checked", version: "" };
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
    return packageStatus;
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
  return packageStatus;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const options = {
    checkRegistry: args["check-registry"] === true,
    requirePublished: args["require-published"] === true,
    registryTimeoutMs: parsePositiveInteger(args["registry-timeout-ms"], 15000),
  };
  const issues = [];
  const warnings = [];
  const rows = [];

  for (const spec of RUNTIME_PACKAGES) {
    const packageJson = readPackageJson(rootDir, spec.dir, issues);
    if (!packageJson) {
      continue;
    }
    validatePackageMetadata(rootDir, spec, packageJson, issues);
    validatePackageScripts(spec, packageJson, issues);
    validatePackageDependencies(spec, packageJson, issues);
    const registry = validateRegistry(spec, packageJson, options, issues, warnings);
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

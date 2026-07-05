#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  decideRegistryAction,
  parsePositiveInteger,
  queryPackageRegistry,
  readRegistryFixture,
} from "./lib/npm-registry-status.mjs";
import { readJson } from "./lib/runtime-package-specs.mjs";

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

function readWorkspacePackages(rootDir) {
  const packagesDir = path.join(rootDir, "packages");
  const specs = [];
  for (const entry of fs.readdirSync(packagesDir)) {
    const packageJsonPath = path.join(packagesDir, entry, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = readJson(packageJsonPath);
    if (typeof packageJson.name === "string" && packageJson.name.startsWith("@tingrudeng/")) {
      specs.push({ name: packageJson.name, shortName: packageJson.name.replace("@tingrudeng/", ""), version: packageJson.version });
    }
  }
  return specs.sort((left, right) => left.name.localeCompare(right.name));
}

async function buildDetection(rootDir, options) {
  const rows = [];
  for (const spec of readWorkspacePackages(rootDir)) {
    const registry = await queryPackageRegistry({ name: spec.name, version: spec.version }, options);
    const action = decideRegistryAction(registry.packageStatus, registry.versionStatus);
    rows.push({ ...spec, ...sanitizeRegistry(registry), action });
  }
  return {
    packages: rows.filter((row) => row.action === "publish_version").map(toReleasePackage),
    newPackages: rows.filter((row) => row.action === "setup_required").map(toReleasePackage),
    unknownPackages: rows.filter((row) => row.action === "registry_unknown").map(toUnknownPackage),
    rows,
  };
}

function sanitizeRegistry(registry) {
  return {
    packageStatus: sanitizeStatus(registry.packageStatus),
    versionStatus: sanitizeStatus(registry.versionStatus),
  };
}

function sanitizeStatus(status) {
  const { versions, ...rest } = status;
  return rest;
}

function toReleasePackage(row) {
  return { name: row.shortName, version: row.version };
}

function toUnknownPackage(row) {
  return {
    name: row.shortName,
    error: row.packageStatus.error || row.versionStatus.error || "registry 状态未知",
  };
}

function printTextReport(report) {
  console.log("Release package detection:");
  console.log(`- packages=${JSON.stringify(report.packages)}`);
  console.log(`- newPackages=${JSON.stringify(report.newPackages)}`);
  console.log(`- unknownPackages=${JSON.stringify(report.unknownPackages)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const options = {
    fixture: readRegistryFixture(typeof args["registry-fixture"] === "string" ? args["registry-fixture"] : ""),
    registryUrl: typeof args["registry-url"] === "string" ? args["registry-url"] : "https://registry.npmjs.org/",
    timeoutMs: parsePositiveInteger(args["registry-timeout-ms"], 15000),
  };
  const report = await buildDetection(rootDir, options);
  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
  if (args["require-known"] === true && report.unknownPackages.length > 0) {
    console.error("Release package registry status is unknown:");
    for (const issue of report.unknownPackages) {
      console.error(`- @tingrudeng/${issue.name}: ${issue.error}`);
    }
    process.exit(1);
  }
}

main();

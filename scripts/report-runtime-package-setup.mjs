#!/usr/bin/env node

import http from "node:http";
import https from "node:https";
import path from "node:path";

import { RUNTIME_PACKAGES, readJson } from "./lib/runtime-package-specs.mjs";

const TRUSTED_PUBLISHER = {
  repository: "TingRuDeng/forgeflow-platform",
  workflow: ".github/workflows/release.yml",
  environment: "npm",
  variable: "NPM_TRUSTED_PUBLISHING_ENABLED=true",
};

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

function readFixture(filePath) {
  if (!filePath) {
    return null;
  }
  return readJson(path.resolve(filePath));
}

function requestRegistryDocument(packageName, options) {
  const url = new URL(encodeURIComponent(packageName), options.registryUrl);
  const client = url.protocol === "http:" ? http : https;
  return new Promise((resolve) => {
    const request = client.get(url, { headers: { Accept: "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(parseRegistryResponse(packageName, response.statusCode, body));
      });
    });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`${packageName} registry 查询超时`));
    });
    request.on("error", (error) => {
      resolve({ status: "unknown", error: error.message });
    });
  });
}

function parseRegistryResponse(packageName, statusCode, body) {
  if (statusCode === 404) {
    return { status: "missing", version: "", versions: {} };
  }
  if (!statusCode || statusCode < 200 || statusCode >= 300) {
    return { status: "unknown", version: "", error: `${packageName} registry HTTP ${statusCode}` };
  }
  try {
    const parsed = JSON.parse(body);
    return {
      status: "published",
      version: parsed["dist-tags"]?.latest ?? "",
      versions: parsed.versions ?? {},
    };
  } catch (error) {
    return { status: "unknown", version: "", error: `registry JSON 解析失败：${error.message}` };
  }
}

async function queryPackage(spec, wantedVersion, options) {
  const fixturePackage = options.fixture?.packages?.[spec.name];
  const packageStatus = fixturePackage
    ? readFixturePackage(fixturePackage)
    : await requestRegistryDocument(spec.name, options);
  const versionStatus = decideVersionStatus(packageStatus, wantedVersion);
  return { packageStatus, versionStatus };
}

function readFixturePackage(fixturePackage) {
  if (fixturePackage.status === "missing") {
    return { status: "missing", version: "", versions: {} };
  }
  if (fixturePackage.status === "unknown") {
    return { status: "unknown", version: "", error: fixturePackage.error || "fixture unknown" };
  }
  const versions = Object.fromEntries((fixturePackage.versions || []).map((version) => [version, {}]));
  return { status: "published", version: fixturePackage.latest || fixturePackage.versions?.[0] || "", versions };
}

function decideVersionStatus(packageStatus, wantedVersion) {
  if (packageStatus.status !== "published") {
    return { status: "not_checked", version: "" };
  }
  if (packageStatus.versions?.[wantedVersion]) {
    return { status: "published", version: wantedVersion };
  }
  return { status: "missing", version: "" };
}

async function readRuntimeRows(rootDir, options) {
  const rows = [];
  for (const spec of RUNTIME_PACKAGES) {
    const packageJson = readJson(path.join(rootDir, spec.dir, "package.json"));
    const registry = await queryPackage(spec, packageJson.version, options);
    rows.push({ spec, version: packageJson.version, ...registry });
  }
  return rows;
}

function decideAction(row) {
  if (row.packageStatus.status === "missing") {
    return "setup_required";
  }
  if (row.packageStatus.status === "unknown") {
    return "registry_unknown";
  }
  if (row.versionStatus.status === "missing") {
    return "publish_version";
  }
  if (row.versionStatus.status === "unknown") {
    return "registry_unknown";
  }
  if (row.versionStatus.status === "published") {
    return "up_to_date";
  }
  return "not_checked";
}

async function buildReport(rootDir, options) {
  const rows = (await readRuntimeRows(rootDir, options)).map((row) => ({
    ...row,
    action: decideAction(row),
  }));
  return { trustedPublisher: TRUSTED_PUBLISHER, releaseOrder: RUNTIME_PACKAGES.map((spec) => spec.name), rows };
}

function printTextReport(report) {
  console.log("Runtime package setup report:");
  console.log(`- trustedPublisher.repository=${report.trustedPublisher.repository}`);
  console.log(`- trustedPublisher.workflow=${report.trustedPublisher.workflow}`);
  console.log(`- trustedPublisher.environment=${report.trustedPublisher.environment}`);
  console.log(`- trustedPublisher.variable=${report.trustedPublisher.variable}`);
  console.log("- releaseOrder:");
  report.releaseOrder.forEach((packageName, index) => {
    console.log(`  ${index + 1}. ${packageName}`);
  });
  console.log("- packages:");
  for (const row of report.rows) {
    const packageText = formatStatus(row.packageStatus);
    const versionText = formatStatus(row.versionStatus);
    console.log(`  - ${row.spec.name}@${row.version} role=${row.spec.role} package=${packageText} version=${versionText} action=${row.action}`);
  }
  printActions(report.rows);
}

function formatStatus(status) {
  const base = status.version ? `${status.status}:${status.version}` : status.status;
  return status.error ? `${base}(${status.error})` : base;
}

function printActions(rows) {
  const setupRows = rows.filter((row) => row.action === "setup_required");
  const publishRows = rows.filter((row) => row.action === "publish_version");
  if (setupRows.length > 0) {
    console.log("- setupRequired:");
    for (const row of setupRows) {
      console.log(`  - ${row.spec.name}: 先在 npm 创建包名，并绑定 Trusted Publisher。`);
    }
  }
  if (publishRows.length > 0) {
    console.log("- publishRequired:");
    for (const row of publishRows) {
      const shortName = row.spec.name.replace("@tingrudeng/", "");
      console.log(`  - ${row.spec.name}@${row.version}: 运行 Release workflow package=${shortName}`);
    }
  }
}

function assertReady(report) {
  const issues = [];
  for (const row of report.rows) {
    if (row.action === "setup_required") {
      issues.push(`${row.spec.name} 需要先创建 npm 包名并绑定 Trusted Publisher`);
    }
    if (row.action === "publish_version") {
      issues.push(`${row.spec.name}@${row.version} 尚未发布`);
    }
    if (row.action === "registry_unknown") {
      issues.push(`${row.spec.name} registry 状态未知：${row.packageStatus.error || row.versionStatus.error}`);
    }
  }
  return issues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const options = {
    fixture: readFixture(typeof args["registry-fixture"] === "string" ? args["registry-fixture"] : ""),
    registryUrl: typeof args["registry-url"] === "string" ? args["registry-url"] : "https://registry.npmjs.org/",
    timeoutMs: parsePositiveInteger(args["registry-timeout-ms"], 15000),
  };
  const report = await buildReport(rootDir, options);
  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
  const issues = args["require-ready"] === true ? assertReady(report) : [];
  if (issues.length > 0) {
    console.error("Runtime package setup is not ready:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
}

main();

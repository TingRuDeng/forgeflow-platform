#!/usr/bin/env node

import path from "node:path";

import {
  RUNTIME_PACKAGES,
  readJson,
  releaseDistTagForVersion,
} from "./lib/runtime-package-specs.mjs";
import {
  decideRegistryAction,
  parsePositiveInteger,
  queryPackageRegistry,
  readRegistryFixture,
} from "./lib/npm-registry-status.mjs";

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

async function readRuntimeRows(rootDir, options) {
  const rows = [];
  for (const spec of RUNTIME_PACKAGES) {
    const packageJson = readJson(path.join(rootDir, spec.dir, "package.json"));
    const registry = await queryPackageRegistry({ name: spec.name, version: packageJson.version }, options);
    const releaseDistTag = releaseDistTagForVersion(packageJson.version);
    const releaseDistTagVersion = registry.packageStatus.distTags?.[releaseDistTag] ?? "";
    const releaseDistTagStatus = registry.packageStatus.status !== "published"
      ? "not_checked"
      : releaseDistTagVersion === packageJson.version
        ? "current"
        : releaseDistTagVersion
          ? "stale"
          : "missing";
    rows.push({
      spec,
      version: packageJson.version,
      releaseDistTag,
      releaseDistTagVersion,
      releaseDistTagStatus,
      ...registry,
    });
  }
  return rows;
}

function decideAction(row) {
  const registryAction = decideRegistryAction(row.packageStatus, row.versionStatus);
  if (registryAction === "up_to_date" && row.releaseDistTagStatus !== "current") {
    return "dist_tag_mismatch";
  }
  return registryAction;
}

async function buildReport(rootDir, options) {
  const rows = (await readRuntimeRows(rootDir, options)).map((row) => ({
    ...row,
    action: decideAction(row),
  })).map(sanitizeRow);
  return { trustedPublisher: TRUSTED_PUBLISHER, releaseOrder: RUNTIME_PACKAGES.map((spec) => spec.name), rows };
}

function sanitizeRow(row) {
  return {
    ...row,
    packageStatus: sanitizeStatus(row.packageStatus),
    versionStatus: sanitizeStatus(row.versionStatus),
  };
}

function sanitizeStatus(status) {
  const { versions, ...rest } = status;
  return rest;
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
    const releaseTagText = row.releaseDistTagVersion
      ? `${row.releaseDistTag}:${row.releaseDistTagStatus}:${row.releaseDistTagVersion}`
      : `${row.releaseDistTag}:${row.releaseDistTagStatus}`;
    console.log(`  - ${row.spec.name}@${row.version} role=${row.spec.role} packageDefault=${packageText} version=${versionText} releaseTag=${releaseTagText} action=${row.action}`);
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
      console.log(
        `  - ${row.spec.name}@${row.version}: 运行 release-package --package ${shortName} --prepare，合并版本 PR 后由 Release workflow 自动发布`,
      );
    }
  }
  const distTagRows = rows.filter((row) => row.action === "dist_tag_mismatch");
  if (distTagRows.length > 0) {
    console.log("- distTagMismatch:");
    for (const row of distTagRows) {
      console.log(
        `  - ${row.spec.name}: ${row.releaseDistTag} 应指向 ${row.version}，实际为 ${row.releaseDistTagVersion || "<missing>"}；通过新的版本 PR 重新发布，不要把 latest 人工镜像到 prerelease`,
      );
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
    if (row.action === "dist_tag_mismatch") {
      issues.push(
        `${row.spec.name} 的 ${row.releaseDistTag} dist-tag 应指向 ${row.version}，实际为 ${row.releaseDistTagVersion || "<missing>"}`,
      );
    }
  }
  return issues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const options = {
    fixture: readRegistryFixture(typeof args["registry-fixture"] === "string" ? args["registry-fixture"] : ""),
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

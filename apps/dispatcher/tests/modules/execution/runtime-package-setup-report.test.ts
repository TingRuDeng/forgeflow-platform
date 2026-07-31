import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const reportScriptPath = path.join(repoRoot, "scripts/report-runtime-package-setup.mjs");
const tempRoots: string[] = [];

function readWorkspacePackageVersion(packageDir: string): string {
  const packageJsonPath = path.join(repoRoot, "packages", packageDir, "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;
}

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-runtime-setup-report-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writeRegistryFixture(rootDir: string, packages: Record<string, Record<string, unknown>>) {
  const fixturePath = path.join(rootDir, "registry-fixture.json");
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify({ packages }, null, 2)}\n`,
  );
  return fixturePath;
}

function runReport(args: string[]) {
  return spawnSync("node", [reportScriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("runtime package setup report", () => {
  it("reports missing npm package setup without failing by default", () => {
    const tempDir = makeTempDir();
    const fixturePath = writeRegistryFixture(tempDir, {
      "@tingrudeng/automation-gateway-core": { status: "published", versions: ["0.1.0-beta.3"] },
      "@tingrudeng/beta-runtime-core": { status: "missing" },
      "@tingrudeng/codex-beta-runtime": { status: "published", versions: ["0.1.0-beta.1"] },
      "@tingrudeng/gemini-beta-runtime": { status: "missing" },
      "@tingrudeng/trae-beta-runtime": { status: "published", versions: ["0.1.0-beta.62"] },
    });

    const result = runReport(["--registry-fixture", fixturePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("trustedPublisher.repository=TingRuDeng/forgeflow-platform");
    expect(result.stdout).toContain("trustedPublisher.workflow=.github/workflows/release.yml");
    expect(result.stdout).toContain("@tingrudeng/beta-runtime-core");
    expect(result.stdout).toContain("@tingrudeng/gemini-beta-runtime");
    expect(result.stdout).toContain("action=setup_required");
    expect(result.stdout).toContain("release-package --package codex-beta-runtime --prepare");
    expect(result.stdout).toContain("合并版本 PR 后由 Release workflow 自动发布");
  });

  it("fails with require-ready when setup or current version publish is incomplete", () => {
    const tempDir = makeTempDir();
    const fixturePath = writeRegistryFixture(tempDir, {
      "@tingrudeng/automation-gateway-core": { status: "published", versions: ["0.1.0-beta.3"] },
      "@tingrudeng/beta-runtime-core": { status: "missing" },
      "@tingrudeng/codex-beta-runtime": { status: "published", versions: ["0.1.0-beta.1"] },
      "@tingrudeng/gemini-beta-runtime": { status: "published", versions: ["0.1.0-beta.2"] },
      "@tingrudeng/trae-beta-runtime": { status: "published", versions: ["0.1.0-beta.62"] },
    });

    const result = runReport(["--registry-fixture", fixturePath, "--require-ready"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("@tingrudeng/beta-runtime-core 需要先创建 npm 包名");
    expect(result.stderr).toContain(
      `@tingrudeng/codex-beta-runtime@${readWorkspacePackageVersion("codex-beta-runtime")} 尚未发布`,
    );
  });

  it("can emit structured json for automation", () => {
    const tempDir = makeTempDir();
    const fixturePath = writeRegistryFixture(tempDir, {
      "@tingrudeng/automation-gateway-core": { status: "published", versions: ["0.1.0-beta.3"] },
      "@tingrudeng/beta-runtime-core": { status: "published", versions: ["0.1.0-beta.1"] },
      "@tingrudeng/codex-beta-runtime": { status: "published", versions: ["0.1.0-beta.2"] },
      "@tingrudeng/gemini-beta-runtime": { status: "published", versions: ["0.1.0-beta.2"] },
      "@tingrudeng/trae-beta-runtime": { status: "published", versions: ["0.1.0-beta.62"] },
    });

    const result = runReport(["--registry-fixture", fixturePath, "--json"]);
    const report = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(report.trustedPublisher.environment).toBe("npm");
    expect(report.releaseOrder).toContain("@tingrudeng/beta-runtime-core");
    expect(report.rows.some((row: { action: string }) => row.action === "up_to_date")).toBe(true);
  });
});

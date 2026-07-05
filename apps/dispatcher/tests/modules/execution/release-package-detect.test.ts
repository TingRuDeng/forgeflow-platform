import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const detectScriptPath = path.join(repoRoot, "scripts/detect-release-packages.mjs");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-release-detect-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writePackage(rootDir: string, shortName: string, version: string) {
  const packageDir = path.join(rootDir, "packages", shortName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({ name: `@tingrudeng/${shortName}`, version }, null, 2)}\n`,
  );
}

function writeFixture(rootDir: string, packages: Record<string, Record<string, unknown>>) {
  const fixturePath = path.join(rootDir, "registry-fixture.json");
  fs.writeFileSync(fixturePath, `${JSON.stringify({ packages }, null, 2)}\n`);
  return fixturePath;
}

function runDetect(rootDir: string, fixturePath: string, args: string[] = []) {
  return spawnSync("node", [detectScriptPath, "--root", rootDir, "--registry-fixture", fixturePath, ...args], {
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

describe("release package detection", () => {
  it("classifies publishable versions and brand-new package setup gaps", () => {
    const tempDir = makeTempDir();
    writePackage(tempDir, "published-runtime", "0.1.0");
    writePackage(tempDir, "new-runtime", "0.1.0");
    writePackage(tempDir, "pending-runtime", "0.2.0");
    const fixturePath = writeFixture(tempDir, {
      "@tingrudeng/published-runtime": { status: "published", versions: ["0.1.0"] },
      "@tingrudeng/new-runtime": { status: "missing" },
      "@tingrudeng/pending-runtime": { status: "published", versions: ["0.1.0"] },
    });

    const result = runDetect(tempDir, fixturePath, ["--json"]);
    const report = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(report.packages).toEqual([{ name: "pending-runtime", version: "0.2.0" }]);
    expect(report.newPackages).toEqual([{ name: "new-runtime", version: "0.1.0" }]);
    expect(report.unknownPackages).toEqual([]);
  });

  it("can fail when registry status is unknown", () => {
    const tempDir = makeTempDir();
    writePackage(tempDir, "unknown-runtime", "0.1.0");
    const fixturePath = writeFixture(tempDir, {
      "@tingrudeng/unknown-runtime": { status: "unknown", error: "registry timeout" },
    });

    const result = runDetect(tempDir, fixturePath, ["--require-known"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("@tingrudeng/unknown-runtime: registry timeout");
  });
});

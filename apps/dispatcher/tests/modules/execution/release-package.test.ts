import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const releaseScriptPath = path.join(repoRoot, "scripts/release-package.js");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-release-package-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function createFakePnpm(rootDir: string, packageDir: string) {
  const binDir = path.join(rootDir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const pnpmPath = path.join(binDir, "pnpm");
  fs.writeFileSync(
    pnpmPath,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const args = process.argv.slice(2);',
      'const logPath = process.env.PNPM_LOG_PATH;',
      'if (logPath) fs.appendFileSync(logPath, `${args.join(" ")}\\n`);',
      'if (args[0] === "list") {',
      '  process.stdout.write(JSON.stringify([{ path: process.env.FAKE_PACKAGE_PATH }], null, 2));',
      '  process.exit(0);',
      '}',
      'if (args.includes("build") || args.includes("publish")) {',
      '  if (logPath) fs.appendFileSync(logPath, `called:${args.join(" ")}\\n`);',
      '  process.exit(0);',
      '}',
      'process.exit(0);',
    ].join("\n"),
  );
  fs.chmodSync(pnpmPath, 0o755);
  return {
    binDir,
    logPath: path.join(rootDir, "pnpm.log"),
    env: {
      PATH: `${binDir}:${process.env.PATH || ""}`,
      FAKE_PACKAGE_PATH: packageDir,
      PNPM_LOG_PATH: path.join(rootDir, "pnpm.log"),
    },
  };
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("release-package CI gate", () => {
  it("refuses local publish by default and keeps dry-run behavior", () => {
    const tempDir = makeTempDir();
    const packageDir = path.join(tempDir, "packages", "release-gate");
    fs.mkdirSync(packageDir, { recursive: true });
    const packageJsonPath = path.join(packageDir, "package.json");
    fs.writeFileSync(
      packageJsonPath,
      `${JSON.stringify({
        name: "@tingrudeng/release-gate",
        version: "1.2.3",
      }, null, 2)}\n`,
    );

    const fakePnpm = createFakePnpm(tempDir, packageDir);
    const result = spawnSync(
      "node",
      [
        releaseScriptPath,
        "--package",
        "release-gate",
        "--bump",
        "patch",
        "--publish",
      ],
      {
        cwd: tempDir,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          ...fakePnpm.env,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toMatch(/CI-only|ci-only|GitHub Actions/i);
    expect(JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version).toBe("1.2.3");
    expect(fs.existsSync(fakePnpm.logPath)).toBe(false);
  });
});

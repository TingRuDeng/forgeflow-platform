import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const smokeScriptPath = path.join(repoRoot, "scripts/verify-published-runtime-smoke.mjs");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-published-smoke-test-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writeProviderPackage(rootDir: string, shortName: string, version: string) {
  const packageDir = path.join(rootDir, "packages", shortName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({ name: `@tingrudeng/${shortName}`, version }, null, 2)}\n`,
  );
}

function writeRegistryFixture(rootDir: string, packages: Record<string, Record<string, unknown>>) {
  const fixturePath = path.join(rootDir, "registry-fixture.json");
  fs.writeFileSync(fixturePath, `${JSON.stringify({ packages }, null, 2)}\n`);
  return fixturePath;
}

function createFakeNpm(rootDir: string) {
  const binDir = path.join(rootDir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, "npm");
  fs.writeFileSync(
    npmPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const prefix = args[args.indexOf('--prefix') + 1];",
      "const packageSpec = args[args.length - 1];",
      "const version = packageSpec.split('@').pop();",
      "const packageDir = path.join(prefix, 'node_modules', '@tingrudeng', 'codex-beta-runtime');",
      "const binDir = path.join(prefix, 'node_modules', '.bin');",
      "fs.mkdirSync(packageDir, { recursive: true });",
      "fs.mkdirSync(binDir, { recursive: true });",
      "fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@tingrudeng/codex-beta-runtime', version }));",
      "const bin = path.join(binDir, 'forgeflow-codex-beta');",
      "fs.writeFileSync(bin, `#!/bin/sh\\nif [ \"$1\" = \"--version\" ]; then echo ${version}; else echo forgeflow-codex-beta help; fi\\n`);",
      "fs.chmodSync(bin, 0o755);",
    ].join("\n"),
  );
  fs.chmodSync(npmPath, 0o755);
  return binDir;
}

function runSmoke(rootDir: string, fixturePath: string, fakeNpmBin: string, args: string[] = []) {
  return spawnSync("node", [
    smokeScriptPath,
    "--root",
    rootDir,
    "--registry-fixture",
    fixturePath,
    "--groups",
    "codex",
    ...args,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeNpmBin}:${process.env.PATH || ""}` },
  });
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("published runtime smoke", () => {
  it("installs a published provider package and verifies its CLI", () => {
    const tempDir = makeTempDir();
    writeProviderPackage(tempDir, "codex-beta-runtime", "0.1.0-beta.2");
    const fixturePath = writeRegistryFixture(tempDir, {
      "@tingrudeng/codex-beta-runtime": { status: "published", versions: ["0.1.0-beta.2"] },
    });
    const fakeNpmBin = createFakeNpm(tempDir);

    const result = runSmoke(tempDir, fixturePath, fakeNpmBin, ["--require-published"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("published runtime smoke passed: codex");
    expect(result.stdout).toContain("Published runtime smoke completed.");
  });

  it("fails in hard mode when the provider package is not published", () => {
    const tempDir = makeTempDir();
    writeProviderPackage(tempDir, "codex-beta-runtime", "0.1.0-beta.2");
    const fixturePath = writeRegistryFixture(tempDir, {
      "@tingrudeng/codex-beta-runtime": { status: "missing" },
    });

    const result = runSmoke(tempDir, fixturePath, createFakeNpm(tempDir), ["--require-published"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("@tingrudeng/codex-beta-runtime@0.1.0-beta.2 registry action=setup_required");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const installScriptPath = path.join(repoRoot, "scripts/verify-runtime-package-install.mjs");
const tempRoots: string[] = [];

const packageFixtures = [
  {
    bin: null,
    dir: "packages/beta-runtime-core",
    name: "@tingrudeng/beta-runtime-core",
    version: "0.1.0-beta.1",
  },
  {
    bin: "forgeflow-codex-beta",
    dependencies: { "@tingrudeng/beta-runtime-core": "workspace:*" },
    dir: "packages/codex-beta-runtime",
    name: "@tingrudeng/codex-beta-runtime",
    version: "0.1.0-beta.1",
  },
];

function makeTempRoot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-runtime-install-test-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writePackageFixture(rootDir: string, options: { omitCodexBin?: boolean } = {}) {
  for (const fixture of packageFixtures) {
    const packageDir = path.join(rootDir, fixture.dir);
    fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "README.md"), `${fixture.name}\n`);
    fs.writeFileSync(path.join(packageDir, "PUBLISHING.md"), `${fixture.name}\n`);
    fs.writeFileSync(path.join(packageDir, "dist", "index.js"), "export {};\n");
    if (fixture.bin && !options.omitCodexBin) {
      fs.writeFileSync(path.join(packageDir, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('ok');\n");
      fs.chmodSync(path.join(packageDir, "dist", "cli.js"), 0o755);
    }
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      `${JSON.stringify({
        name: fixture.name,
        version: fixture.version,
        private: false,
        type: "module",
        files: ["dist", "README.md", "PUBLISHING.md"],
        bin: fixture.bin ? { [fixture.bin]: "dist/cli.js" } : undefined,
        dependencies: fixture.dependencies,
      }, null, 2)}\n`,
    );
  }
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("runtime package install smoke", () => {
  it("packs and installs provider runtime tarballs without leaking workspace dependencies", () => {
    const tempDir = makeTempRoot();
    writePackageFixture(tempDir);

    const result = spawnSync(
      "node",
      [installScriptPath, "--root", tempDir, "--groups", "codex", "--skip-build"],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("runtime package install smoke passed: codex");
    expect(result.stdout).toContain("Runtime package install smoke passed.");
  });

  it("fails when the provider package does not install its CLI bin", () => {
    const tempDir = makeTempRoot();
    writePackageFixture(tempDir, { omitCodexBin: true });

    const result = spawnSync(
      "node",
      [installScriptPath, "--root", tempDir, "--groups", "codex", "--skip-build"],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("did not install bin forgeflow-codex-beta");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const preflightScriptPath = path.join(repoRoot, "scripts/release-publish-preflight.mjs");
const tempRoots: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-release-preflight-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writePackageJson(rootDir: string, packageName = "@tingrudeng/beta-runtime-core") {
  const packageSlug = packageName.split("/").pop() || "beta-runtime-core";
  const packageDir = path.join(rootDir, "packages", packageSlug);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: packageName,
      version: "0.1.0-beta.1",
      private: false,
      repository: {
        type: "git",
        url: "git+https://github.com/TingRuDeng/forgeflow-platform.git",
        directory: `packages/${packageSlug}`,
      },
      homepage: `https://github.com/TingRuDeng/forgeflow-platform/tree/main/packages/${packageSlug}`,
      bugs: { url: "https://github.com/TingRuDeng/forgeflow-platform/issues" },
    }, null, 2)}\n`,
  );
}

function writeProviderPackageJson(rootDir: string) {
  const packageDir = path.join(rootDir, "packages", "codex-beta-runtime");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: "@tingrudeng/codex-beta-runtime",
      version: "0.1.0-beta.1",
      private: false,
      repository: {
        type: "git",
        url: "git+https://github.com/TingRuDeng/forgeflow-platform.git",
        directory: "packages/codex-beta-runtime",
      },
      homepage: "https://github.com/TingRuDeng/forgeflow-platform/tree/main/packages/codex-beta-runtime",
      bugs: { url: "https://github.com/TingRuDeng/forgeflow-platform/issues" },
      dependencies: {
        "@tingrudeng/beta-runtime-core": "workspace:*",
      },
    }, null, 2)}\n`,
  );
}

function createFakeNpm(rootDir: string) {
  const binDir = path.join(rootDir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, "npm");
  fs.writeFileSync(
    npmPath,
    [
      "#!/usr/bin/env node",
      'const target = process.argv[3] || "";',
      'if (target === "@tingrudeng/beta-runtime-core") {',
      '  process.stderr.write("npm ERR! code E404\\n");',
      "  process.exit(1);",
      "}",
      'if (target === "@tingrudeng/beta-runtime-core@0.1.0-beta.1") {',
      '  process.stderr.write("npm ERR! code E404\\n");',
      "  process.exit(1);",
      "}",
      'process.stdout.write("0.1.0-beta.1\\n");',
    ].join("\n"),
  );
  fs.chmodSync(npmPath, 0o755);
  return binDir;
}

function createVersionAvailabilityFakeNpm(
  rootDir: string,
  exactVersionStatus: "missing" | "published" | "error",
) {
  const binDir = path.join(rootDir, "version-check-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, "npm");
  const exactVersionBehavior = exactVersionStatus === "published"
    ? 'process.stdout.write("0.1.0-beta.1\\n"); process.exit(0);'
    : exactVersionStatus === "missing"
      ? 'process.stderr.write("npm ERR! code E404\\n"); process.exit(1);'
      : 'process.stderr.write("npm ERR! code EAI_AGAIN\\n"); process.exit(1);';
  fs.writeFileSync(
    npmPath,
    [
      "#!/usr/bin/env node",
      'const target = process.argv[3] || "";',
      'if (target === "@tingrudeng/beta-runtime-core@0.1.0-beta.1") {',
      `  ${exactVersionBehavior}`,
      "}",
      'process.stdout.write("0.1.0-beta.0\\n");',
    ].join("\n"),
  );
  fs.chmodSync(npmPath, 0o755);
  return binDir;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("release publish preflight", () => {
  it("fails before publish when the npm package name is not configured", () => {
    const tempDir = makeTempDir();
    writePackageJson(tempDir);
    const fakeNpmBin = createFakeNpm(tempDir);

    const result = spawnSync(
      "node",
      [
        preflightScriptPath,
        "--package-dir",
        "packages/beta-runtime-core",
        "--expected-repo",
        "TingRuDeng/forgeflow-platform",
        "--require-trusted-publishing",
        "--require-package-exists",
      ],
      {
        cwd: tempDir,
        encoding: "utf8",
        env: {
          ...process.env,
          NPM_TRUSTED_PUBLISHING_ENABLED: "true",
          PATH: `${fakeNpmBin}:${process.env.PATH || ""}`,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("@tingrudeng/beta-runtime-core must exist on npm");
    expect(result.stderr).toContain("Trusted Publisher");
  });

  it("fails before provider publish when a workspace dependency version is not published", () => {
    const tempDir = makeTempDir();
    writePackageJson(tempDir);
    writeProviderPackageJson(tempDir);
    const fakeNpmBin = createFakeNpm(tempDir);

    const result = spawnSync(
      "node",
      [
        preflightScriptPath,
        "--package-dir",
        "packages/codex-beta-runtime",
        "--expected-repo",
        "TingRuDeng/forgeflow-platform",
        "--require-trusted-publishing",
        "--require-package-exists",
        "--require-published-workspace-deps",
      ],
      {
        cwd: tempDir,
        encoding: "utf8",
        env: {
          ...process.env,
          NPM_TRUSTED_PUBLISHING_ENABLED: "true",
          PATH: `${fakeNpmBin}:${process.env.PATH || ""}`,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("@tingrudeng/codex-beta-runtime requires published workspace dependency @tingrudeng/beta-runtime-core@0.1.0-beta.1");
  });

  it("accepts E404 as an available target version", () => {
    const tempDir = makeTempDir();
    writePackageJson(tempDir);
    const fakeNpmBin = createVersionAvailabilityFakeNpm(tempDir, "missing");

    const result = spawnSync(
      "node",
      [
        preflightScriptPath,
        "--package-dir",
        "packages/beta-runtime-core",
        "--expected-repo",
        "TingRuDeng/forgeflow-platform",
        "--require-package-exists",
        "--require-version-available",
      ],
      {
        cwd: tempDir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeNpmBin}:${process.env.PATH || ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Release preflight passed");
  });

  it.each([
    ["published", "already exists on npm"],
    ["error", "availability check failed"],
  ] as const)("rejects an exact version with npm status %s", (status, expectedError) => {
    const tempDir = makeTempDir();
    writePackageJson(tempDir);
    const fakeNpmBin = createVersionAvailabilityFakeNpm(tempDir, status);

    const result = spawnSync(
      "node",
      [
        preflightScriptPath,
        "--package-dir",
        "packages/beta-runtime-core",
        "--expected-repo",
        "TingRuDeng/forgeflow-platform",
        "--require-package-exists",
        "--require-version-available",
      ],
      {
        cwd: tempDir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeNpmBin}:${process.env.PATH || ""}`,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
  });
});

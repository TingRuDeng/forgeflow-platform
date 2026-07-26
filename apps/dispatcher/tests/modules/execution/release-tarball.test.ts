import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const prepareScriptPath = path.join(repoRoot, "scripts/prepare-release-tarball.mjs");
const verifyScriptPath = path.join(repoRoot, "scripts/verify-published-package-tarball.mjs");
const tempRoots: string[] = [];

function makeTempRoot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-release-tarball-test-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writePackage(
  rootDir: string,
  shortName: string,
  options: { dependencies?: Record<string, string>; withBin?: boolean; withPrepack?: boolean } = {},
) {
  const packageDir = path.join(rootDir, "packages", shortName);
  fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "README.md"), `${shortName}\n`);
  fs.writeFileSync(
    path.join(packageDir, "dist", options.withBin ? "cli.js" : "index.js"),
    options.withBin ? "#!/usr/bin/env node\nconsole.log('ok');\n" : "export {};\n",
  );
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: `@tingrudeng/${shortName}`,
      version: "1.2.3",
      private: false,
      type: "module",
      files: ["./dist", "README.md"],
      bin: options.withBin ? { [`forgeflow-${shortName}`]: "dist/cli.js" } : undefined,
      dependencies: options.dependencies,
      scripts: options.withPrepack
        ? { prepack: "node -e \"require('node:fs').writeFileSync('prepack-ran', 'yes')\"" }
        : undefined,
    }, null, 2)}\n`,
  );
  return packageDir;
}

function prepare(rootDir: string, shortName: string) {
  const outputDir = path.join(rootDir, "release-output");
  const manifestPath = path.join(rootDir, "release-manifest.json");
  const result = spawnSync("node", [
    prepareScriptPath,
    "--root",
    rootDir,
    "--package-dir",
    `packages/${shortName}`,
    "--output-dir",
    outputDir,
    "--manifest",
    manifestPath,
  ], { cwd: repoRoot, encoding: "utf8" });
  return {
    manifestPath,
    result,
    manifest: result.status === 0 ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null,
  };
}

function writeRegistryFixture(
  rootDir: string,
  shortName: string,
  metadata: Record<string, unknown>,
  distTags: Record<string, string> = { latest: "1.2.3" },
) {
  const fixturePath = path.join(rootDir, "registry-fixture.json");
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify({
      packages: {
        [`@tingrudeng/${shortName}`]: {
          status: "published",
          versions: ["1.2.3"],
          metadata: { "1.2.3": metadata },
          distTags,
        },
      },
    }, null, 2)}\n`,
  );
  return fixturePath;
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("exact release tarball", () => {
  it("prepares one tarball and verifies the exact registry artifact and install", () => {
    const tempDir = makeTempRoot();
    writePackage(tempDir, "release-fixture", { withBin: true, withPrepack: true });
    const prepared = prepare(tempDir, "release-fixture");

    expect(prepared.result.status).toBe(0);
    expect(prepared.manifest.packageName).toBe("@tingrudeng/release-fixture");
    expect(prepared.manifest.version).toBe("1.2.3");
    expect(prepared.manifest.files).toContain("dist/cli.js");
    expect(fs.existsSync(path.join(tempDir, "packages", "release-fixture", "prepack-ran"))).toBe(false);

    const fixturePath = writeRegistryFixture(tempDir, "release-fixture", {
      dist: {
        tarball: pathToFileURL(prepared.manifest.tarball).href,
        integrity: prepared.manifest.integrity,
        shasum: prepared.manifest.shasum,
      },
    });
    const verified = spawnSync("node", [
      verifyScriptPath,
      "--root",
      tempDir,
      "--package",
      "release-fixture",
      "--registry-fixture",
      fixturePath,
      "--expected-manifest",
      prepared.manifestPath,
      "--expected-dist-tag",
      "latest",
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain("published package tarball verified: @tingrudeng/release-fixture@1.2.3");
  });

  it("rewrites workspace protocols only inside the packed manifest and restores source", () => {
    const tempDir = makeTempRoot();
    writePackage(tempDir, "shared-core");
    const packageDir = writePackage(tempDir, "provider-runtime", {
      dependencies: { "@tingrudeng/shared-core": "workspace:*" },
    });
    const prepared = prepare(tempDir, "provider-runtime");

    expect(prepared.result.status).toBe(0);
    const packedManifest = JSON.parse(execFileSync(
      "tar",
      ["-xOf", prepared.manifest.tarball, "package/package.json"],
      { encoding: "utf8" },
    ));
    expect(packedManifest.dependencies).toEqual({ "@tingrudeng/shared-core": "1.2.3" });
    expect(JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).dependencies)
      .toEqual({ "@tingrudeng/shared-core": "workspace:*" });
  });

  it("fails closed when registry integrity does not match the downloaded tarball", () => {
    const tempDir = makeTempRoot();
    writePackage(tempDir, "release-fixture");
    const prepared = prepare(tempDir, "release-fixture");
    const fixturePath = writeRegistryFixture(tempDir, "release-fixture", {
      dist: {
        tarball: pathToFileURL(prepared.manifest.tarball).href,
        integrity: "sha512-ZGVmaW5pdGVseS13cm9uZw==",
        shasum: prepared.manifest.shasum,
      },
    });
    const verified = spawnSync("node", [
      verifyScriptPath,
      "--root",
      tempDir,
      "--package",
      "release-fixture",
      "--registry-fixture",
      fixturePath,
      "--expected-manifest",
      prepared.manifestPath,
      "--skip-install",
      "--registry-attempts",
      "1",
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(verified.status).not.toBe(0);
    expect(verified.stderr).toContain("integrity mismatch");
  });

  it("requires complete registry dist metadata", () => {
    const tempDir = makeTempRoot();
    writePackage(tempDir, "release-fixture");
    const prepared = prepare(tempDir, "release-fixture");
    const fixturePath = writeRegistryFixture(tempDir, "release-fixture", { dist: {} });
    const verified = spawnSync("node", [
      verifyScriptPath,
      "--root",
      tempDir,
      "--package",
      "release-fixture",
      "--registry-fixture",
      fixturePath,
      "--expected-manifest",
      prepared.manifestPath,
      "--skip-install",
      "--registry-attempts",
      "1",
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(verified.status).not.toBe(0);
    expect(verified.stderr).toContain("dist.tarball, dist.integrity, and dist.shasum");
  });

  it("waits for the expected registry dist-tag to point to the published version", () => {
    const tempDir = makeTempRoot();
    writePackage(tempDir, "release-fixture");
    const prepared = prepare(tempDir, "release-fixture");
    const fixturePath = writeRegistryFixture(
      tempDir,
      "release-fixture",
      {
        dist: {
          tarball: pathToFileURL(prepared.manifest.tarball).href,
          integrity: prepared.manifest.integrity,
          shasum: prepared.manifest.shasum,
        },
      },
      { latest: "1.2.2" },
    );
    const verified = spawnSync("node", [
      verifyScriptPath,
      "--root",
      tempDir,
      "--package",
      "release-fixture",
      "--registry-fixture",
      fixturePath,
      "--expected-manifest",
      prepared.manifestPath,
      "--expected-dist-tag",
      "latest",
      "--skip-install",
      "--registry-attempts",
      "1",
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(verified.status).not.toBe(0);
    expect(verified.stderr).toContain("dist-tag latest");
    expect(verified.stderr).toContain("1.2.2");
  });

  it("rejects common private-key files before writing a usable release manifest", () => {
    const tempDir = makeTempRoot();
    const packageDir = writePackage(tempDir, "release-fixture");
    fs.mkdirSync(path.join(packageDir, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "secrets", "id_ed25519"), "private key fixture\n");
    const packageJsonPath = path.join(packageDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    packageJson.files.push("secrets");
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const prepared = prepare(tempDir, "release-fixture");

    expect(prepared.result.status).not.toBe(0);
    expect(prepared.result.stderr).toContain("sensitive file");
    expect(fs.existsSync(path.join(tempDir, "release-manifest.json"))).toBe(false);
  });

  it("rejects symlinks in a downloaded registry tarball", () => {
    const tempDir = makeTempRoot();
    const packageDir = writePackage(tempDir, "release-fixture");
    const stagingDir = path.join(tempDir, "malicious-staging");
    const stagedPackageDir = path.join(stagingDir, "package");
    fs.cpSync(packageDir, stagedPackageDir, { recursive: true });
    fs.symlinkSync("dist/index.js", path.join(stagedPackageDir, "linked-index.js"));
    const tarball = path.join(tempDir, "malicious.tgz");
    execFileSync("tar", ["-czf", tarball, "-C", stagingDir, "package"]);
    const bytes = fs.readFileSync(tarball);
    const fixturePath = writeRegistryFixture(tempDir, "release-fixture", {
      dist: {
        tarball: pathToFileURL(tarball).href,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        shasum: createHash("sha1").update(bytes).digest("hex"),
      },
    });

    const verified = spawnSync("node", [
      verifyScriptPath,
      "--root",
      tempDir,
      "--package",
      "release-fixture",
      "--registry-fixture",
      fixturePath,
      "--skip-install",
      "--registry-attempts",
      "1",
    ], { cwd: repoRoot, encoding: "utf8" });

    expect(verified.status).not.toBe(0);
    expect(verified.stderr).toContain("unsupported link or special entry");
  });
});

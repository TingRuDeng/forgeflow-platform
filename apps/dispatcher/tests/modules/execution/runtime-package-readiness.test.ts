import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const readinessScriptPath = path.join(repoRoot, "scripts/check-runtime-package-readiness.mjs");
const tempRoots: string[] = [];

const packageSpecs = [
  {
    dir: "packages/automation-gateway-core",
    name: "@tingrudeng/automation-gateway-core",
    dependencies: {},
    scripts: { build: "tsc", typecheck: "tsc --noEmit", test: "vitest" },
  },
  {
    dir: "packages/beta-runtime-core",
    name: "@tingrudeng/beta-runtime-core",
    dependencies: {},
    scripts: { build: "tsc", typecheck: "tsc --noEmit", test: "vitest" },
  },
  {
    bin: { "forgeflow-dispatcher": "dist/cli.js" },
    dir: "packages/forgeflow-dispatcher",
    name: "@tingrudeng/forgeflow-dispatcher",
    dependencies: {},
    scripts: { build: "node ./scripts/build.mjs", typecheck: "tsc --noEmit", test: "vitest" },
  },
  {
    bin: { "forgeflow-codex-beta": "dist/cli.js" },
    dir: "packages/codex-beta-runtime",
    name: "@tingrudeng/codex-beta-runtime",
    dependencies: { "@tingrudeng/beta-runtime-core": "workspace:*" },
    scripts: {
      build: "tsc",
      prepublishOnly: "node ../../scripts/rewrite-workspace-deps.mjs package.json",
      typecheck: "tsc --noEmit",
      test: "vitest",
    },
  },
  {
    bin: { "forgeflow-gemini-beta": "dist/cli.js" },
    dir: "packages/gemini-beta-runtime",
    name: "@tingrudeng/gemini-beta-runtime",
    dependencies: { "@tingrudeng/beta-runtime-core": "workspace:*" },
    scripts: {
      build: "tsc",
      prepublishOnly: "node ../../scripts/rewrite-workspace-deps.mjs package.json",
      typecheck: "tsc --noEmit",
      test: "vitest",
    },
  },
  {
    bin: { "forgeflow-trae-beta": "dist/cli.js" },
    dir: "packages/trae-beta-runtime",
    name: "@tingrudeng/trae-beta-runtime",
    dependencies: {
      "@tingrudeng/automation-gateway-core": "workspace:*",
      "@tingrudeng/beta-runtime-core": "workspace:*",
    },
    scripts: { build: "tsc", typecheck: "tsc --noEmit", test: "vitest" },
  },
];

function makeTempRoot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-runtime-readiness-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writeRuntimePackages(rootDir: string, overrides: Record<string, Record<string, unknown>> = {}) {
  for (const spec of packageSpecs) {
    const packageDir = path.join(rootDir, spec.dir);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "README.md"), `${spec.name}\n`);
    fs.writeFileSync(path.join(packageDir, "PUBLISHING.md"), `${spec.name}\n`);
    const override = overrides[spec.name] ?? {};
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      `${JSON.stringify({
        name: spec.name,
        version: "0.1.0-beta.1",
        private: false,
        files: ["dist", "README.md", "PUBLISHING.md"],
        scripts: spec.scripts,
        dependencies: spec.dependencies,
        bin: spec.bin,
        publishConfig: { access: "public" },
        ...override,
      }, null, 2)}\n`,
    );
  }
}

function createFakeNpm(rootDir: string, options: {
  dependencyMetadata?: Record<string, Record<string, string>>;
  distTagVersions?: Record<string, string>;
  missingPackages?: string[];
  requireIsolatedCache?: boolean;
} = {}) {
  const binDir = path.join(rootDir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, "npm");
  fs.writeFileSync(
    npmPath,
    [
      "#!/usr/bin/env node",
      `const missingPackages = ${JSON.stringify(options.missingPackages ?? ["beta-runtime-core", "gemini-beta-runtime"])};`,
      `const dependencyMetadata = ${JSON.stringify(options.dependencyMetadata ?? {})};`,
      `const distTagVersions = ${JSON.stringify(options.distTagVersions ?? {})};`,
      `const requireIsolatedCache = ${JSON.stringify(options.requireIsolatedCache ?? false)};`,
      'const cacheDir = process.env.NPM_CONFIG_CACHE || "";',
      'const userCacheDir = process.env.FORGEFLOW_TEST_USER_NPM_CACHE || "";',
      'if (requireIsolatedCache && (!cacheDir || cacheDir === userCacheDir)) {',
      '  process.stderr.write("npm ERR! code EACCES\\n");',
      "  process.exit(1);",
      "}",
      'const target = process.argv[3] || "";',
      'const field = process.argv[4] || "version";',
      'if (missingPackages.some((name) => target.includes(name))) {',
      '  process.stderr.write("npm ERR! code E404\\n");',
      "  process.exit(1);",
      "}",
      'if (field === "dependencies") {',
      '  process.stdout.write(JSON.stringify(dependencyMetadata[target] || {}));',
      "  process.exit(0);",
      "}",
      "if (Object.prototype.hasOwnProperty.call(distTagVersions, target)) {",
      '  process.stdout.write(`${distTagVersions[target]}\\n`);',
      "  process.exit(0);",
      "}",
      'process.stdout.write("0.1.0-beta.1\\n");',
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

describe("runtime package readiness", () => {
  it("passes against the current repository package manifests", () => {
    const result = spawnSync("node", [readinessScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@tingrudeng/beta-runtime-core");
    expect(result.stdout).toContain("Runtime package readiness passed.");
  });

  it("rejects provider runtime packages without workspace dependency rewrite", () => {
    const tempDir = makeTempRoot();
    writeRuntimePackages(tempDir, {
      "@tingrudeng/gemini-beta-runtime": {
        scripts: { build: "tsc", typecheck: "tsc --noEmit", test: "vitest" },
      },
    });

    const result = spawnSync("node", [readinessScriptPath, "--root", tempDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prepublishOnly");
  });

  it("can turn registry package creation into a hard production gate", () => {
    const tempDir = makeTempRoot();
    writeRuntimePackages(tempDir);
    const fakeNpmBin = createFakeNpm(tempDir);

    const result = spawnSync(
      "node",
      [readinessScriptPath, "--root", tempDir, "--check-registry", "--require-published"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeNpmBin}:${process.env.PATH || ""}` },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("@tingrudeng/beta-runtime-core 尚未在 npm registry 创建");
    expect(result.stderr).toContain("@tingrudeng/gemini-beta-runtime 尚未在 npm registry 创建");
  });

  it("isolates registry queries from the user npm cache", () => {
    const tempDir = makeTempRoot();
    writeRuntimePackages(tempDir);
    const fakeNpmBin = createFakeNpm(tempDir, {
      missingPackages: [],
      requireIsolatedCache: true,
    });
    const userCacheDir = path.join(tempDir, "poisoned-npm-cache");

    const result = spawnSync(
      "node",
      [readinessScriptPath, "--root", tempDir, "--check-registry", "--require-published"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FORGEFLOW_TEST_USER_NPM_CACHE: userCacheDir,
          NPM_CONFIG_CACHE: userCacheDir,
          PATH: `${fakeNpmBin}:${process.env.PATH || ""}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Runtime package readiness passed.");
    expect(result.stdout).toContain("releaseTag=beta:current:0.1.0-beta.1");
  });

  it("rejects a stale prerelease dist-tag even when the exact version exists", () => {
    const tempDir = makeTempRoot();
    writeRuntimePackages(tempDir);
    const fakeNpmBin = createFakeNpm(tempDir, {
      missingPackages: [],
      distTagVersions: {
        "@tingrudeng/codex-beta-runtime@beta": "0.1.0-beta.0",
      },
    });

    const result = spawnSync(
      "node",
      [readinessScriptPath, "--root", tempDir, "--check-registry", "--require-published"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeNpmBin}:${process.env.PATH || ""}` },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "@tingrudeng/codex-beta-runtime 的 beta dist-tag 应指向 0.1.0-beta.1，实际为 0.1.0-beta.0",
    );
  });

  it("rejects published runtime packages whose npm dependency metadata is stale", () => {
    const tempDir = makeTempRoot();
    writeRuntimePackages(tempDir);
    const fakeNpmBin = createFakeNpm(tempDir, {
      missingPackages: [],
      dependencyMetadata: {
        "@tingrudeng/codex-beta-runtime@0.1.0-beta.1": {},
        "@tingrudeng/gemini-beta-runtime@0.1.0-beta.1": {
          "@tingrudeng/beta-runtime-core": "0.1.0-beta.1",
        },
        "@tingrudeng/trae-beta-runtime@0.1.0-beta.1": {
          "@tingrudeng/automation-gateway-core": "0.1.0-beta.1",
        },
      },
    });

    const result = spawnSync(
      "node",
      [readinessScriptPath, "--root", tempDir, "--check-registry", "--check-published-metadata"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeNpmBin}:${process.env.PATH || ""}` },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "@tingrudeng/codex-beta-runtime@0.1.0-beta.1 published dependency @tingrudeng/beta-runtime-core 应为 0.1.0-beta.1",
    );
  });
});

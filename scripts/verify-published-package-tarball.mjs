#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  parsePositiveInteger,
  queryPackageRegistry,
  readRegistryFixture,
} from "./lib/npm-registry-status.mjs";
import { assertSafeReleaseFilePath } from "./lib/release-tarball-policy.mjs";
import { readJson } from "./lib/runtime-package-specs.mjs";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

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

function requireStringArg(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function normalizePackageName(input) {
  return input.startsWith("@tingrudeng/") ? input : `@tingrudeng/${input}`;
}

function packageShortName(packageName) {
  const shortName = packageName.split("/").pop();
  if (!shortName) {
    throw new Error(`invalid package name ${packageName}`);
  }
  return shortName;
}

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function assertSafeArchivePath(entry) {
  const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    !normalized.startsWith("package/")
    || normalized.startsWith("/")
    || segments.includes("..")
  ) {
    throw new Error(`unsafe registry tarball path: ${entry}`);
  }
  const relativePath = normalized.slice("package/".length);
  return assertSafeReleaseFilePath(relativePath, "registry tarball");
}

function assertRegularArchiveEntries(verboseListing) {
  for (const line of verboseListing.split(/\r?\n/).filter(Boolean)) {
    const entryType = line[0];
    if (entryType !== "-" && entryType !== "d") {
      throw new Error(`registry tarball contains unsupported link or special entry: ${line}`);
    }
  }
}

function normalizeBin(bin) {
  if (typeof bin === "string") {
    return { bin };
  }
  return bin && typeof bin === "object" ? bin : {};
}

function assertNoWorkspaceProtocols(packageJson) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(packageJson[field] || {})) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        throw new Error(`${packageJson.name} registry tarball leaked ${field}.${name}=${range}`);
      }
    }
  }
}

function assertPackageContents(packageJson, packageRoot, archiveFiles) {
  for (const declared of packageJson.files || []) {
    const normalized = declared.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!archiveFiles.some((fileName) => fileName === normalized || fileName.startsWith(`${normalized}/`))) {
      throw new Error(`${packageJson.name} registry tarball is missing declared files entry ${declared}`);
    }
  }
  for (const [name, target] of Object.entries(normalizeBin(packageJson.bin))) {
    if (typeof target !== "string") {
      throw new Error(`${packageJson.name} bin ${name} must point to a file`);
    }
    const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!archiveFiles.includes(normalizedTarget) || !fs.existsSync(path.join(packageRoot, normalizedTarget))) {
      throw new Error(`${packageJson.name} registry tarball is missing bin ${name} target ${target}`);
    }
  }
}

function verifyDigest(tarball, dist) {
  const bytes = fs.readFileSync(tarball);
  const shasum = createHash("sha1").update(bytes).digest("hex");
  if (shasum !== dist.shasum) {
    throw new Error(`registry tarball shasum mismatch: expected ${dist.shasum}, got ${shasum}`);
  }

  const supported = new Set(["sha256", "sha384", "sha512"]);
  const integrityTokens = dist.integrity.split(/\s+/).filter(Boolean);
  let matched = false;
  for (const token of integrityTokens) {
    const match = token.match(/^([a-z0-9]+)-([^?]+)(?:\?.*)?$/i);
    if (!match || !supported.has(match[1].toLowerCase())) {
      continue;
    }
    const digest = createHash(match[1].toLowerCase()).update(bytes).digest("base64");
    if (digest === match[2]) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw new Error(`registry tarball integrity mismatch for ${dist.integrity}`);
  }
}

function downloadHttp(url, targetPath, timeoutMs, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "http:" ? http : https;
    let activeResponse = null;
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        fs.rmSync(targetPath, { force: true });
        reject(error);
      } else {
        resolve();
      }
    };
    const request = client.get(url, { headers: { Accept: "application/octet-stream" } }, async (response) => {
      activeResponse = response;
      response.on("error", finish);
      if (
        response.statusCode
        && response.statusCode >= 300
        && response.statusCode < 400
        && response.headers.location
      ) {
        response.resume();
        if (redirectsRemaining <= 0) {
          finish(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        const redirectUrl = new URL(response.headers.location, url);
        if (url.protocol === "https:" && redirectUrl.protocol !== "https:") {
          finish(new Error(`refusing registry tarball redirect from HTTPS to ${redirectUrl.protocol}`));
          return;
        }
        settled = true;
        clearTimeout(timeout);
        downloadHttp(redirectUrl, targetPath, timeoutMs, redirectsRemaining - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        finish(new Error(`registry tarball download failed with HTTP ${response.statusCode}`));
        return;
      }
      const output = fs.createWriteStream(targetPath, { flags: "wx" });
      try {
        await pipeline(response, output);
        finish();
      } catch (error) {
        finish(error);
      }
    });
    timeout = setTimeout(() => {
      const error = new Error(`registry tarball download timed out: ${url}`);
      activeResponse?.destroy(error);
      request.destroy(error);
      finish(error);
    }, timeoutMs);
    request.on("error", finish);
  });
}

async function downloadTarball(tarballUrl, targetPath, timeoutMs, allowFileUrl) {
  const url = new URL(tarballUrl);
  if (url.protocol === "file:") {
    if (!allowFileUrl) {
      throw new Error("registry tarball file: URLs are allowed only with --registry-fixture");
    }
    fs.copyFileSync(fileURLToPath(url), targetPath, fs.constants.COPYFILE_EXCL);
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`unsupported registry tarball protocol ${url.protocol}`);
  }
  try {
    await downloadHttp(url, targetPath, timeoutMs);
  } catch (error) {
    fs.rmSync(targetPath, { force: true });
    throw error;
  }
}

async function waitForRegistryDist(
  packageName,
  version,
  expectedDistTag,
  options,
  attempts,
  retryDelayMs,
) {
  let lastStatus = "not_checked";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const registry = await queryPackageRegistry({ name: packageName, version }, options);
    const dist = registry.versionStatus.dist;
    const taggedVersion = expectedDistTag
      ? registry.packageStatus.distTags?.[expectedDistTag]
      : version;
    if (
      registry.versionStatus.status === "published"
      && dist?.tarball
      && dist.integrity
      && dist.shasum
      && taggedVersion === version
    ) {
      return dist;
    }
    if (registry.versionStatus.status !== "published") {
      lastStatus = registry.versionStatus.status;
    } else if (!dist?.tarball || !dist.integrity || !dist.shasum) {
      lastStatus = "published version is missing complete dist metadata";
    } else {
      lastStatus = taggedVersion
        ? `dist-tag ${expectedDistTag} points to ${taggedVersion}`
        : `dist-tag ${expectedDistTag} is missing`;
    }
    if (attempt < attempts) {
      console.warn(
        `registry metadata not ready for ${packageName}@${version} `
        + `(attempt ${attempt}/${attempts}: ${lastStatus})`,
      );
      await wait(retryDelayMs);
    }
  }
  const distTagRequirement = expectedDistTag
    ? ` and dist-tag ${expectedDistTag} must point to that version`
    : "";
  throw new Error(
    `${packageName}@${version} registry metadata must include dist.tarball, dist.integrity, and dist.shasum`
    + `${distTagRequirement} (last status: ${lastStatus})`,
  );
}

function verifyExpectedManifest(expectedManifest, packageName, version, dist, archiveFiles) {
  if (!expectedManifest) {
    return;
  }
  if (expectedManifest.packageName !== packageName || expectedManifest.version !== version) {
    throw new Error(
      `release manifest mismatch: expected ${packageName}@${version}, `
      + `got ${expectedManifest.packageName}@${expectedManifest.version}`,
    );
  }
  if (expectedManifest.integrity !== dist.integrity || expectedManifest.shasum !== dist.shasum) {
    throw new Error("registry dist metadata does not match the exact tarball prepared for publish");
  }
  const expectedFiles = [...(expectedManifest.files || [])].sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(archiveFiles)) {
    throw new Error("registry tarball file set does not match the exact tarball prepared for publish");
  }
}

function assertInstalledPackage(installDir, packageName, version, packageJson) {
  const installedPath = path.join(installDir, "node_modules", packageName, "package.json");
  if (!fs.existsSync(installedPath)) {
    throw new Error(`${packageName} exact registry tarball was not installed`);
  }
  const installed = readJson(installedPath);
  if (installed.name !== packageName || installed.version !== version) {
    throw new Error(
      `installed package mismatch: expected ${packageName}@${version}, got ${installed.name}@${installed.version}`,
    );
  }
  assertNoWorkspaceProtocols(installed);
  for (const name of Object.keys(normalizeBin(packageJson.bin))) {
    const binPath = path.join(installDir, "node_modules", ".bin", name);
    if (!fs.existsSync(binPath) && !fs.existsSync(`${binPath}.cmd`)) {
      throw new Error(`${packageName} exact registry tarball did not install bin ${name}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(typeof args.root === "string" ? args.root : process.cwd());
  const packageName = normalizePackageName(requireStringArg(args, "package"));
  const localPackageJson = readJson(path.join(rootDir, "packages", packageShortName(packageName), "package.json"));
  if (localPackageJson.name !== packageName || typeof localPackageJson.version !== "string") {
    throw new Error(`local package manifest does not match ${packageName}`);
  }
  const version = typeof args.version === "string" ? args.version : localPackageJson.version;
  if (version !== localPackageJson.version) {
    throw new Error(`release version mismatch: expected local ${localPackageJson.version}, got ${version}`);
  }

  const options = {
    fixture: readRegistryFixture(typeof args["registry-fixture"] === "string" ? args["registry-fixture"] : ""),
    registryUrl: typeof args["registry-url"] === "string" ? args["registry-url"] : "https://registry.npmjs.org/",
    timeoutMs: parsePositiveInteger(args["registry-timeout-ms"], 15000),
  };
  const expectedDistTag = typeof args["expected-dist-tag"] === "string"
    ? args["expected-dist-tag"].trim()
    : "";
  if (expectedDistTag && !/^[a-z0-9][a-z0-9._-]*$/i.test(expectedDistTag)) {
    throw new Error(`invalid expected dist-tag ${expectedDistTag}`);
  }
  const dist = await waitForRegistryDist(
    packageName,
    version,
    expectedDistTag,
    options,
    parsePositiveInteger(args["registry-attempts"], 6),
    parsePositiveInteger(args["registry-retry-delay-ms"], 5000),
  );

  const expectedManifest = typeof args["expected-manifest"] === "string"
    ? readJson(path.resolve(args["expected-manifest"]))
    : null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-registry-tarball-"));
  const tarball = path.join(tempDir, `${packageShortName(packageName)}-${version}.tgz`);
  try {
    await downloadTarball(dist.tarball, tarball, options.timeoutMs, Boolean(options.fixture));
    verifyDigest(tarball, dist);

    assertRegularArchiveEntries(run("tar", ["-tvzf", tarball], rootDir));
    const archiveEntries = run("tar", ["-tzf", tarball], rootDir).split(/\r?\n/).filter(Boolean);
    const archiveFiles = archiveEntries
      .filter((entry) => !entry.endsWith("/"))
      .map(assertSafeArchivePath)
      .sort();
    if (!archiveFiles.includes("package.json")) {
      throw new Error(`${packageName}@${version} registry tarball is missing package.json`);
    }
    verifyExpectedManifest(expectedManifest, packageName, version, dist, archiveFiles);

    const extractDir = path.join(tempDir, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", extractDir], rootDir);
    const packageRoot = path.join(extractDir, "package");
    const packedPackageJson = readJson(path.join(packageRoot, "package.json"));
    if (packedPackageJson.name !== packageName || packedPackageJson.version !== version) {
      throw new Error(
        `registry tarball manifest mismatch: expected ${packageName}@${version}, `
        + `got ${packedPackageJson.name}@${packedPackageJson.version}`,
      );
    }
    assertNoWorkspaceProtocols(packedPackageJson);
    assertPackageContents(packedPackageJson, packageRoot, archiveFiles);

    if (args["skip-install"] !== true) {
      const installDir = path.join(tempDir, "install");
      fs.mkdirSync(installDir, { recursive: true });
      run("npm", [
        "install",
        "--prefix",
        installDir,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry",
        options.registryUrl,
        tarball,
      ], rootDir, { NPM_CONFIG_CACHE: path.join(tempDir, ".npm-cache") });
      assertInstalledPackage(installDir, packageName, version, packedPackageJson);
    }

    console.log(`published package tarball verified: ${packageName}@${version}`);
    if (expectedDistTag) {
      console.log(`- dist-tag: ${expectedDistTag}`);
    }
    console.log(`- integrity: ${dist.integrity}`);
    console.log(`- files: ${archiveFiles.length}`);
  } finally {
    if (args["keep-temp"] === true) {
      console.log(`kept temp dir: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`Published package tarball verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

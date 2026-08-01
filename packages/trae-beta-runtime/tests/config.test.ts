import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultTraeBetaConfig,
  normalizeTraeBetaConfig,
  readTraeBetaConfig,
  writeTraeBetaConfig,
} from "../src/config.js";
import { initTraeBetaConfig } from "../src/init.js";

const tempRoots: string[] = [];

function makeTempConfigPath(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return path.join(root, "config", "config.json");
}

function makeConfig(dispatcherToken = "test-dispatcher-token") {
  return createDefaultTraeBetaConfig({
    projectPath: "/tmp/project",
    workerId: "trae-remote",
    dispatcherToken,
  }, {
    cwd: "/tmp/project",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("@tingrudeng/trae-beta-runtime config", () => {
  it("rejects whitespace dispatcher tokens", () => {
    expect(() => createDefaultTraeBetaConfig({
      dispatcherToken: "   ",
    })).toThrow(/Trae config dispatcherToken.*non-empty/i);
  });

  it("creates the new self-contained config shape without forgeflowRootDir", () => {
    const config = createDefaultTraeBetaConfig({
      projectPath: "/tmp/project",
      workerId: "trae-remote",
    }, {
      cwd: "/tmp/project",
    });

    expect(config.version).toBe(2);
    expect(config.projectPath).toBe("/tmp/project");
    expect("forgeflowRootDir" in config).toBe(false);
  });

  it("normalizes partial config into the new shape", () => {
    const config = normalizeTraeBetaConfig({
      version: 2,
      projectPath: "/tmp/project",
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
    }, {
      cwd: "/tmp/project",
    });

    expect(config.version).toBe(2);
    expect(config.projectPath).toBe("/tmp/project");
    expect(config.workerId).toBe("trae-remote");
    expect("forgeflowRootDir" in config).toBe(false);
  });

  it("creates owner-only config directories and files", () => {
    const configPath = makeTempConfigPath("trae-beta-config-create-");

    writeTraeBetaConfig(makeConfig(), { configPath });

    expect(readTraeBetaConfig({ configPath })?.dispatcherToken).toBe("test-dispatcher-token");
    expect(fs.statSync(path.dirname(configPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("repairs an existing group-readable config file when writing", () => {
    const configPath = makeTempConfigPath("trae-beta-config-rewrite-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    writeTraeBetaConfig(makeConfig(), { configPath });

    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("rejects config files readable by group or others", () => {
    const configPath = makeTempConfigPath("trae-beta-config-insecure-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    expect(() => readTraeBetaConfig({ configPath })).toThrow(/insecure Trae beta config permissions/i);
  });

  it("repairs legacy permissions during init without dropping the dispatcher token", () => {
    const configPath = makeTempConfigPath("trae-beta-config-init-repair-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig("preserved-token"))}\n`, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    const result = initTraeBetaConfig({ configPath });

    expect(result.created).toBe(false);
    expect(result.config.dispatcherToken).toBe("preserved-token");
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("replaces the persisted dispatcher token when overwrite is explicit", () => {
    const configPath = makeTempConfigPath("trae-beta-config-token-rotate-");
    writeTraeBetaConfig(makeConfig("old-token"), { configPath });

    const result = initTraeBetaConfig({
      configPath,
      overwrite: true,
      dispatcherToken: "new-token",
    });

    expect(result.config.dispatcherToken).toBe("new-token");
    expect(readTraeBetaConfig({ configPath })?.dispatcherToken).toBe("new-token");
  });

  it("repairs the legacy default config directory mode during init", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trae-beta-config-default-dir-"));
    tempRoots.push(root);
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(root);

    try {
      const configPath = path.join(root, ".forgeflow-trae-beta", "config.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o755 });
      fs.chmodSync(path.dirname(configPath), 0o755);
      fs.writeFileSync(configPath, `${JSON.stringify(makeConfig("preserved-token"))}\n`, { mode: 0o600 });

      expect(() => readTraeBetaConfig()).toThrow(/insecure Trae beta config permissions/i);

      const result = initTraeBetaConfig();

      expect(result.config.dispatcherToken).toBe("preserved-token");
      expect(fs.statSync(path.dirname(configPath)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    } finally {
      homedir.mockRestore();
    }
  });

  it("rejects symbolic-link config files without overwriting their target", () => {
    const configPath = makeTempConfigPath("trae-beta-config-symlink-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const targetPath = path.join(path.dirname(path.dirname(configPath)), "target.json");
    fs.writeFileSync(targetPath, "do-not-overwrite\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, configPath);

    expect(() => writeTraeBetaConfig(makeConfig(), { configPath })).toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("do-not-overwrite\n");
  });

  it("rejects custom config directories writable by group or others", () => {
    const configPath = makeTempConfigPath("trae-beta-config-writable-dir-");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o777 });
    fs.chmodSync(path.dirname(configPath), 0o777);
    fs.writeFileSync(configPath, `${JSON.stringify(makeConfig())}\n`, { mode: 0o600 });

    expect(() => readTraeBetaConfig({ configPath })).toThrow(/config directory.*writable/i);
  });

  it("rejects symbolic links in custom config directory paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trae-beta-config-linked-dir-"));
    tempRoots.push(root);
    const targetDir = path.join(root, "target", "config");
    const linkedParent = path.join(root, "linked-parent");
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(root, "target"), linkedParent, "dir");
    const configPath = path.join(linkedParent, "config", "config.json");
    fs.writeFileSync(path.join(targetDir, "config.json"), `${JSON.stringify(makeConfig())}\n`, { mode: 0o600 });

    expect(() => readTraeBetaConfig({ configPath })).toThrow(/directory path contains a symbolic link/i);
  });

  it("rejects config replacement between inspection and file open", () => {
    const configPath = makeTempConfigPath("trae-beta-config-replaced-");
    const configDir = path.dirname(configPath);
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeTraeBetaConfig(makeConfig("original-token"), { configPath });
    const canonicalPath = path.join(fs.realpathSync.native(configDir), path.basename(configPath));
    const replacementPath = path.join(configDir, "replacement.json");
    fs.writeFileSync(replacementPath, `${JSON.stringify(makeConfig("replacement-token"))}\n`, { mode: 0o600 });

    const originalOpenSync = fs.openSync.bind(fs);
    let replaced = false;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (!replaced && path.resolve(String(file)) === path.resolve(canonicalPath)) {
        replaced = true;
        fs.renameSync(replacementPath, canonicalPath);
      }
      return mode === undefined
        ? originalOpenSync(file, flags)
        : originalOpenSync(file, flags, mode);
    });

    expect(() => readTraeBetaConfig({ configPath })).toThrow(/changed during security validation/i);
  });
});

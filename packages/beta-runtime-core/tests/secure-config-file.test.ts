import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inspectSecureConfigFile,
  readSecureConfigFile,
  repairSecureConfigFilePermissions,
  writeSecureConfigFile,
} from "../src/runtime/secure-config-file.js";

const tempRoots: string[] = [];

function makeFixture(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  const configDir = path.join(root, "config");
  const configPath = path.join(configDir, "config.json");
  return {
    root,
    configDir,
    configPath,
    policy: {
      label: "test config",
      privateDirectory: configDir,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("secure config file", () => {
  it("creates a missing private directory and owner-only file", () => {
    const fixture = makeFixture("secure-config-create-");

    writeSecureConfigFile(fixture.configPath, "first\n", fixture.policy);

    expect(readSecureConfigFile(fixture.configPath, fixture.policy)).toBe("first\n");
    expect(fs.statSync(fixture.configDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(fixture.configPath).mode & 0o777).toBe(0o600);
  });

  it("atomically replaces an existing config file", () => {
    const fixture = makeFixture("secure-config-replace-existing-");

    writeSecureConfigFile(fixture.configPath, "first\n", fixture.policy);
    writeSecureConfigFile(fixture.configPath, "second\n", fixture.policy);

    expect(readSecureConfigFile(fixture.configPath, fixture.policy)).toBe("second\n");
  });

  it("repairs legacy modes without changing file content", () => {
    const fixture = makeFixture("secure-config-repair-");
    fs.mkdirSync(fixture.configDir, { recursive: true, mode: 0o755 });
    fs.chmodSync(fixture.configDir, 0o755);
    fs.writeFileSync(fixture.configPath, "preserved\n", { mode: 0o644 });
    fs.chmodSync(fixture.configPath, 0o644);

    repairSecureConfigFilePermissions(fixture.configPath, fixture.policy);

    expect(fs.readFileSync(fixture.configPath, "utf8")).toBe("preserved\n");
    expect(fs.statSync(fixture.configDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(fixture.configPath).mode & 0o777).toBe(0o600);
  });

  it("reports an insecure existing directory even when the file is missing", () => {
    const fixture = makeFixture("secure-config-missing-file-");
    fs.mkdirSync(fixture.configDir, { recursive: true, mode: 0o777 });
    fs.chmodSync(fixture.configDir, 0o777);
    const policy = { label: "test config" };

    expect(inspectSecureConfigFile(fixture.configPath, policy)).toEqual(expect.objectContaining({
      ok: false,
      fileExists: false,
      message: expect.stringMatching(/directory.*writable/i),
    }));
  });

  it("rejects config file symbolic links without overwriting their target", () => {
    const fixture = makeFixture("secure-config-file-link-");
    fs.mkdirSync(fixture.configDir, { recursive: true, mode: 0o700 });
    const targetPath = path.join(fixture.root, "target.json");
    fs.writeFileSync(targetPath, "target\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, fixture.configPath);

    expect(() => writeSecureConfigFile(fixture.configPath, "replacement\n", fixture.policy))
      .toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("target\n");
  });

  it("rejects symbolic links in user-controlled directory paths", () => {
    const fixture = makeFixture("secure-config-dir-link-");
    const targetDir = path.join(fixture.root, "target", "config");
    const linkedParent = path.join(fixture.root, "linked-parent");
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(fixture.root, "target"), linkedParent, "dir");
    const configPath = path.join(linkedParent, "config", "config.json");
    fs.writeFileSync(path.join(targetDir, "config.json"), "target\n", { mode: 0o600 });

    expect(() => readSecureConfigFile(configPath, { label: "test config" }))
      .toThrow(/directory path contains a symbolic link/i);
  });

  it("rejects replaceable directory ancestors", () => {
    const fixture = makeFixture("secure-config-writable-ancestor-");
    const writableParent = path.join(fixture.root, "shared");
    const privateChild = path.join(writableParent, "private");
    const configPath = path.join(privateChild, "config", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(writableParent, 0o777);
    fs.writeFileSync(configPath, "secret\n", { mode: 0o600 });

    expect(() => readSecureConfigFile(configPath, { label: "test config" }))
      .toThrow(/directory ancestor is writable by another user/i);
  });

  it("rejects creating a config beneath a writable missing ancestor", () => {
    const fixture = makeFixture("secure-config-writable-missing-");
    const writableParent = path.join(fixture.root, "shared");
    const configPath = path.join(writableParent, "missing", "config.json");
    fs.mkdirSync(writableParent, { mode: 0o777 });
    fs.chmodSync(writableParent, 0o777);

    expect(() => writeSecureConfigFile(configPath, "secret\n", { label: "test config" }))
      .toThrow(/directory ancestor is writable by another user/i);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("rejects replacement between inspection and descriptor open", () => {
    const fixture = makeFixture("secure-config-replaced-");
    writeSecureConfigFile(fixture.configPath, "original\n", fixture.policy);
    const canonicalPath = path.join(fs.realpathSync.native(fixture.configDir), path.basename(fixture.configPath));
    const replacementPath = path.join(fixture.configDir, "replacement.json");
    fs.writeFileSync(replacementPath, "replacement\n", { mode: 0o600 });

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

    expect(() => readSecureConfigFile(fixture.configPath, fixture.policy))
      .toThrow(/changed during security validation/i);
  });
});

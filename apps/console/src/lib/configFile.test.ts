import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadConsoleConfigFile,
  saveConsoleConfigFile,
} from "../../config-file.mjs";

const tempRoots: string[] = [];

function makeFixture(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  const cwd = path.join(root, "project");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return {
    cwd,
    homeDir,
    homeConfigPath: path.join(homeDir, ".forgeflow-console.json"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("console config file permissions", () => {
  it("rejects whitespace tokens before writing config", () => {
    const fixture = makeFixture("forgeflow-console-config-invalid-token-");

    expect(() => saveConsoleConfigFile({ dispatcherToken: "   " }, fixture))
      .toThrow(/console config dispatcherToken.*non-empty/i);
  });

  it("writes owner-only config files", () => {
    const fixture = makeFixture("forgeflow-console-config-create-");

    saveConsoleConfigFile({ dispatcherToken: "test-dispatcher-token" }, fixture);

    expect(loadConsoleConfigFile(fixture).dispatcherToken).toBe("test-dispatcher-token");
    expect(fs.statSync(fixture.homeConfigPath).mode & 0o777).toBe(0o600);
  });

  it("creates a missing home config directory on first save", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-console-config-first-save-"));
    tempRoots.push(root);
    const options = {
      cwd: path.join(root, "project"),
      homeDir: path.join(root, "missing-home"),
    };
    fs.mkdirSync(options.cwd, { recursive: true });

    expect(loadConsoleConfigFile(options)).toEqual({});
    saveConsoleConfigFile({ dispatcherToken: "first-token" }, options);

    expect(loadConsoleConfigFile(options).dispatcherToken).toBe("first-token");
  });

  it("rejects config files readable by group or others", () => {
    const fixture = makeFixture("forgeflow-console-config-insecure-");
    fs.writeFileSync(fixture.homeConfigPath, JSON.stringify({ dispatcherToken: "exposed-token" }), { mode: 0o644 });
    fs.chmodSync(fixture.homeConfigPath, 0o644);

    expect(() => loadConsoleConfigFile(fixture)).toThrow(/insecure console config permissions/i);
  });

  it("repairs legacy permissions through the config CLI without dropping the token", () => {
    const fixture = makeFixture("forgeflow-console-config-cli-repair-");
    fs.writeFileSync(fixture.homeConfigPath, JSON.stringify({
      dispatcherToken: "preserved-token",
      dispatcherUrl: "http://127.0.0.1:8787",
    }), { mode: 0o644 });
    fs.chmodSync(fixture.homeConfigPath, 0o644);
    const scriptPath = path.resolve(process.cwd(), "scripts/config-cli.mjs");

    const result = spawnSync(process.execPath, [scriptPath, "--url", "http://127.0.0.1:9876"], {
      cwd: fixture.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fixture.homeDir,
      },
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(loadConsoleConfigFile(fixture)).toEqual({
      dispatcherToken: "preserved-token",
      dispatcherUrl: "http://127.0.0.1:9876",
    });
    expect(fs.statSync(fixture.homeConfigPath).mode & 0o777).toBe(0o600);
  });

  it("reads tokens from stdin and rejects argv tokens", () => {
    const fixture = makeFixture("forgeflow-console-config-stdin-");
    const scriptPath = path.resolve(process.cwd(), "scripts/config-cli.mjs");
    const env = {
      ...process.env,
      HOME: fixture.homeDir,
    };

    const stdinResult = spawnSync(process.execPath, [scriptPath, "--token-stdin"], {
      cwd: fixture.cwd,
      encoding: "utf8",
      env,
      input: "stdin-token\n",
    });
    const argvResult = spawnSync(process.execPath, [scriptPath, "--token", "argv-token"], {
      cwd: fixture.cwd,
      encoding: "utf8",
      env,
    });

    expect(stdinResult.status, stdinResult.stderr || stdinResult.stdout).toBe(0);
    expect(loadConsoleConfigFile(fixture).dispatcherToken).toBe("stdin-token");
    expect(argvResult.status).not.toBe(0);
    expect(`${argvResult.stdout}\n${argvResult.stderr}`).toMatch(/--token-stdin/);
    expect(loadConsoleConfigFile(fixture).dispatcherToken).toBe("stdin-token");
  });

  it("rejects symbolic-link configs without overwriting their target", () => {
    const fixture = makeFixture("forgeflow-console-config-symlink-");
    const targetPath = path.join(path.dirname(fixture.homeDir), "target.json");
    fs.writeFileSync(targetPath, "do-not-overwrite\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, fixture.homeConfigPath);

    expect(() => saveConsoleConfigFile({ dispatcherToken: "replacement-token" }, fixture)).toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("do-not-overwrite\n");
  });

  it("rejects config directories writable by group or others", () => {
    const fixture = makeFixture("forgeflow-console-config-writable-home-");
    fs.chmodSync(fixture.homeDir, 0o777);
    fs.writeFileSync(fixture.homeConfigPath, JSON.stringify({ dispatcherToken: "exposed-token" }), { mode: 0o600 });

    expect(() => loadConsoleConfigFile(fixture)).toThrow(/config directory.*writable/i);
  });

  it("rejects symbolic links in config directory paths", () => {
    const fixture = makeFixture("forgeflow-console-config-linked-dir-");
    const targetHome = path.join(path.dirname(fixture.homeDir), "target-home");
    const linkedHome = path.join(path.dirname(fixture.homeDir), "linked-home");
    fs.mkdirSync(targetHome, { mode: 0o700 });
    fs.symlinkSync(targetHome, linkedHome, "dir");
    fs.writeFileSync(
      path.join(targetHome, ".forgeflow-console.json"),
      JSON.stringify({ dispatcherToken: "exposed-token" }),
      { mode: 0o600 },
    );

    expect(() => loadConsoleConfigFile({ cwd: fixture.cwd, homeDir: linkedHome }))
      .toThrow(/directory path.*symbolic link/i);
  });

  it("rejects config replacement between inspection and file open", () => {
    const fixture = makeFixture("forgeflow-console-config-replaced-");
    saveConsoleConfigFile({ dispatcherToken: "original-token" }, fixture);
    const canonicalPath = path.join(fs.realpathSync.native(fixture.homeDir), path.basename(fixture.homeConfigPath));
    const replacementPath = path.join(fixture.homeDir, "replacement.json");
    fs.writeFileSync(replacementPath, JSON.stringify({ dispatcherToken: "replacement-token" }), { mode: 0o600 });

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

    expect(() => loadConsoleConfigFile(fixture)).toThrow(/changed during security validation/i);
  });
});

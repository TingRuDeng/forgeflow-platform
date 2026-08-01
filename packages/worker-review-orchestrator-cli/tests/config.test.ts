import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDispatcherToken, loadConfig, saveConfig } from "../src/config.js";
import { runCli } from "../src/cli.js";

const tempRoots: string[] = [];
const originalDispatcherApiToken = process.env.DISPATCHER_API_TOKEN;

function useTempHome(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  return {
    root,
    configPath: path.join(root, ".forgeflow-review-orchestrator.json"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalDispatcherApiToken === undefined) {
    delete process.env.DISPATCHER_API_TOKEN;
  } else {
    process.env.DISPATCHER_API_TOKEN = originalDispatcherApiToken;
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("worker review orchestrator config permissions", () => {
  it("rejects a whitespace environment token instead of falling back to config", () => {
    useTempHome("forgeflow-review-config-env-token-");
    saveConfig({ dispatcherToken: "config-token" });
    process.env.DISPATCHER_API_TOKEN = "   ";

    expect(() => getDispatcherToken()).toThrow(/DISPATCHER_API_TOKEN.*non-empty/i);
  });

  it("rejects whitespace tokens before writing config", () => {
    useTempHome("forgeflow-review-config-invalid-token-");

    expect(() => saveConfig({ dispatcherToken: "   " }))
      .toThrow(/review orchestrator config dispatcherToken.*non-empty/i);
  });

  it("writes owner-only config files", () => {
    const { configPath } = useTempHome("forgeflow-review-config-create-");

    saveConfig({
      dispatcherToken: "test-dispatcher-token",
      dispatcherUrl: "http://127.0.0.1:8787",
    });

    expect(loadConfig().dispatcherToken).toBe("test-dispatcher-token");
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("creates a missing home directory on first save", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-review-config-first-save-"));
    tempRoots.push(root);
    const missingHome = path.join(root, "missing-home");
    vi.spyOn(os, "homedir").mockReturnValue(missingHome);

    expect(loadConfig()).toEqual({});
    saveConfig({ dispatcherToken: "first-token" });

    expect(loadConfig().dispatcherToken).toBe("first-token");
  });

  it("rejects config files readable by group or others", () => {
    const { configPath } = useTempHome("forgeflow-review-config-insecure-");
    fs.writeFileSync(configPath, JSON.stringify({ dispatcherToken: "exposed-token" }), { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    expect(() => loadConfig()).toThrow(/insecure review orchestrator config permissions/i);
  });

  it("repairs legacy permissions during init without dropping the dispatcher token", async () => {
    const { configPath } = useTempHome("forgeflow-review-config-init-repair-");
    fs.writeFileSync(configPath, JSON.stringify({
      dispatcherToken: "preserved-token",
      dispatcherUrl: "http://127.0.0.1:8787",
    }), { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    await runCli(["init", "--url", "http://127.0.0.1:9876"], { log: vi.fn() });

    expect(loadConfig()).toEqual({
      dispatcherToken: "preserved-token",
      dispatcherUrl: "http://127.0.0.1:9876",
    });
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("reads init tokens from stdin and rejects argv tokens", async () => {
    useTempHome("forgeflow-review-config-stdin-");

    await runCli(["init", "--token-stdin"], {
      readStdin: vi.fn(() => "stdin-token\n"),
      log: vi.fn(),
    });

    expect(loadConfig().dispatcherToken).toBe("stdin-token");
    await expect(runCli(["init", "--token", "argv-token"], { log: vi.fn() }))
      .rejects.toThrow(/--token-stdin/);
  });

  it("rejects symbolic-link configs without overwriting their target", () => {
    const { configPath, root } = useTempHome("forgeflow-review-config-symlink-");
    const targetPath = path.join(root, "target.json");
    fs.writeFileSync(targetPath, "do-not-overwrite\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, configPath);

    expect(() => saveConfig({ dispatcherToken: "replacement-token" })).toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("do-not-overwrite\n");
  });

  it("rejects config directories writable by group or others", () => {
    const { configPath, root } = useTempHome("forgeflow-review-config-writable-home-");
    fs.chmodSync(root, 0o777);
    fs.writeFileSync(configPath, JSON.stringify({ dispatcherToken: "exposed-token" }), { mode: 0o600 });

    expect(() => loadConfig()).toThrow(/config directory.*writable/i);
  });

  it("rejects symbolic links in the home directory path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-review-config-linked-home-"));
    tempRoots.push(root);
    const targetHome = path.join(root, "target-home");
    const linkedHome = path.join(root, "linked-home");
    fs.mkdirSync(targetHome, { mode: 0o700 });
    fs.symlinkSync(targetHome, linkedHome, "dir");
    fs.writeFileSync(
      path.join(targetHome, ".forgeflow-review-orchestrator.json"),
      JSON.stringify({ dispatcherToken: "exposed-token" }),
      { mode: 0o600 },
    );
    vi.spyOn(os, "homedir").mockReturnValue(linkedHome);

    expect(() => loadConfig()).toThrow(/directory path.*symbolic link/i);
  });

  it("rejects config replacement between inspection and file open", () => {
    const { configPath, root } = useTempHome("forgeflow-review-config-replaced-");
    saveConfig({ dispatcherToken: "original-token" });
    const canonicalPath = path.join(fs.realpathSync.native(root), path.basename(configPath));
    const replacementPath = path.join(root, "replacement.json");
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

    expect(() => loadConfig()).toThrow(/changed during security validation/i);
  });
});

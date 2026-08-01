import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tmpRoots: string[] = [];

function withConfigPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-config-"));
  tmpRoots.push(root);
  process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = path.join(root, "config.json");
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("dispatcher runtime config", () => {
  it("creates default config and saves it", async () => {
    withConfigPath();
    const mod = await import("../src/config.ts");
    const config = mod.buildDefaultConfig();
    const configPath = mod.saveConfig(config);

    expect(fs.existsSync(configPath)).toBe(true);
    expect(mod.loadConfig().host).toBe("127.0.0.1");
    expect(mod.loadConfig().apiToken).toBeTruthy();
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("rejects config files readable by group or others", async () => {
    withConfigPath();
    const mod = await import("../src/config.ts");
    const configPath = mod.getConfigPath();
    fs.writeFileSync(configPath, `${JSON.stringify(mod.buildDefaultConfig())}\n`, { mode: 0o644 });
    fs.chmodSync(configPath, 0o644);

    expect(() => mod.loadConfig()).toThrow(/insecure dispatcher config permissions/i);
  });

  it("rejects symbolic-link configs without overwriting their target", async () => {
    const root = withConfigPath();
    const mod = await import("../src/config.ts");
    const configPath = mod.getConfigPath();
    const targetPath = path.join(root, "target.json");
    fs.writeFileSync(targetPath, "do-not-overwrite\n", { mode: 0o600 });
    fs.symlinkSync(targetPath, configPath);

    expect(() => mod.saveConfig(mod.buildDefaultConfig())).toThrow(/symbolic link/i);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("do-not-overwrite\n");
  });

  it("rejects custom config directories writable by group or others", async () => {
    const root = withConfigPath();
    fs.chmodSync(root, 0o777);
    const mod = await import("../src/config.ts");
    fs.writeFileSync(mod.getConfigPath(), `${JSON.stringify(mod.buildDefaultConfig())}\n`, { mode: 0o600 });

    expect(() => mod.loadConfig()).toThrow(/config directory.*writable/i);
  });

  it("rejects symbolic links in custom config directory paths", async () => {
    const root = withConfigPath();
    const targetDir = path.join(root, "target", "config");
    const linkPath = path.join(root, "linked-parent");
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(root, "target"), linkPath, "dir");
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = path.join(linkPath, "config", "config.json");
    const mod = await import("../src/config.ts");
    fs.writeFileSync(path.join(targetDir, "config.json"), `${JSON.stringify(mod.buildDefaultConfig())}\n`, { mode: 0o600 });

    expect(() => mod.loadConfig()).toThrow(/directory path.*symbolic link/i);
  });

  it("rejects config replacement between path inspection and file open", async () => {
    const root = withConfigPath();
    const mod = await import("../src/config.ts");
    const configPath = mod.getConfigPath();
    const canonicalPath = path.join(fs.realpathSync.native(root), path.basename(configPath));
    const replacementPath = path.join(root, "replacement.json");
    fs.writeFileSync(configPath, `${JSON.stringify(mod.buildDefaultConfig())}\n`, { mode: 0o600 });
    fs.writeFileSync(replacementPath, `${JSON.stringify({ ...mod.buildDefaultConfig(), apiToken: "replacement-token" })}\n`, { mode: 0o600 });

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

    expect(() => mod.loadConfig()).toThrow(/changed during security validation/i);
  });

  it("rejects malformed persisted API tokens", async () => {
    withConfigPath();
    const mod = await import("../src/config.ts");
    const configPath = mod.getConfigPath();
    fs.writeFileSync(configPath, `${JSON.stringify({ ...mod.buildDefaultConfig(), apiToken: " invalid " })}\n`, { mode: 0o600 });

    expect(() => mod.loadConfig()).toThrow(/apiToken must be a non-empty string/i);
    expect(() => mod.saveConfig({ ...mod.buildDefaultConfig(), apiToken: "" }))
      .toThrow(/apiToken must be a non-empty string/i);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const configModulePath = path.join(repoRoot, "apps/dispatcher/src/modules/server/dispatcher-config.ts");

const tempRoots: string[] = [];
const originalConfigPath = process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;
const originalApiToken = process.env.DISPATCHER_API_TOKEN;
const originalWorkerTokens = process.env.DISPATCHER_WORKER_TOKENS;

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-config-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalConfigPath === undefined) {
    delete process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
  } else {
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = originalConfigPath;
  }
  if (originalAuthMode === undefined) {
    delete process.env.DISPATCHER_AUTH_MODE;
  } else {
    process.env.DISPATCHER_AUTH_MODE = originalAuthMode;
  }
  if (originalWorkerTokens === undefined) {
    delete process.env.DISPATCHER_WORKER_TOKENS;
  } else {
    process.env.DISPATCHER_WORKER_TOKENS = originalWorkerTokens;
  }
  if (originalApiToken === undefined) {
    delete process.env.DISPATCHER_API_TOKEN;
  } else {
    process.env.DISPATCHER_API_TOKEN = originalApiToken;
  }
});

describe("dispatcher-config", () => {
  it("fails closed when dispatcher config JSON is malformed", async () => {
    const tempDir = makeTempDir();
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    fs.writeFileSync(configPath, "{ not-json\n");
    if (process.platform !== "win32") {
      fs.chmodSync(configPath, 0o600);
    }
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;

    const mod = await import(configModulePath);

    expect(() => mod.loadDispatcherConfig()).toThrow(/failed to parse dispatcher config/i);
  });

  it("rejects insecure dispatcher config file permissions on unix", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempDir = makeTempDir();
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    fs.writeFileSync(configPath, JSON.stringify({ authMode: "token", apiToken: "secret" }));
    fs.chmodSync(configPath, 0o644);
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;

    const mod = await import(configModulePath);

    expect(() => mod.loadDispatcherConfig()).toThrow(/insecure dispatcher config permissions/i);
  });

  it("rejects symbolic-link dispatcher config files", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempDir = makeTempDir();
    const targetPath = path.join(tempDir, "target.json");
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    fs.writeFileSync(targetPath, JSON.stringify({ authMode: "token", apiToken: "secret" }), { mode: 0o600 });
    fs.symlinkSync(targetPath, configPath);
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;

    const mod = await import(configModulePath);

    expect(() => mod.loadDispatcherConfig()).toThrow(/symbolic link/i);
  });

  it("rejects dispatcher config directories writable by group or others", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempDir = makeTempDir();
    fs.chmodSync(tempDir, 0o777);
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    fs.writeFileSync(configPath, JSON.stringify({ authMode: "token", apiToken: "secret" }), { mode: 0o600 });
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;

    const mod = await import(configModulePath);

    expect(() => mod.loadDispatcherConfig()).toThrow(/config directory.*writable/i);
  });

  it("rejects symbolic links in dispatcher config directory paths", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempDir = makeTempDir();
    const targetDir = path.join(tempDir, "target", "config");
    const linkedParent = path.join(tempDir, "linked-parent");
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(tempDir, "target"), linkedParent, "dir");
    const configPath = path.join(linkedParent, "config", ".forgeflow-dispatcher.json");
    fs.writeFileSync(
      path.join(targetDir, ".forgeflow-dispatcher.json"),
      JSON.stringify({ authMode: "token", apiToken: "secret" }),
      { mode: 0o600 },
    );
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;

    const mod = await import(configModulePath);

    expect(() => mod.loadDispatcherConfig()).toThrow(/directory path.*symbolic link/i);
  });

  it("rejects dispatcher config replacement between inspection and file open", async () => {
    const tempDir = makeTempDir();
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    const canonicalPath = path.join(fs.realpathSync.native(tempDir), path.basename(configPath));
    const replacementPath = path.join(tempDir, "replacement.json");
    fs.writeFileSync(configPath, JSON.stringify({ authMode: "token", apiToken: "original" }), { mode: 0o600 });
    fs.writeFileSync(replacementPath, JSON.stringify({ authMode: "token", apiToken: "replacement" }), { mode: 0o600 });
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;
    const mod = await import(configModulePath);

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

    expect(() => mod.loadDispatcherConfig()).toThrow(/changed during security validation/i);
  });

  it("rejects invalid auth mode values instead of silently accepting them", async () => {
    const tempDir = makeTempDir();
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    fs.writeFileSync(configPath, JSON.stringify({ authMode: "token", apiToken: "secret" }));
    if (process.platform !== "win32") {
      fs.chmodSync(configPath, 0o600);
    }
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;
    process.env.DISPATCHER_AUTH_MODE = "invalid-mode";

    const mod = await import(configModulePath);

    expect(() => mod.getDispatcherAuthMode()).toThrow(/invalid DISPATCHER_AUTH_MODE/i);
  });

  it("rejects invalid dispatcher API tokens from config or environment", async () => {
    const tempDir = makeTempDir();
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    fs.writeFileSync(configPath, JSON.stringify({ authMode: "token", apiToken: 42 }), { mode: 0o600 });
    process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = configPath;
    const mod = await import(configModulePath);

    expect(() => mod.getDispatcherApiToken()).toThrow(/config apiToken must be a non-empty string/i);

    fs.writeFileSync(configPath, JSON.stringify({ authMode: "token", apiToken: "valid-token" }), { mode: 0o600 });
    process.env.DISPATCHER_API_TOKEN = " token-with-spaces ";
    expect(() => mod.getDispatcherApiToken()).toThrow(/DISPATCHER_API_TOKEN must be a non-empty string/i);

    process.env.DISPATCHER_API_TOKEN = "";
    expect(() => mod.getDispatcherApiToken()).toThrow(/DISPATCHER_API_TOKEN must be a non-empty string/i);
  });

  it("loads validated worker-scoped tokens from the environment", async () => {
    process.env.DISPATCHER_WORKER_TOKENS = JSON.stringify({
      "worker-a": "worker-a-token",
      "worker-b": "worker-b-token",
    });
    const mod = await import(configModulePath);

    expect(mod.getDispatcherWorkerTokens()).toEqual({
      "worker-a": "worker-a-token",
      "worker-b": "worker-b-token",
    });
  });

  it("rejects malformed or ambiguous worker token mappings", async () => {
    const mod = await import(configModulePath);

    process.env.DISPATCHER_WORKER_TOKENS = "{broken";
    expect(() => mod.getDispatcherWorkerTokens()).toThrow(/failed to parse DISPATCHER_WORKER_TOKENS/i);

    process.env.DISPATCHER_WORKER_TOKENS = JSON.stringify({
      "worker-a": "shared-token",
      "worker-b": "shared-token",
    });
    expect(() => mod.getDispatcherWorkerTokens()).toThrow(/unique token/i);

    process.env.DISPATCHER_WORKER_TOKENS = JSON.stringify({
      "worker-a": " token-with-spaces ",
    });
    expect(() => mod.getDispatcherWorkerTokens()).toThrow(/invalid token/i);

    process.env.DISPATCHER_API_TOKEN = "control-plane-token";
    process.env.DISPATCHER_WORKER_TOKENS = JSON.stringify({
      "worker-a": "control-plane-token",
    });
    expect(() => mod.getDispatcherWorkerTokens()).toThrow(/must differ from DISPATCHER_API_TOKEN/i);
  });
});

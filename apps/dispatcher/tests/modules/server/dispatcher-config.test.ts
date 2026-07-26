import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

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

  it("writes dispatcher CLI config with private permissions", () => {
    const tempDir = makeTempDir();
    const configPath = path.join(tempDir, ".forgeflow-dispatcher.json");
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "apps/dispatcher/scripts/config-cli.mjs"),
      "--mode",
      "token",
      "--token",
      "secret",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        FORGEFLOW_DISPATCHER_CONFIG_PATH: configPath,
      },
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(configPath)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    }
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

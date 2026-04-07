import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const configModulePath = path.join(repoRoot, "apps/dispatcher/src/modules/server/dispatcher-config.ts");

const tempRoots: string[] = [];
const originalConfigPath = process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH;
const originalAuthMode = process.env.DISPATCHER_AUTH_MODE;

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
});

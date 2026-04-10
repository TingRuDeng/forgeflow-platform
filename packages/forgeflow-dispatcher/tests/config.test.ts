import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tmpRoots: string[] = [];

function withConfigPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-config-"));
  tmpRoots.push(root);
  process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH = path.join(root, "config.json");
  return root;
}

afterEach(() => {
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
  });
});

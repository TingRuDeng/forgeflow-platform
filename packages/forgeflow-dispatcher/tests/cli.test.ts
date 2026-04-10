import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tmpRoots: string[] = [];

function withConfigPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-cli-"));
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

describe("dispatcher runtime cli", () => {
  it("saves config through init", async () => {
    const root = withConfigPath();
    const mod = await import("../src/cli.ts");

    await mod.runCli([
      "init",
      "--host",
      "0.0.0.0",
      "--port",
      "8899",
      "--state-dir",
      path.join(root, "state"),
      "--auth-mode",
      "open",
    ]);

    const saved = JSON.parse(fs.readFileSync(process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH!, "utf8"));
    expect(saved.host).toBe("0.0.0.0");
    expect(saved.port).toBe(8899);
    expect(saved.authMode).toBe("open");
  });
});

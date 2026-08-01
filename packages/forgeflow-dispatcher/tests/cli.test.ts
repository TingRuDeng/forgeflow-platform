import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tmpRoots: string[] = [];

function withConfigPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatcher-cli-"));
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

  it("reads tokens from stdin and never accepts them through argv", async () => {
    withConfigPath();
    const mod = await import("../src/cli.ts");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await mod.runCli(["init", "--auth-mode", "token", "--token-stdin"], {
      readStdin: () => "stdin-token\n",
    });

    const saved = JSON.parse(fs.readFileSync(process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH!, "utf8"));
    expect(saved.apiToken).toBe("stdin-token");
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("stdin-token"));
    await expect(mod.runCli(["init", "--token", "argv-token"]))
      .rejects.toThrow(/--token-stdin/);
  });

  it("repairs a legacy config mode during init before loading it", async () => {
    withConfigPath();
    const configPath = process.env.FORGEFLOW_DISPATCHER_CONFIG_PATH!;
    fs.writeFileSync(configPath, JSON.stringify({
      host: "127.0.0.1",
      port: 8787,
      stateDir: "/tmp/state",
      persistenceBackend: "sqlite",
      authMode: "token",
      apiToken: "preserved-token",
    }), { mode: 0o644 });
    if (process.platform !== "win32") {
      fs.chmodSync(configPath, 0o644);
    }
    const mod = await import("../src/cli.ts");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await mod.runCli(["init"]);

    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.apiToken).toBe("preserved-token");
    if (process.platform !== "win32") {
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    }
  });
});

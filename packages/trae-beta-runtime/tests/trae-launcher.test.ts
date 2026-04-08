import { describe, expect, it, vi } from "vitest";

import { launchTraeForAutomation } from "../src/runtime/trae-launcher.js";

describe("trae-launcher", () => {
  it("attempts to quit an existing macOS Trae app before a clean relaunch", async () => {
    const spawnImpl = vi.fn(() => ({
      unref() {},
      once() {},
    }));
    const quitExistingApp = vi.fn(async () => undefined);
    const discoverTarget = vi.fn(async () => ({
      target: { id: "target-1", title: "project", url: "http://localhost" },
      version: { Browser: "Trae" },
    }));
    const fsImpl = {
      existsSync(path: string) {
        return path === "/Applications/Trae CN.app"
          || path === "/Applications/Trae CN.app/Contents/MacOS/Trae CN"
          || path === "/tmp/project";
      },
      readdirSync() {
        return [];
      },
      statSync() {
        return { isFile: () => true };
      },
    };

    await launchTraeForAutomation({
      traeBin: "/Applications/Trae CN.app",
      projectPath: "/tmp/project",
      remoteDebuggingPort: 9333,
      forceCleanLaunch: true,
      platform: "darwin",
      spawnImpl,
      quitExistingApp,
      discoverTarget,
      getVersion: vi.fn(),
      sleepImpl: vi.fn(async () => undefined),
      fsImpl,
    });

    expect(quitExistingApp).toHaveBeenCalledWith(expect.objectContaining({
      appName: "Trae CN",
      bundlePath: "/Applications/Trae CN.app",
      platform: "darwin",
    }));
    expect(spawnImpl).toHaveBeenCalledWith(
      "/Applications/Trae CN.app/Contents/MacOS/Trae CN",
      expect.arrayContaining(["--remote-debugging-port=9333", "/tmp/project"]),
      expect.any(Object),
    );
  });
});

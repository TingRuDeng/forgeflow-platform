import { describe, expect, it, vi } from "vitest";

import {
  launchTraeForAutomation,
  waitForTraeDebugger,
} from "../src/trae-launcher.js";

describe("Trae launcher orchestration", () => {
  it("reuses an existing debugger target instead of spawning a new process", async () => {
    const spawnImpl = vi.fn();
    const discoverTarget = vi.fn(async () => ({
      target: { id: "target-existing", title: "project", url: "https://trae.ai/chat" },
      version: { Browser: "Trae/1.0" },
    }));

    const result = await launchTraeForAutomation({
      discoverTarget,
      fsImpl: createFsStub(["/repo"]),
      platform: "linux",
      projectPath: "/repo",
      remoteDebuggingPort: 9555,
      spawnImpl,
      traeBin: "/usr/local/bin/trae",
    });

    expect(spawnImpl).not.toHaveBeenCalled();
    expect(result.reusedExisting).toBe(true);
    expect(result.debuggerInfo.target?.id).toBe("target-existing");
  });

  it("spawns Trae and waits for the debugger target", async () => {
    const spawnImpl = vi.fn(() => ({
      once: vi.fn(),
      unref: vi.fn(),
    }));
    const discoverTarget = vi.fn()
      .mockRejectedValueOnce(new Error("no reusable target"))
      .mockResolvedValueOnce({
        target: { id: "target-new", title: "repo", url: "https://trae.ai/chat" },
        version: { Browser: "Trae/1.0" },
      });

    const result = await launchTraeForAutomation({
      discoverTarget,
      fsImpl: createFsStub(["/repo"]),
      platform: "linux",
      preferExisting: false,
      projectPath: "/repo",
      remoteDebuggingPort: 9555,
      spawnImpl,
      traeBin: "/usr/local/bin/trae",
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "/usr/local/bin/trae",
      expect.arrayContaining(["--remote-debugging-port=9555", "/repo"]),
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(result.reusedExisting).toBe(false);
    expect(result.debuggerInfo.target?.id).toBe("target-new");
  });

  it("surfaces spawn errors as launch failures", async () => {
    const spawnError = new Error("spawn Trae ENOENT");
    const spawnImpl = vi.fn(() => ({
      once: vi.fn((eventName: string, handler: (error: Error) => void) => {
        if (eventName === "error") {
          queueMicrotask(() => handler(spawnError));
        }
      }),
      unref: vi.fn(),
    }));

    await expect(launchTraeForAutomation({
      discoverTarget: vi.fn(async () => {
        throw new Error("debugger unavailable");
      }),
      fsImpl: createFsStub(["/repo"]),
      platform: "linux",
      preferExisting: false,
      projectPath: "/repo",
      remoteDebuggingPort: 9555,
      spawnImpl,
      traeBin: "/usr/local/bin/trae",
    })).rejects.toThrow("Failed to launch Trae: spawn Trae ENOENT");
  });

  it("waits for clean relaunch drain before spawning on macOS", async () => {
    const spawnImpl = vi.fn(() => ({
      once: vi.fn(),
      unref: vi.fn(),
    }));
    const getVersion = vi.fn()
      .mockResolvedValueOnce({ Browser: "Trae/1.0" })
      .mockRejectedValueOnce(new Error("drained"));
    const quitExistingApp = vi.fn(async () => true);
    const sleepImpl = vi.fn(async () => undefined);
    const discoverTarget = vi.fn(async () => ({
      target: { id: "target-clean", title: "repo", url: "https://trae.ai/chat" },
      version: { Browser: "Trae/1.0" },
    }));

    await launchTraeForAutomation({
      discoverTarget,
      forceCleanLaunch: true,
      fsImpl: createFsStub([
        "/Applications/Trae CN.app",
        "/Applications/Trae CN.app/Contents/MacOS/Trae CN",
        "/repo",
      ]),
      getVersion,
      platform: "darwin",
      projectPath: "/repo",
      quitExistingApp,
      remoteDebuggingPort: 9333,
      sleepImpl,
      spawnImpl,
      traeBin: "/Applications/Trae CN.app",
    });

    expect(quitExistingApp).toHaveBeenCalledWith(expect.objectContaining({
      appName: "Trae CN",
      bundlePath: "/Applications/Trae CN.app",
      platform: "darwin",
    }));
    expect(getVersion.mock.invocationCallOrder[0]).toBeLessThan(spawnImpl.mock.invocationCallOrder[0]);
    expect(sleepImpl).toHaveBeenCalled();
  });

  it("supports version-only debugger readiness checks", async () => {
    const result = await waitForTraeDebugger({
      getVersion: vi.fn(async () => ({ Browser: "Trae/1.0" })),
      port: 9555,
      waitForTarget: false,
    });

    expect(result).toEqual({
      target: null,
      version: { Browser: "Trae/1.0" },
    });
  });
});

function createFsStub(existingPaths: string[]) {
  const existing = new Set(existingPaths);
  return {
    existsSync: vi.fn((input: string) => existing.has(input)),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isFile: () => true })),
  };
}

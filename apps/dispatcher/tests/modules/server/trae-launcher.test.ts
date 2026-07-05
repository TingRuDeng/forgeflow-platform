import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const launcherModulePath = path.join(repoRoot, "scripts/lib/trae-launcher.js");

describe("trae launcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a launch command with remote debugging port and project path", async () => {
    const mod = await import(launcherModulePath);
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-trae-project-"));

    try {
      const target = mod.resolveTraeLaunchTarget({
        traeBin: "/Applications/Trae.app",
        projectPath,
        remoteDebuggingPort: 9555,
        fsImpl: {
          existsSync: (input: string) => input === projectPath,
          readdirSync: () => [],
          statSync: () => ({ isFile: () => false }),
        },
        platform: "linux",
      });

      expect(target.command).toBe("/Applications/Trae.app");
      expect(target.args).toContain(`--remote-debugging-port=9555`);
      expect(target.args).toContain(projectPath);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("launches trae and waits for the debugger target", async () => {
    const mod = await import(launcherModulePath);
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-trae-project-"));
    const spawnImpl = vi.fn(() => ({
      pid: 12345,
      unref: vi.fn(),
      once: vi.fn(),
    }));

    try {
      const result = await mod.launchTraeForAutomation({
        traeBin: "/Applications/Trae.app",
        projectPath,
        remoteDebuggingPort: 9555,
        preferExisting: false,
        spawnImpl,
        fsImpl: {
          existsSync: (input: string) => input === projectPath,
          readdirSync: () => [],
          statSync: () => ({ isFile: () => false }),
        },
        platform: "linux",
        discoverTarget: vi.fn(async () => ({
          version: { Browser: "Trae/1.0" },
          target: { id: "target-1", title: "openclaw-multi-agent-mvp", url: "https://trae.ai/chat" },
        })),
      });

      expect(spawnImpl).toHaveBeenCalledWith(
        "/Applications/Trae.app",
        expect.arrayContaining([`--remote-debugging-port=9555`, projectPath]),
        expect.objectContaining({ detached: true, stdio: "ignore" })
      );
      expect(result.debuggerInfo.target.id).toBe("target-1");
      expect(result.reusedExisting).toBe(false);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("reuses an existing trae debugger target instead of spawning a new process", async () => {
    const mod = await import(launcherModulePath);
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-trae-project-"));
    const spawnImpl = vi.fn();
    const discoverTarget = vi.fn(async () => ({
      version: { Browser: "Trae/1.0" },
      target: { id: "target-existing", title: path.basename(projectPath), url: "https://trae.ai/chat" },
    }));

    try {
      const result = await mod.launchTraeForAutomation({
        traeBin: "/Applications/Trae.app",
        projectPath,
        remoteDebuggingPort: 9555,
        spawnImpl,
        fsImpl: {
          existsSync: (input: string) => input === projectPath,
          readdirSync: () => [],
          statSync: () => ({ isFile: () => false }),
        },
        platform: "linux",
        discoverTarget,
      });

      expect(spawnImpl).not.toHaveBeenCalled();
      expect(result.debuggerInfo.target.id).toBe("target-existing");
      expect(result.reusedExisting).toBe(true);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("surfaces spawn errors as launch failures instead of crashing", async () => {
    const mod = await import(launcherModulePath);
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-trae-project-"));
    const spawnError = Object.assign(new Error("spawn /Applications/Trae.app ENOENT"), { code: "ENOENT" });
    const once = vi.fn((eventName: string, handler: (error: Error) => void) => {
      if (eventName === "error") {
        queueMicrotask(() => handler(spawnError));
      }
    });
    const spawnImpl = vi.fn(() => ({
      pid: undefined,
      unref: vi.fn(),
      once,
    }));

    try {
      await expect(mod.launchTraeForAutomation({
        traeBin: "/Applications/Trae.app",
        projectPath,
        remoteDebuggingPort: 9555,
        spawnImpl,
        fsImpl: {
          existsSync: (input: string) => input === projectPath,
          readdirSync: () => [],
          statSync: () => ({ isFile: () => false }),
        },
        platform: "linux",
        discoverTarget: vi.fn(async () => {
          throw new Error("should not reach debugger discovery");
        }),
      })).rejects.toThrow("Failed to launch Trae: spawn /Applications/Trae.app ENOENT");
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("attempts to quit an existing macOS Trae app before a clean relaunch", async () => {
    const mod = await import(launcherModulePath);
    const spawnImpl = vi.fn(() => ({
      pid: 12345,
      unref: vi.fn(),
      once: vi.fn(),
    }));
    const quitExistingApp = vi.fn(async () => undefined);
    const discoverTarget = vi.fn(async () => ({
      version: { Browser: "Trae/1.0" },
      target: { id: "target-clean", title: "project", url: "https://trae.ai/chat" },
    }));
    const getVersion = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const fsImpl = {
      existsSync(input: string) {
        return input === "/Applications/Trae CN.app"
          || input === "/Applications/Trae CN.app/Contents/MacOS/Trae CN"
          || input === "/tmp/project";
      },
      readdirSync: () => [],
      statSync: () => ({ isFile: () => true }),
    };

    await mod.launchTraeForAutomation({
      traeBin: "/Applications/Trae CN.app",
      projectPath: "/tmp/project",
      remoteDebuggingPort: 9333,
      forceCleanLaunch: true,
      platform: "darwin",
      spawnImpl,
      quitExistingApp,
      discoverTarget,
      getVersion,
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

  it("waits for the previous debugger port to disappear before clean relaunch spawn", async () => {
    const mod = await import(launcherModulePath);
    const spawnImpl = vi.fn(() => ({
      pid: 12345,
      unref: vi.fn(),
      once: vi.fn(),
    }));
    const quitExistingApp = vi.fn(async () => undefined);
    const getVersion = vi.fn()
      .mockResolvedValueOnce({ Browser: "Trae/1.0" })
      .mockRejectedValueOnce(new Error("fetch failed"));
    const discoverTarget = vi.fn(async () => ({
      version: { Browser: "Trae/1.0" },
      target: { id: "target-clean", title: "project", url: "https://trae.ai/chat" },
    }));
    const sleepImpl = vi.fn(async () => undefined);
    const fsImpl = {
      existsSync(input: string) {
        return input === "/Applications/Trae CN.app"
          || input === "/Applications/Trae CN.app/Contents/MacOS/Trae CN"
          || input === "/tmp/project";
      },
      readdirSync: () => [],
      statSync: () => ({ isFile: () => true }),
    };

    await mod.launchTraeForAutomation({
      traeBin: "/Applications/Trae CN.app",
      projectPath: "/tmp/project",
      remoteDebuggingPort: 9333,
      forceCleanLaunch: true,
      platform: "darwin",
      spawnImpl,
      quitExistingApp,
      discoverTarget,
      getVersion,
      sleepImpl,
      fsImpl,
    });

    expect(getVersion).toHaveBeenCalledTimes(2);
    expect(getVersion.mock.invocationCallOrder[0]).toBeLessThan(spawnImpl.mock.invocationCallOrder[0]);
    expect(sleepImpl).toHaveBeenCalled();
  });
});

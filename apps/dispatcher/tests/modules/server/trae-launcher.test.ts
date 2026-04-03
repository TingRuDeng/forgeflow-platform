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
});

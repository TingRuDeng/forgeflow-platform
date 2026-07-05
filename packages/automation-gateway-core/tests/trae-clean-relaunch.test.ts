import { execFile } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  prepareCleanRelaunch,
  quitExistingMacApp,
  resolveMacAppName,
  waitForDebuggerPortToDrain,
} from "../src/trae-clean-relaunch.js";

describe("Trae clean relaunch helpers", () => {
  it("resolves a macOS app name from a bundle path", () => {
    expect(resolveMacAppName("/Applications/Trae CN.app", { platform: "darwin" })).toBe("Trae CN");
    expect(resolveMacAppName("/usr/local/bin/trae", { platform: "darwin" })).toBeNull();
    expect(resolveMacAppName("/Applications/Trae CN.app", { platform: "linux" })).toBeNull();
  });

  it("quits an existing app and waits after osascript returns", async () => {
    const execFileImpl = vi.fn((command, args, callback) => {
      callback(null);
    }) as unknown as typeof execFile;
    const sleepImpl = vi.fn(async () => undefined);

    await expect(quitExistingMacApp({
      appName: "Trae CN",
      execFileImpl,
      postQuitDelayMs: 25,
      sleepImpl,
    })).resolves.toBe(true);

    expect(execFileImpl).toHaveBeenCalledWith(
      "osascript",
      ["-e", "tell application \"Trae CN\" to quit"],
      expect.any(Function),
    );
    expect(sleepImpl).toHaveBeenCalledWith(25);
  });

  it("waits until the previous debugger port is unavailable", async () => {
    const getVersion = vi.fn()
      .mockResolvedValueOnce({ Browser: "Trae/1.0" })
      .mockRejectedValueOnce(new Error("fetch failed"));
    const sleepImpl = vi.fn(async () => undefined);

    await expect(waitForDebuggerPortToDrain({
      getVersion,
      sleepImpl,
      port: 9333,
    })).resolves.toBeUndefined();

    expect(getVersion).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalled();
  });

  it("prepares a macOS clean relaunch through the shared quit and drain sequence", async () => {
    const quitExistingApp = vi.fn(async () => true);
    const getVersion = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(prepareCleanRelaunch({
      bundlePath: "/Applications/Trae CN.app",
      platform: "darwin",
      port: 9333,
      getVersion,
      quitExistingApp,
    })).resolves.toBe(true);

    expect(quitExistingApp).toHaveBeenCalledWith(expect.objectContaining({
      appName: "Trae CN",
      bundlePath: "/Applications/Trae CN.app",
      platform: "darwin",
    }));
    expect(getVersion).toHaveBeenCalledWith({ port: 9333 });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const openSyncMock = vi.fn(() => 41);

vi.mock("node:fs", () => ({
  default: {
    openSync: openSyncMock,
  },
}));

const spawnMock = vi.fn((_command: string, _args: string[]) => {
  const listeners = new Map<string, Array<(error?: Error) => void>>();
  return {
    pid: 1234,
    once(event: string, handler: (error?: Error) => void) {
      const bucket = listeners.get(event) || [];
      bucket.push(handler);
      listeners.set(event, bucket);
      return this;
    },
    off(event: string, handler: (error?: Error) => void) {
      const bucket = listeners.get(event) || [];
      listeners.set(event, bucket.filter((item) => item !== handler));
      return this;
    },
    unref() {},
  };
});

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("@tingrudeng/trae-beta-runtime startLaunch", () => {
  afterEach(() => {
    delete process.env.FORGEFLOW_TRAE_BIN;
    delete process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT;
    delete process.env.FORGEFLOW_REPO_DIR;
    delete process.env.TRAE_BIN;
    delete process.env.TRAE_PROJECT_PATH;
    delete process.env.TRAE_REMOTE_DEBUGGING_PORT;
    spawnMock.mockClear();
  });

  it("accepts FORGEFLOW_* environment variables for launch defaults", async () => {
    process.env.FORGEFLOW_TRAE_BIN = "/Applications/Trae CN.app";
    process.env.TRAE_PROJECT_PATH = "/tmp/project";
    process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT = "9333";

    const { startLaunch } = await import("../src/start-launch.js");
    const result = startLaunch();
    await result.ready;

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining("runtime/run-trae-automation-launch.js"),
        "--trae-bin",
        "/Applications/Trae CN.app",
        "--project-path",
        "/tmp/project",
        "--remote-debugging-port",
        "9333",
      ],
      expect.objectContaining({
        cwd: expect.stringContaining("packages/trae-beta-runtime/src"),
      }),
    );
  });

  it("uses file descriptors for detached launch logging", async () => {
    process.env.FORGEFLOW_TRAE_BIN = "/Applications/Trae CN.app";
    process.env.TRAE_PROJECT_PATH = "/tmp/project";

    const { startLaunch } = await import("../src/start-launch.js");
    const result = startLaunch({
      detached: true,
      logFile: "/tmp/launch.log",
    });
    await result.ready;

    expect(openSyncMock).toHaveBeenCalledWith("/tmp/launch.log", "a");
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        stdio: ["ignore", 41, 41],
        detached: true,
      }),
    );
  });
});

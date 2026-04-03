import { afterEach, describe, expect, it, vi } from "vitest";

const openSyncMock = vi.fn(() => 42);

vi.mock("node:fs", () => ({
  default: {
    openSync: openSyncMock,
  },
}));

const spawnMock = vi.fn((_command: string, _args: string[]) => {
  const listeners = new Map<string, Array<(error?: Error) => void>>();
  return {
    pid: 4321,
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

const listManagedProcessesMock = vi.fn();

vi.mock("../src/process-control.js", () => ({
  listManagedProcesses: listManagedProcessesMock,
}));

describe("@tingrudeng/trae-beta-runtime startGateway", () => {
  afterEach(() => {
    delete process.env.FORGEFLOW_ROOT_DIR;
    delete process.env.FORGEFLOW_AUTOMATION_HOST;
    delete process.env.FORGEFLOW_AUTOMATION_PORT;
    spawnMock.mockClear();
    listManagedProcessesMock.mockReset();
  });

  it("reuses an existing managed gateway process by default", async () => {
    listManagedProcessesMock.mockReturnValue({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: true,
      matches: [
        {
          pid: 3001,
          command: "/usr/local/bin/node /tmp/forgeflow/packages/trae-beta-runtime/src/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
        },
      ],
    });

    const { startGateway } = await import("../src/start-gateway.js");
    const result = startGateway();
    await result.ready;

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.child.pid).toBe(3001);
    expect(result.command).toBe(process.execPath);
    expect(result.args).toEqual([
      expect.stringContaining("runtime/run-trae-automation-gateway.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "8790",
    ]);
  });

  it("spawns a new gateway when force is enabled", async () => {
    listManagedProcessesMock.mockReturnValue({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: true,
      matches: [
        {
          pid: 3001,
          command: "/usr/local/bin/node /tmp/forgeflow/packages/trae-beta-runtime/src/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
        },
      ],
    });

    const { startGateway } = await import("../src/start-gateway.js");
    const result = startGateway({ force: true });
    await result.ready;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(result.child.pid).toBe(4321);
  });

  it("rejects reusing a gateway process when host or port does not match", async () => {
    listManagedProcessesMock.mockReturnValue({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: true,
      matches: [
        {
          pid: 3001,
          command: "/usr/local/bin/node /tmp/forgeflow/packages/trae-beta-runtime/src/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
        },
      ],
    });

    const { startGateway } = await import("../src/start-gateway.js");

    expect(() => startGateway({ host: "0.0.0.0", port: 9911 })).toThrow(
      /existing managed gateway does not match requested host\/port\/debug settings/i,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("uses file descriptors for detached gateway logging", async () => {
    listManagedProcessesMock.mockReturnValue({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: false,
      matches: [],
    });

    const { startGateway } = await import("../src/start-gateway.js");
    const result = startGateway({
      detached: true,
      logFile: "/tmp/gateway.log",
      force: true,
    });
    await result.ready;

    expect(openSyncMock).toHaveBeenCalledWith("/tmp/gateway.log", "a");
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        stdio: ["ignore", 42, 42],
        detached: true,
      }),
    );
  });

  it("passes --debug to gateway runtime when requested", async () => {
    listManagedProcessesMock.mockReturnValue({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: false,
      matches: [],
    });

    const { startGateway } = await import("../src/start-gateway.js");
    const result = startGateway({
      debug: true,
      force: true,
    });
    await result.ready;

    expect(result.args).toContain("--debug");
  });
});

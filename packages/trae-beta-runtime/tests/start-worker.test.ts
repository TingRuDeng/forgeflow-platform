import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    openSync: vi.fn(() => 43),
  },
}));

const spawnMock = vi.fn((_command: string, _args: string[]) => {
  const listeners = new Map<string, Array<(error?: Error) => void>>();
  return {
    pid: 5678,
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

describe("@tingrudeng/trae-beta-runtime startWorker", () => {
  const packageRuntimeScriptPath = path.join(process.cwd(), "dist/runtime/worker.js");
  const packageRootDir = process.cwd();

  afterEach(() => {
    delete process.env.FORGEFLOW_REPO_DIR;
    delete process.env.FORGEFLOW_DISPATCHER_URL;
    delete process.env.FORGEFLOW_AUTOMATION_URL;
    delete process.env.FORGEFLOW_WORKER_ID;
    delete process.env.FORGEFLOW_TRAE_BIN;
    delete process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT;
    spawnMock.mockClear();
    listManagedProcessesMock.mockReset();
  });

  it("reuses an existing managed worker process by default", async () => {
    process.env.FORGEFLOW_REPO_DIR = "/tmp/project";
    process.env.FORGEFLOW_DISPATCHER_URL = "http://127.0.0.1:8787";
    process.env.FORGEFLOW_AUTOMATION_URL = "http://127.0.0.1:8790";
    process.env.FORGEFLOW_WORKER_ID = "trae-remote";
    process.env.FORGEFLOW_TRAE_BIN = "/Applications/Trae CN.app";
    process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT = "9222";
    listManagedProcessesMock.mockReturnValue({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: true,
      matches: [
        {
          pid: 4001,
          command: `/usr/local/bin/node ${packageRuntimeScriptPath} --repo-dir /tmp/project --dispatcher-url http://127.0.0.1:8787 --automation-url http://127.0.0.1:8790 --worker-id trae-remote --trae-bin /Applications/Trae CN.app --remote-debugging-port 9222`,
        },
      ],
    });

    const { startWorker } = await import("../src/start-worker.js");
    const result = startWorker();
    await result.ready;

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.child.pid).toBe(4001);
    expect(result.command).toBe(process.execPath);
    expect(result.cwd).toBe(packageRootDir);
    expect(result.args).toEqual([
      packageRuntimeScriptPath,
      "--repo-dir",
      "/tmp/project",
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--automation-url",
      "http://127.0.0.1:8790",
      "--worker-id",
      "trae-remote",
      "--trae-bin",
      "/Applications/Trae CN.app",
      "--remote-debugging-port",
      "9222",
    ]);
  });

  it("spawns a new worker when force is enabled", async () => {
    process.env.FORGEFLOW_REPO_DIR = "/tmp/project";
    listManagedProcessesMock.mockReturnValue({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: true,
      matches: [
        {
          pid: 4001,
          command: `/usr/local/bin/node ${packageRuntimeScriptPath} --repo-dir /tmp/project --dispatcher-url http://127.0.0.1:8787 --automation-url http://127.0.0.1:8790 --worker-id trae-remote`,
        },
      ],
    });

    const { startWorker } = await import("../src/start-worker.js");
    const result = startWorker({
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
      force: true,
    });
    await result.ready;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(result.child.pid).toBe(5678);
  });

  it("rejects reusing a worker process when runtime arguments do not match", async () => {
    process.env.FORGEFLOW_REPO_DIR = "/tmp/project";
    process.env.FORGEFLOW_DISPATCHER_URL = "http://127.0.0.1:8787";
    process.env.FORGEFLOW_AUTOMATION_URL = "http://127.0.0.1:8790";
    process.env.FORGEFLOW_WORKER_ID = "trae-remote";
    process.env.FORGEFLOW_TRAE_BIN = "/Applications/Trae CN.app";
    process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT = "9222";
    listManagedProcessesMock.mockReturnValue({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: true,
      matches: [
        {
          pid: 4001,
          command: `/usr/local/bin/node ${packageRuntimeScriptPath} --repo-dir /tmp/other-project --dispatcher-url http://127.0.0.1:8787 --automation-url http://127.0.0.1:8790 --worker-id trae-remote`,
        },
      ],
    });

    const { startWorker } = await import("../src/start-worker.js");

    expect(() => startWorker()).toThrow(
      /existing managed worker does not match requested repo\/dispatcher\/automation\/worker\/launch\/debug settings/i,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects reusing a worker process when launch arguments do not match", async () => {
    process.env.FORGEFLOW_REPO_DIR = "/tmp/project";
    process.env.FORGEFLOW_DISPATCHER_URL = "http://127.0.0.1:8787";
    process.env.FORGEFLOW_AUTOMATION_URL = "http://127.0.0.1:8790";
    process.env.FORGEFLOW_WORKER_ID = "trae-remote";
    process.env.FORGEFLOW_TRAE_BIN = "/Applications/Trae CN.app";
    process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT = "9222";
    listManagedProcessesMock.mockReturnValue({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: true,
      matches: [
        {
          pid: 4001,
          command: `/usr/local/bin/node ${packageRuntimeScriptPath} --repo-dir /tmp/project --dispatcher-url http://127.0.0.1:8787 --automation-url http://127.0.0.1:8790 --worker-id trae-remote`,
        },
      ],
    });

    const { startWorker } = await import("../src/start-worker.js");

    expect(() => startWorker()).toThrow(
      /existing managed worker does not match requested repo\/dispatcher\/automation\/worker\/launch\/debug settings/i,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("uses file descriptors for detached worker logging", async () => {
    process.env.FORGEFLOW_REPO_DIR = "/tmp/project";
    listManagedProcessesMock.mockReturnValue({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: false,
      matches: [],
    });

    const { startWorker } = await import("../src/start-worker.js");
    const result = startWorker({
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
      detached: true,
      logFile: "/tmp/worker.log",
      force: true,
    });
    await result.ready;

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        stdio: ["ignore", 43, 43],
        detached: true,
      }),
    );
  });

  it("passes --debug to worker runtime when requested", async () => {
    process.env.FORGEFLOW_REPO_DIR = "/tmp/project";
    listManagedProcessesMock.mockReturnValue({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: false,
      matches: [],
    });

    const { startWorker } = await import("../src/start-worker.js");
    const result = startWorker({
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      repoDir: "/tmp/project",
      debug: true,
      force: true,
    });
    await result.ready;

    expect(result.args).toContain("--debug");
  });
});

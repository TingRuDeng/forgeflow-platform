import { describe, expect, it, vi } from "vitest";

import { listManagedProcesses, stopManagedProcesses } from "../src/process-control.js";

describe("process-control", () => {
  it("lists only processes that match the managed gateway script", () => {
    const execFileSyncMock = vi.fn(() => [
      "101 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
      "202 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/worker.js --worker-id trae-remote",
      "303 some-other-command",
    ].join("\n"));

    const result = listManagedProcesses("gateway", {
      execFileSync: execFileSyncMock as never,
    });

    expect(result).toEqual({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: true,
      matches: [
        {
          pid: 101,
          command: "/usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
        },
      ],
    });
  });

  it("returns an empty status when pgrep finds no managed worker process", () => {
    const error = Object.assign(new Error("not found"), {
      status: 1,
      stdout: "",
    });
    const execFileSyncMock = vi.fn(() => {
      throw error;
    });

    const result = listManagedProcesses("worker", {
      execFileSync: execFileSyncMock as never,
    });

    expect(result).toEqual({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      running: false,
      matches: [],
    });
  });

  it("falls back to ps lookup when pgrep returns pid-only output", () => {
    const execFileSyncMock = vi.fn((command: string) => {
      if (command === "pgrep") {
        return ["31303", "32187", "32728"].join("\n");
      }
      if (command === "ps") {
        return [
          "31303 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/worker.js --worker-id trae-remote",
          "32187 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/worker.js --worker-id trae-remote",
          "32728 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
        ].join("\n");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const result = listManagedProcesses("gateway", {
      execFileSync: execFileSyncMock as never,
    });

    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      "pgrep",
      ["-af", "run-trae-automation-gateway.js"],
      { encoding: "utf8" },
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      "ps",
      ["-p", "31303,32187,32728", "-o", "pid=,command="],
      { encoding: "utf8" },
    );
    expect(result).toEqual({
      kind: "gateway",
      scriptName: "run-trae-automation-gateway.js",
      running: true,
      matches: [
        {
          pid: 32728,
          command: "/usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790",
        },
      ],
    });
  });

  it("stops all matched worker pids and reports any skipped ones", () => {
    const execFileSyncMock = vi.fn(() => [
      "404 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/worker.js --worker-id trae-remote",
      "505 /usr/local/bin/node /tmp/repo/packages/trae-beta-runtime/dist/runtime/worker.js --worker-id trae-remote",
    ].join("\n"));
    const killMock = vi.fn((pid: number) => {
      if (pid === 505) {
        throw new Error("ESRCH");
      }
    });

    const result = stopManagedProcesses("worker", {
      execFileSync: execFileSyncMock as never,
      kill: killMock as never,
    });

    expect(killMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      kind: "worker",
      scriptName: "dist/runtime/worker.js",
      stoppedPids: [404],
      skippedPids: [505],
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDispatcherClient,
  runWorkerDaemonCycle,
  type DispatcherClient,
} from "../src/runtime/worker-daemon.js";

describe("codex worker daemon dispatcher protocol", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISPATCHER_API_TOKEN;
  });

  it("claims work through the v1 claim endpoint instead of the old assigned-task read", async () => {
    const client = {
      registerWorker: vi.fn().mockResolvedValue({ status: "registered" }),
      heartbeat: vi.fn().mockResolvedValue({ status: "heartbeat" }),
      getAssignedTask: vi.fn().mockRejectedValue(new Error("旧 assigned-task 路径不应参与 claim")),
      claimTask: vi.fn().mockResolvedValue(null),
      startTask: vi.fn(),
      submitResult: vi.fn(),
    } as unknown as DispatcherClient;

    const result = await runWorkerDaemonCycle({
      client,
      workerId: "codex-worker-1",
      pool: "codex",
      repoDir: "/tmp/project",
      at: "2026-07-03T00:00:00.000Z",
    });

    expect(result).toEqual({ status: "idle", workerId: "codex-worker-1" });
    expect(client.claimTask).toHaveBeenCalledWith("codex-worker-1", {
      at: "2026-07-03T00:00:00.000Z",
    });
    expect(client.getAssignedTask).not.toHaveBeenCalled();
  });

  it("sends dispatcher bearer token when DISPATCHER_API_TOKEN is set", async () => {
    process.env.DISPATCHER_API_TOKEN = "dispatcher-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createDispatcherClient("http://127.0.0.1:8787");
    await client.registerWorker({
      workerId: "codex-worker-1",
      pool: "codex",
      hostname: "host",
      labels: [],
      repoDir: "/tmp/project",
      at: "2026-07-03T00:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/workers/register",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer dispatcher-token",
        }),
      }),
    );
  });
});

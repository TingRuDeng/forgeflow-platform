import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runDecide } from "../src/decide.js";
import { createEmptyRuntimeState, saveRuntimeState } from "../src/http.js";

describe("decide", () => {
  it("posts review decisions to the dispatcher", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ taskId: "dispatch-1:task-1", status: "merged" }),
    });

    const result = await runDecide({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      decision: "merge",
      actor: "codex-control",
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      decision: "merge",
      status: "merged",
      source: "dispatcher",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/reviews/dispatch-1%3Atask-1/decision",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("updates local runtime state when only state-dir is available", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-review-"));
    const state = createEmptyRuntimeState();
    state.tasks = [{ id: "dispatch-1:task-1", status: "review" }];
    state.assignments = [{ taskId: "dispatch-1:task-1", status: "review", assignment: { status: "review" } }];
    state.reviews = [{ taskId: "dispatch-1:task-1", decision: "block" }];
    state.pullRequests = [{ taskId: "dispatch-1:task-1", status: "open" }];
    saveRuntimeState(stateDir, state);

    const result = await runDecide({
      stateDir,
      taskId: "dispatch-1:task-1",
      decision: "block",
      actor: "codex-control",
      notes: "needs more work",
    });

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      decision: "block",
      status: "blocked",
      source: "state-dir",
    });

    const nextState = JSON.parse(fs.readFileSync(path.join(stateDir, "runtime-state.json"), "utf8")) as {
      tasks: Array<{ status: string }>;
      assignments: Array<{ status: string; assignment: { status: string } }>;
      reviews: Array<{ decision: string }>;
      pullRequests: Array<{ status: string }>;
    };

    expect(nextState.tasks[0]?.status).toBe("blocked");
    expect(nextState.assignments[0]?.status).toBe("blocked");
    expect(nextState.assignments[0]?.assignment.status).toBe("blocked");
    expect(nextState.reviews[0]?.decision).toBe("block");
    expect(nextState.pullRequests[0]?.status).toBe("changes_requested");
  });
});

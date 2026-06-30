import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runDecide } from "../src/decide.js";
import { createEmptyRuntimeState, saveRuntimeState } from "../src/http.js";

describe("decide", () => {
  it("posts review decisions to the dispatcher", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/dashboard/snapshot")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ reviews: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ taskId: "dispatch-1:task-1", status: "merged" }),
      });
    });

    const result = await runDecide({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      decision: "merge",
      actor: "codex-control",
      reasonCode: "looks_good",
      canRedrive: false,
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
      expect.objectContaining({ method: "POST" }),
    );
    const decisionCall = (fetchImpl.mock.calls as Array<[string, { method?: string; body?: string }]>).find(
      (call) => call[0].includes("/decision"),
    );
    const requestBody = JSON.parse(decisionCall![1].body as string);
    expect(requestBody).toMatchObject({
      actor: "codex-control",
      decision: "merge",
      notes: "",
      at: expect.any(String),
      evidence: {
        reasonCode: "looks_good",
        mustFix: [],
        canRedrive: false,
      },
    });
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
      reasonCode: "test_failure",
      mustFix: ["补齐失败测试"],
      canRedrive: true,
      redriveStrategy: "same_worker_continue",
    });

    expect(result).toMatchObject({
      taskId: "dispatch-1:task-1",
      decision: "block",
      status: "blocked",
      source: "state-dir",
    });

    const nextState = JSON.parse(fs.readFileSync(path.join(stateDir, "runtime-state.json"), "utf8")) as {
      updatedAt: string;
      tasks: Array<{ status: string }>;
      assignments: Array<{ status: string; assignment: { status: string } }>;
      reviews: Array<{ decision: string; decidedAt: string; evidence?: Record<string, unknown> }>;
      pullRequests: Array<{ status: string; updatedAt: string }>;
    };

    expect(nextState.updatedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(nextState.updatedAt.endsWith("Z")).toBe(false);
    expect(nextState.tasks[0]?.status).toBe("blocked");
    expect(nextState.assignments[0]?.status).toBe("blocked");
    expect(nextState.assignments[0]?.assignment.status).toBe("blocked");
    expect(nextState.reviews[0]?.decision).toBe("block");
    expect(nextState.reviews[0]?.evidence).toMatchObject({
      reasonCode: "test_failure",
      mustFix: ["补齐失败测试"],
      canRedrive: true,
      redriveStrategy: "same_worker_continue",
    });
    expect(nextState.reviews[0]?.decidedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(nextState.reviews[0]?.decidedAt.endsWith("Z")).toBe(false);
    expect(nextState.pullRequests[0]?.status).toBe("changes_requested");
    expect(nextState.pullRequests[0]?.updatedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(nextState.pullRequests[0]?.updatedAt.endsWith("Z")).toBe(false);
  });

  it("blocks a merge when the review risk grade is not low", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/dashboard/snapshot")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            reviews: [
              {
                taskId: "dispatch-1:task-1",
                riskAssessment: {
                  level: "needs_human_attention",
                  reasons: ["protected paths touched: auth/**"],
                },
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => "{}" });
    });

    await expect(
      runDecide({
        dispatcherUrl: "http://127.0.0.1:8787",
        taskId: "dispatch-1:task-1",
        decision: "merge",
        fetchImpl: fetchImpl as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/merge blocked: review risk is "needs_human_attention"/);

    // The decision POST must not have been issued.
    expect(
      (fetchImpl.mock.calls as Array<[string]>).some((call) => call[0].includes("/decision")),
    ).toBe(false);
  });

  it("allows a risky merge when --acknowledge-risk is passed", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/dashboard/snapshot")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            reviews: [{ taskId: "dispatch-1:task-1", riskAssessment: { level: "too_large_for_auto_review", reasons: [] } }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ taskId: "dispatch-1:task-1", status: "merged" }),
      });
    });

    const result = await runDecide({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      decision: "merge",
      acknowledgeRisk: true,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result.status).toBe("merged");
    // With acknowledgement the risk snapshot is not even fetched.
    expect(
      (fetchImpl.mock.calls as Array<[string]>).some((call) => call[0].includes("/api/dashboard/snapshot")),
    ).toBe(false);
  });

  it("allows a low-risk merge without acknowledgement", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/dashboard/snapshot")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            reviews: [{ taskId: "dispatch-1:task-1", riskAssessment: { level: "low", reasons: [] } }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ taskId: "dispatch-1:task-1", status: "merged" }),
      });
    });

    const result = await runDecide({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      decision: "merge",
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result.status).toBe("merged");
  });

  it("does not gate non-merge decisions on risk", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ taskId: "dispatch-1:task-1", status: "blocked" }),
    });

    const result = await runDecide({
      dispatcherUrl: "http://127.0.0.1:8787",
      taskId: "dispatch-1:task-1",
      decision: "block",
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result.status).toBe("blocked");
    // No risk snapshot fetch for non-merge decisions.
    expect(
      (fetchImpl.mock.calls as Array<[string]>).some((call) => call[0].includes("/api/dashboard/snapshot")),
    ).toBe(false);
  });
});

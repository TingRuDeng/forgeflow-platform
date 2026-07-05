import { describe, expect, it } from "vitest";

import type {
  RuntimeState,
  TaskAttempt,
} from "../../../src/modules/server/runtime-state.js";
import {
  beginTaskForWorker,
  claimAssignedTaskForWorker,
  createDispatch,
  createEmptyRuntimeState,
  interruptTaskForInput,
  registerWorker,
  resumeTaskFromInput,
} from "../../../src/modules/server/runtime-state.js";

const RESUME_PAYLOAD_SCHEMA = {
  properties: {
    decision: { type: "string" as const, enum: ["continue", "stop"], title: "Decision" },
    retryLimit: { type: "integer" as const, minimum: 1, maximum: 3, title: "Retry Limit" },
    reviewers: {
      type: "array" as const,
      minItems: 1,
      maxItems: 2,
      items: { type: "string" as const, enum: ["alice", "bob"] },
      title: "Reviewers",
    },
    acknowledgeRisk: { type: "boolean" as const, title: "Acknowledge Risk" },
  },
  required: ["decision", "reviewers"],
};

function workerEnvelope(attempt: TaskAttempt) {
  return {
    attemptId: attempt.attemptId,
    leaseToken: attempt.leaseToken,
    protocolVersion: attempt.protocolVersion,
    traceId: attempt.traceId,
    idempotencyKey: attempt.idempotencyKey,
  };
}

function createDispatchedState(): { state: RuntimeState; taskId: string } {
  let state = createEmptyRuntimeState();
  state = registerWorker(state, {
    workerId: "hitl-schema-worker",
    pool: "codex",
    hostname: "hitl-host",
    labels: ["codex"],
    repoDir: "/repos/forgeflow-platform",
    at: "2026-07-05T10:00:00.000Z",
  });
  const dispatch = createDispatch(state, {
    repo: "TingRuDeng/forgeflow-platform",
    defaultBranch: "main",
    requestedBy: "codex-control",
    tasks: [{
      id: "hitl-schema-task",
      title: "验证 HITL resume schema",
      pool: "codex",
      branchName: "ai/codex/hitl-schema-task",
      verification: { mode: "run" },
    }],
    packages: [{
      taskId: "hitl-schema-task",
      assignment: {
        taskId: "hitl-schema-task",
        workerId: null,
        pool: "codex",
        status: "pending",
        branchName: "ai/codex/hitl-schema-task",
        repo: "TingRuDeng/forgeflow-platform",
        defaultBranch: "main",
      },
    }],
    createdAt: "2026-07-05T10:00:01.000Z",
  });
  return { state: dispatch.state, taskId: dispatch.taskIds[0] };
}

function startTask(state: RuntimeState, taskId: string): RuntimeState {
  const claimed = claimAssignedTaskForWorker(state, {
    workerId: "hitl-schema-worker",
    at: "2026-07-05T10:00:02.000Z",
  });
  return beginTaskForWorker(claimed.state, {
    workerId: "hitl-schema-worker",
    taskId,
    ...workerEnvelope(claimed.state.taskAttempts[0]!),
    at: "2026-07-05T10:00:03.000Z",
  });
}

function createWaitingForInputState(): { state: RuntimeState; taskId: string } {
  const dispatched = createDispatchedState();
  const running = startTask(dispatched.state, dispatched.taskId);
  return {
    taskId: dispatched.taskId,
    state: interruptTaskForInput(running, {
      taskId: dispatched.taskId,
      actor: "codex-control",
      reason: "需要恢复输入",
      resumePayloadSchema: RESUME_PAYLOAD_SCHEMA,
      at: "2026-07-05T10:00:04.000Z",
    }),
  };
}

describe("runtime-state HITL resume schema", () => {
  it("rejects resume payloads that do not match the stored schema", () => {
    const { state, taskId } = createWaitingForInputState();

    expect(() => resumeTaskFromInput(state, {
      taskId,
      actor: "codex-control",
      resumePayload: { decision: "maybe", reviewers: ["alice"] },
      at: "2026-07-05T10:00:05.000Z",
    })).toThrow("resumePayload.decision must be one of");

    expect(() => resumeTaskFromInput(state, {
      taskId,
      actor: "codex-control",
      resumePayload: { decision: "continue", retryLimit: 4, reviewers: ["alice"] },
      at: "2026-07-05T10:00:05.000Z",
    })).toThrow("resumePayload.retryLimit must be <= 3");

    expect(() => resumeTaskFromInput(state, {
      taskId,
      actor: "codex-control",
      resumePayload: { decision: "continue", reviewers: ["mallory"] },
      at: "2026-07-05T10:00:05.000Z",
    })).toThrow("resumePayload.reviewers contains invalid value mallory");
  });

  it("resumes waiting tasks when payload satisfies the stored schema", () => {
    const { state, taskId } = createWaitingForInputState();

    const resumed = resumeTaskFromInput(state, {
      taskId,
      actor: "codex-control",
      resumePayload: {
        decision: "continue",
        retryLimit: 2,
        reviewers: ["alice", "bob"],
        acknowledgeRisk: true,
      },
      at: "2026-07-05T10:00:05.000Z",
    });

    expect(resumed.tasks[0]).toMatchObject({
      status: "ready",
      waitingForInput: null,
      resumePayload: {
        decision: "continue",
        retryLimit: 2,
        reviewers: ["alice", "bob"],
        acknowledgeRisk: true,
      },
    });
    expect(resumed.assignments[0]).toMatchObject({
      status: "pending",
      assignment: {
        resumePayload: {
          decision: "continue",
          retryLimit: 2,
          reviewers: ["alice", "bob"],
          acknowledgeRisk: true,
        },
      },
    });
  });
});

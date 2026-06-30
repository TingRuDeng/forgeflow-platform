import { describe, expect, it } from "vitest";

import {
  ArtifactBundleSchema,
  ProtocolVersionSchema,
  ReviewDecisionSchema,
  RuntimeEventTypeSchema,
  WorkerMutationKindSchema,
  WorkerProtocolEnvelopeSchema,
  WorkerSdkResultPayloadSchema,
  WorkerSdkStartPayloadSchema,
  buildWorkerResultPayload,
  buildWorkerStartPayload,
  normalizeRuntimeEventType,
} from "../src/index.js";

describe("WorkerProtocolEnvelopeSchema", () => {
  it("requires a lease token for every mutation envelope", () => {
    const result = WorkerProtocolEnvelopeSchema.safeParse({
      protocolVersion: "2026-05-v1",
      taskId: "task-1",
      attemptId: "attempt-1",
      workerId: "worker-1",
      traceId: "trace-1",
      idempotencyKey: "result-attempt-1",
    });

    expect(result.success).toBe(false);
  });
});

describe("worker SDK payload helpers", () => {
  const envelope = {
    protocolVersion: "2026-05-v1" as const,
    taskId: "task-1",
    attemptId: "attempt-1",
    workerId: "worker-1",
    leaseToken: "lease-token",
    traceId: "trace-1",
    idempotencyKey: "result-attempt-1",
  };

  it("builds a validated start-task payload from the shared envelope", () => {
    const payload = buildWorkerStartPayload({
      envelope,
      at: "2026-06-12T00:00:00.000Z",
    });

    expect(WorkerMutationKindSchema.parse(payload.kind)).toBe("start-task");
    expect(WorkerSdkStartPayloadSchema.parse(payload)).toMatchObject({
      kind: "start-task",
      taskId: "task-1",
      attemptId: "attempt-1",
      leaseToken: "lease-token",
    });
  });

  it("builds a validated result payload with dispatcher canonical fields", () => {
    const payload = buildWorkerResultPayload({
      envelope,
      result: {
        provider: "codex",
        pool: "codex",
        branchName: "codex/task-1",
        repo: "owner/repo",
        defaultBranch: "main",
        mode: "run",
        output: "done",
        generatedAt: "2026-06-12T00:00:10.000Z",
        verification: {
          allPassed: true,
          commands: [],
        },
      },
      changedFiles: ["src/index.ts"],
      pullRequest: null,
    });

    expect(WorkerSdkResultPayloadSchema.parse(payload)).toMatchObject({
      kind: "result",
      taskId: "task-1",
      result: {
        taskId: "task-1",
        workerId: "worker-1",
        repo: "owner/repo",
      },
      changedFiles: ["src/index.ts"],
      pullRequest: null,
    });
  });
});

describe("ProtocolVersionSchema", () => {
  it("accepts only the vNext worker protocol version", () => {
    expect(ProtocolVersionSchema.parse("2026-05-v1")).toBe("2026-05-v1");
    expect(() => ProtocolVersionSchema.parse("2026-04-v0")).toThrow();
  });
});

describe("ArtifactBundleSchema", () => {
  it("accepts a minimal artifact bundle for an attempt", () => {
    const bundle = ArtifactBundleSchema.parse({
      schemaVersion: "artifact-bundle/v1",
      taskId: "task-1",
      attemptId: "attempt-1",
      changedFiles: [
        {
          path: "apps/dispatcher/src/modules/server/runtime-state.ts",
          changeType: "modified",
        },
      ],
      refs: {
        diff: "artifact://attempt-1/diff.patch",
      },
    });

    expect(bundle.schemaVersion).toBe("artifact-bundle/v1");
    expect(bundle.changedFiles[0]?.changeType).toBe("modified");
  });

  it("rejects artifact bundles without attempt ownership", () => {
    const result = ArtifactBundleSchema.safeParse({
      schemaVersion: "artifact-bundle/v1",
      taskId: "task-1",
      changedFiles: [],
      refs: {},
    });

    expect(result.success).toBe(false);
  });
});

describe("RuntimeEventTypeSchema", () => {
  it("accepts fixed vNext runtime event taxonomy values", () => {
    expect(RuntimeEventTypeSchema.parse("attempt_created")).toBe("attempt_created");
    expect(RuntimeEventTypeSchema.parse("artifact_bundle_created")).toBe("artifact_bundle_created");
    expect(RuntimeEventTypeSchema.parse("worker_disabled")).toBe("worker_disabled");
    expect(RuntimeEventTypeSchema.parse("lease_conflict")).toBe("lease_conflict");
    expect(() => RuntimeEventTypeSchema.parse("attempt_started_again")).toThrow();
  });

  it("normalizes current dispatcher event names into the vNext taxonomy", () => {
    expect(normalizeRuntimeEventType("created")).toBe("task_created");
    expect(normalizeRuntimeEventType("assignment_claimed")).toBe("attempt_created");
    expect(normalizeRuntimeEventType("progress_reported")).toBe("attempt_progress");
    expect(normalizeRuntimeEventType("session_interrupted")).toBe("attempt_failed");
    expect(normalizeRuntimeEventType("submit_result_retry_failed")).toBe("attempt_failed");
    expect(normalizeRuntimeEventType("delivery_failed")).toBe("attempt_failed");
    expect(normalizeRuntimeEventType("worktree_cleanup_failed")).toBe("attempt_failed");
    expect(normalizeRuntimeEventType("worker_disabled")).toBe("worker_disabled");
    expect(normalizeRuntimeEventType("worker_enabled")).toBe("worker_enabled");
    expect(normalizeRuntimeEventType("worker_offline")).toBe("worker_offline");
    expect(normalizeRuntimeEventType("lease_conflict")).toBe("lease_conflict");
    expect(normalizeRuntimeEventType("unknown_runtime_event")).toBeNull();
  });
});

describe("ReviewDecisionSchema", () => {
  it("accepts reason-coded review workflow decisions", () => {
    expect(ReviewDecisionSchema.parse("reject_fixable")).toBe("reject_fixable");
    expect(ReviewDecisionSchema.parse("redrive")).toBe("redrive");
    expect(ReviewDecisionSchema.parse("block")).toBe("block");
    expect(() => ReviewDecisionSchema.parse("needs_changes")).toThrow();
  });
});

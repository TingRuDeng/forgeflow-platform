import { describe, expect, it } from "vitest";

import {
  ArtifactBundleSchema,
  ProtocolVersionSchema,
  ReviewDecisionSchema,
  RuntimeEventTypeSchema,
  WorkerProtocolEnvelopeSchema,
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
    expect(() => RuntimeEventTypeSchema.parse("attempt_started_again")).toThrow();
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

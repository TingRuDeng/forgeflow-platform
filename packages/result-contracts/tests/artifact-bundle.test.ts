import { describe, it, expect } from "vitest";
import { ArtifactBundleSchema } from "../src/index.js";

describe("ArtifactBundleSchema", () => {
  it("parses a minimal v1 artifact bundle", () => {
    const bundle = ArtifactBundleSchema.parse({
      bundleId: "bundle-task-1-attempt-1",
      taskId: "task-1",
      attemptId: "attempt-1",
      schemaVersion: "artifact-bundle/v1",
      summary: "任务已完成",
      changedFiles: [
        {
          path: "src/index.ts",
          changeType: "modified",
        },
      ],
      refs: {
        structuredReport: "artifact://attempt-1/result.json",
      },
    });

    expect(bundle.schemaVersion).toBe("artifact-bundle/v1");
    expect(bundle.riskNotes).toEqual([]);
    expect(bundle.nextActions).toEqual([]);
  });

  it("parses retained diff log and test result content", () => {
    const retainedTrajectory = JSON.stringify([
      { action: "pnpm test", observation: "58 tests passed" },
    ]);

    const bundle = ArtifactBundleSchema.parse({
      taskId: "task-1",
      attemptId: "attempt-1",
      schemaVersion: "artifact-bundle/v1",
      changedFiles: [],
      refs: {
        diff: "artifact://attempt-1/diff.patch",
        logs: "artifact://attempt-1/session.log",
        traj: "artifact://attempt-1/trajectory.traj",
      },
      retainedContent: {
        diff: "diff --git a/src/index.ts b/src/index.ts",
        logs: "pnpm test passed",
        testResults: "58 tests passed",
        trajectory: retainedTrajectory,
      },
    });

    expect(bundle.retainedContent).toEqual({
      diff: "diff --git a/src/index.ts b/src/index.ts",
      logs: "pnpm test passed",
      testResults: "58 tests passed",
      trajectory: retainedTrajectory,
    });
    expect(bundle.refs.traj).toBe("artifact://attempt-1/trajectory.traj");
  });

  it("parses structured replayable trajectory steps", () => {
    const bundle = ArtifactBundleSchema.parse({
      taskId: "task-1",
      attemptId: "attempt-1",
      schemaVersion: "artifact-bundle/v1",
      changedFiles: [],
      refs: {},
      trajectory: {
        schemaVersion: "artifact-trajectory/v1",
        steps: [
          {
            sequence: 1,
            phase: "verification",
            action: "pnpm test",
            observation: "58 tests passed",
            status: "succeeded",
            command: "pnpm test",
            cwd: "/repo",
            exitCode: 0,
            artifactRef: "artifact://attempt-1/test-results.txt",
          },
        ],
      },
    });

    expect(bundle.trajectory?.steps[0]).toMatchObject({
      sequence: 1,
      phase: "verification",
      action: "pnpm test",
      observation: "58 tests passed",
      status: "succeeded",
      exitCode: 0,
    });
  });

  it("rejects artifact bundles without attempt ownership", () => {
    expect(() => ArtifactBundleSchema.parse({
      taskId: "task-1",
      schemaVersion: "artifact-bundle/v1",
      changedFiles: [],
      refs: {},
    })).toThrow();
  });
});

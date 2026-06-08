import { describe, expect, it } from "vitest";

import type { DashboardSnapshot } from "../../../src/modules/server/runtime-state.js";
import { buildStage3SloStatus } from "../../../src/modules/server/slo.js";

function snapshotWithMetrics(metrics: Partial<DashboardSnapshot["metrics"]>): DashboardSnapshot {
  return {
    updatedAt: "2026-06-08T00:00:00.000Z",
    stats: {
      workers: { total: 0, idle: 0, busy: 0, offline: 0, disabled: 0 },
      tasks: { total: 0, ready: 0, assigned: 0, inProgress: 0, review: 0, merged: 0, failed: 0, cancelled: 0 },
    },
    metrics: {
      queueDepth: 0,
      plannedTasks: 0,
      reviewBacklog: 0,
      avgAssignmentLagMs: 0,
      maxAssignmentLagMs: 0,
      submitResultRetryCount: 0,
      retryRatePct: 0,
      deliveryFailedCount: 0,
      cleanupFailureCount: 0,
      sessionInterruptionCount: 0,
      stateLockTimeoutCount: 0,
      shadowWriteFailureCount: 0,
      branchProtectionHitCount: 0,
      leaseConflictCount: 0,
      leaseReclaimCount: 0,
      activeLeases: { total: 0, byResourceType: { assignment: 0 } },
      repoConcurrencySaturation: {},
      failureCodes: {},
      reviewReasonCodes: {},
      ...metrics,
    },
    workers: [],
    tasks: [],
    taskAttempts: [],
    artifactBundles: [],
    assignments: [],
    reviews: [],
    pullRequests: [],
    events: [],
    dispatches: [],
    leases: [],
  };
}

describe("stage 3 slo", () => {
  it("triggers burn rate on shadow write failures", () => {
    const status = buildStage3SloStatus(snapshotWithMetrics({ shadowWriteFailureCount: 1 }));

    expect(status.indicators.shadowWriteFailureCount).toBe(1);
    expect(status.burnRate.triggered).toBe(true);
    expect(status.burnRate.reasons).toContain("shadow_write_failed");
  });
});

import type { DashboardSnapshot } from "./runtime-state.js";

export interface Stage3SloStatus {
  targets: {
    maxQueueDepth: number;
    maxReviewBacklog: number;
    maxAvgAssignmentLagMs: number;
    maxDeliveryFailedCount: number;
    maxLeaseConflictCount: number;
    maxShadowWriteFailureCount: number;
  };
  indicators: {
    queueDepth: number;
    reviewBacklog: number;
    avgAssignmentLagMs: number;
    deliveryFailedCount: number;
    leaseConflictCount: number;
    leaseReclaimCount: number;
    shadowWriteFailureCount: number;
  };
  burnRate: {
    triggered: boolean;
    reasons: string[];
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function buildStage3SloStatus(snapshot: DashboardSnapshot): Stage3SloStatus {
  const targets = {
    maxQueueDepth: parsePositiveInt(process.env.DISPATCHER_SLO_MAX_QUEUE_DEPTH, 25),
    maxReviewBacklog: parsePositiveInt(process.env.DISPATCHER_SLO_MAX_REVIEW_BACKLOG, 10),
    maxAvgAssignmentLagMs: parsePositiveInt(process.env.DISPATCHER_SLO_MAX_ASSIGNMENT_LAG_MS, 60_000),
    maxDeliveryFailedCount: parsePositiveInt(process.env.DISPATCHER_SLO_MAX_DELIVERY_FAILED, 0),
    maxLeaseConflictCount: parsePositiveInt(process.env.DISPATCHER_SLO_MAX_LEASE_CONFLICTS, 0),
    maxShadowWriteFailureCount: parsePositiveInt(process.env.DISPATCHER_SLO_MAX_SHADOW_WRITE_FAILED, 0),
  };

  const indicators = {
    queueDepth: snapshot.metrics.queueDepth,
    reviewBacklog: snapshot.metrics.reviewBacklog,
    avgAssignmentLagMs: snapshot.metrics.avgAssignmentLagMs,
    deliveryFailedCount: snapshot.metrics.deliveryFailedCount,
    leaseConflictCount: snapshot.metrics.leaseConflictCount,
    leaseReclaimCount: snapshot.metrics.leaseReclaimCount,
    shadowWriteFailureCount: snapshot.metrics.shadowWriteFailureCount,
  };

  const reasons = [
    indicators.queueDepth > targets.maxQueueDepth ? "queue_depth" : null,
    indicators.reviewBacklog > targets.maxReviewBacklog ? "review_backlog" : null,
    indicators.avgAssignmentLagMs > targets.maxAvgAssignmentLagMs ? "assignment_lag" : null,
    indicators.deliveryFailedCount > targets.maxDeliveryFailedCount ? "delivery_failed" : null,
    indicators.leaseConflictCount > targets.maxLeaseConflictCount ? "lease_conflict" : null,
    indicators.shadowWriteFailureCount > targets.maxShadowWriteFailureCount ? "shadow_write_failed" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    targets,
    indicators,
    burnRate: {
      triggered: reasons.length > 0,
      reasons,
    },
  };
}

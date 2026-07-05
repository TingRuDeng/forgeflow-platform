import type { ShadowMode } from "@forgeflow/dispatcher-store-core";

export type RuntimeStateShadowHealth = {
  mode: ShadowMode;
  queueMode: ShadowMode;
  configured: boolean;
  primarySupported: boolean;
  projectionCounts: Record<string, number>;
  queueCounts: Record<string, number>;
  expectedCounts: Record<string, number>;
  expectedQueueCounts: Record<string, number>;
};

export type RuntimeStateShadowDriftSummary = {
  status: "not_configured" | "primary_unsupported" | "matched" | "drifted";
  projectionMatches: boolean;
  queueMatches: boolean;
  mismatches: Array<{
    store: "projection" | "queue";
    name: string;
    expected: number;
    actual: number;
  }>;
};

export type RuntimeStateShadowDriftAlert = {
  level: "none" | "warning" | "critical";
  reasonCodes: string[];
  mismatchCount: number;
  absoluteDelta: number;
};

export type RuntimeStateShadowDriftAlertThresholds = {
  maxMismatchCount?: number;
  maxAbsoluteDelta?: number;
};

function countValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareCounts(
  store: "projection" | "queue",
  expectedCounts: Record<string, number>,
  actualCounts: Record<string, number>,
): RuntimeStateShadowDriftSummary["mismatches"] {
  const names = new Set([...Object.keys(expectedCounts), ...Object.keys(actualCounts)]);
  return [...names].flatMap((name) => {
    const expected = countValue(expectedCounts[name]);
    const actual = countValue(actualCounts[name]);
    return expected === actual ? [] : [{ store, name, expected, actual }];
  });
}

function absoluteDriftDelta(summary: RuntimeStateShadowDriftSummary): number {
  return summary.mismatches.reduce((total, mismatch) => total + Math.abs(mismatch.expected - mismatch.actual), 0);
}

function thresholdValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function summarizeRuntimeStateShadowDrift(
  health: RuntimeStateShadowHealth,
): RuntimeStateShadowDriftSummary {
  if (!health.configured) {
    return {
      status: "not_configured",
      projectionMatches: true,
      queueMatches: true,
      mismatches: [],
    };
  }
  if (health.mode === "primary" && !health.primarySupported) {
    return {
      status: "primary_unsupported",
      projectionMatches: false,
      queueMatches: health.queueMode === "disabled",
      mismatches: [],
    };
  }

  const projectionMismatches = compareCounts("projection", health.expectedCounts, health.projectionCounts);
  const queueMismatches = health.queueMode === "disabled"
    ? []
    : compareCounts("queue", health.expectedQueueCounts, health.queueCounts);
  const mismatches = [...projectionMismatches, ...queueMismatches];
  return {
    status: mismatches.length === 0 ? "matched" : "drifted",
    projectionMatches: projectionMismatches.length === 0,
    queueMatches: queueMismatches.length === 0,
    mismatches,
  };
}

// 将 drift 结果转成稳定告警摘要，供 release gate、runbook 和后续 reconciliation 统一消费。
export function evaluateRuntimeStateShadowDriftAlert(
  summary: RuntimeStateShadowDriftSummary,
  thresholds: RuntimeStateShadowDriftAlertThresholds = {},
): RuntimeStateShadowDriftAlert {
  const mismatchCount = summary.mismatches.length;
  const absoluteDelta = absoluteDriftDelta(summary);
  if (summary.status !== "drifted") {
    return { level: "none", reasonCodes: [], mismatchCount, absoluteDelta };
  }

  const reasonCodes = [
    mismatchCount > thresholdValue(thresholds.maxMismatchCount) ? "shadow_drift_mismatch_count" : null,
    absoluteDelta > thresholdValue(thresholds.maxAbsoluteDelta) ? "shadow_drift_delta" : null,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    level: reasonCodes.length > 0 ? "critical" : "warning",
    reasonCodes,
    mismatchCount,
    absoluteDelta,
  };
}

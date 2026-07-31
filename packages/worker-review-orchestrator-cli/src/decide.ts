import type { DecideOptions, DecideResult, ReviewFreshness } from "./types.js";

import { createJsonHttpClient } from "./http.js";
import { loadLocalSnapshot, runLocalDispatcherRequest } from "./local-dispatcher.js";
import { formatLocalTimestamp } from "./time.js";

type DecisionEvidence = {
  reasonCode?: string;
  mustFix: string[];
  canRedrive?: boolean;
  redriveStrategy?: string;
};

function normalizeDecision(decision: DecideOptions["decision"]) {
  if (decision === "merge") {
    return "merge" as const;
  }
  if (decision === "changes_requested") {
    return "changes_requested" as const;
  }
  if (decision === "rework") {
    return "rework" as const;
  }
  return "block" as const;
}

function readNowIso() {
  return formatLocalTimestamp();
}

async function resolveTaskReview(
  options: DecideOptions & { fetchImpl?: typeof globalThis.fetch },
): Promise<Record<string, unknown> | null> {
  if (options.dispatcherUrl) {
    const client = createJsonHttpClient(options.dispatcherUrl, { fetchImpl: options.fetchImpl });
    const snapshot = (await client.request("/api/dashboard/snapshot")) as {
      reviews?: Array<Record<string, unknown>>;
    };
    const review = (snapshot.reviews ?? []).find((item) => item.taskId === options.taskId);
    if (!review) {
      throw new Error(`review not found for task: ${options.taskId}`);
    }
    return review;
  }
  if (options.stateDir) {
    const snapshot = await loadLocalSnapshot(options.stateDir);
    const reviews = Array.isArray(snapshot.reviews)
      ? snapshot.reviews as Array<Record<string, unknown>>
      : [];
    const review = reviews.find(
      (item) => item.taskId === options.taskId,
    );
    if (!review) {
      throw new Error(`review not found for task: ${options.taskId}`);
    }
    return review;
  }
  return null;
}

function assertMergeRiskAcknowledged(
  options: DecideOptions,
  review: Record<string, unknown> | null,
): void {
  if (options.acknowledgeRisk === true) {
    return;
  }
  const risk = review?.riskAssessment as Record<string, unknown> | undefined | null;
  const level = typeof risk?.level === "string" ? risk.level : null;
  const reasons = Array.isArray(risk?.reasons)
    ? risk.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  if (level && level !== "low") {
    const reasonText = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
    throw new Error(
      `merge blocked: review risk is "${level}"${reasonText}. ` +
        "Re-run with --acknowledge-risk to override after a human review.",
    );
  }
}

function readReviewFreshness(review: Record<string, unknown> | null): ReviewFreshness | undefined {
  const material = review?.reviewMaterial as Record<string, unknown> | undefined | null;
  const freshness = material?.freshness as Record<string, unknown> | undefined | null;
  const attemptId = typeof freshness?.attemptId === "string" ? freshness.attemptId : "";
  const artifactBundleId = typeof freshness?.artifactBundleId === "string" ? freshness.artifactBundleId : "";
  if (!attemptId || !artifactBundleId) {
    return undefined;
  }
  return {
    attemptId,
    artifactBundleId,
    ...(typeof freshness?.commitSha === "string" && freshness.commitSha
      ? { commitSha: freshness.commitSha }
      : {}),
  };
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text ? text : undefined;
}

function normalizeMustFix(value: DecideOptions["mustFix"]): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const text = normalizeText(value);
  if (!text) {
    return [];
  }
  return text
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDecisionEvidence(options: DecideOptions): DecisionEvidence | undefined {
  const reasonCode = normalizeText(options.reasonCode);
  const mustFix = normalizeMustFix(options.mustFix);
  const redriveStrategy = normalizeText(options.redriveStrategy);
  const hasBooleanFlag = typeof options.canRedrive === "boolean";
  if (!reasonCode && mustFix.length === 0 && !hasBooleanFlag && !redriveStrategy) {
    return undefined;
  }
  const evidence: DecisionEvidence = { mustFix };
  if (reasonCode) {
    evidence.reasonCode = reasonCode;
  }
  if (hasBooleanFlag) {
    evidence.canRedrive = options.canRedrive;
  }
  if (redriveStrategy) {
    evidence.redriveStrategy = redriveStrategy;
  }
  return evidence;
}

export async function runDecide(options: DecideOptions & {
  fetchImpl?: typeof globalThis.fetch;
}): Promise<DecideResult> {
  const decision = normalizeDecision(options.decision);
  const review = await resolveTaskReview(options);
  if (decision === "merge") {
    assertMergeRiskAcknowledged(options, review);
  }
  const evidence = buildDecisionEvidence(options);
  const expectedFreshness = options.expectedFreshness ?? readReviewFreshness(review);
  const payload = {
    actor: options.actor ?? "codex-control",
    decision,
    notes: options.notes ?? "",
    at: options.at ?? readNowIso(),
    ...(options.acknowledgeRisk === true ? { acknowledgeRisk: true } : {}),
    ...(evidence ? { evidence } : {}),
    ...(expectedFreshness ? { expectedFreshness } : {}),
  };

  if (options.dispatcherUrl) {
    const client = createJsonHttpClient(options.dispatcherUrl, {
      fetchImpl: options.fetchImpl,
    });
    const result = await client.request(`/api/reviews/${encodeURIComponent(options.taskId)}/decision`, {
      method: "POST",
      body: payload,
    });
    return {
      taskId: options.taskId,
      decision,
      status: decision === "merge" ? "merged" : "blocked",
      source: "dispatcher",
      payload: result as Record<string, unknown>,
    };
  }

  if (!options.stateDir) {
    throw new Error("dispatcherUrl or stateDir is required");
  }

  const response = await runLocalDispatcherRequest({
    stateDir: options.stateDir,
    method: "POST",
    pathname: `/api/reviews/${encodeURIComponent(options.taskId)}/decision`,
    body: payload,
  });
  if (response.status < 200 || response.status >= 300) {
    const responseBody = response.json as { error?: unknown; message?: unknown } | undefined;
    const message = typeof responseBody?.message === "string"
      ? responseBody.message
      : typeof responseBody?.error === "string"
        ? responseBody.error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    taskId: options.taskId,
    decision,
    status: decision === "merge" ? "merged" : "blocked",
    source: "state-dir",
    payload: (response.json ?? {}) as Record<string, unknown>,
  };
}

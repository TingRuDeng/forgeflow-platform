import path from "node:path";

import type { DecideOptions, DecideResult, LocalRuntimeState } from "./types.js";

import { createJsonHttpClient, createEmptyRuntimeState, loadRuntimeState, saveRuntimeState } from "./http.js";
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

type ResolvedReviewRisk = {
  level: string | null;
  reasons: string[];
};

// Resolves the deterministic review risk grade for a task, fail-open: returns
// null when it cannot be determined (older dispatcher, fetch error, no grade),
// so the merge gate never blocks merely because risk could not be read.
async function resolveTaskReviewRisk(
  options: DecideOptions & { fetchImpl?: typeof globalThis.fetch },
): Promise<ResolvedReviewRisk | null> {
  const pickRisk = (review: Record<string, unknown> | undefined | null): ResolvedReviewRisk | null => {
    const risk = review?.riskAssessment as Record<string, unknown> | undefined | null;
    if (!risk) {
      return null;
    }
    const level = typeof risk.level === "string" ? risk.level : null;
    const reasons = Array.isArray(risk.reasons)
      ? risk.reasons.filter((reason): reason is string => typeof reason === "string")
      : [];
    return { level, reasons };
  };

  try {
    if (options.dispatcherUrl) {
      const client = createJsonHttpClient(options.dispatcherUrl, { fetchImpl: options.fetchImpl });
      const snapshot = (await client.request("/api/dashboard/snapshot")) as {
        reviews?: Array<Record<string, unknown>>;
      };
      const review = (snapshot.reviews ?? []).find((item) => item.taskId === options.taskId);
      return pickRisk(review);
    }
    if (options.stateDir) {
      const state = loadRuntimeState(path.resolve(options.stateDir));
      const review = (state.reviews as Array<Record<string, unknown>>).find(
        (item) => item.taskId === options.taskId,
      );
      return pickRisk(review);
    }
  } catch {
    return null;
  }
  return null;
}

async function assertMergeRiskAcknowledged(
  options: DecideOptions & { fetchImpl?: typeof globalThis.fetch },
): Promise<void> {
  if (options.acknowledgeRisk === true) {
    return;
  }
  const risk = await resolveTaskReviewRisk(options);
  if (risk?.level && risk.level !== "low") {
    const reasonText = risk.reasons.length > 0 ? ` (${risk.reasons.join("; ")})` : "";
    throw new Error(
      `merge blocked: review risk is "${risk.level}"${reasonText}. ` +
        "Re-run with --acknowledge-risk to override after a human review.",
    );
  }
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

function upsertByTaskId(items: Array<Record<string, unknown>>, payload: Record<string, unknown>) {
  const index = items.findIndex((item) => item.taskId === payload.taskId);
  if (index === -1) {
    return [...items, payload];
  }

  const next = [...items];
  next[index] = {
    ...next[index],
    ...payload,
  };
  return next;
}

function buildLocalDecisionState(
  state: LocalRuntimeState,
  input: DecideOptions & { decision: "merge" | "block" | "rework" | "changes_requested" },
) {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) {
    throw new Error(`task not found: ${input.taskId}`);
  }

  const assignment = state.assignments.find((candidate) => candidate.taskId === input.taskId);
  if (!assignment) {
    throw new Error(`assignment not found: ${input.taskId}`);
  }

  if (task.status !== "review") {
    throw new Error(`task not in review: ${input.taskId}`);
  }

  const nextStatus = input.decision === "merge" ? "merged" : "blocked";
  const at = input.at || readNowIso();
  const evidence = buildDecisionEvidence(input);

  const nextEvents = [
    ...state.events,
    {
      taskId: input.taskId,
      type: "status_changed",
      at,
      payload: {
        from: "review",
        to: nextStatus,
      },
    },
  ];

  const nextTasks = state.tasks.map((candidate) =>
    candidate.id === input.taskId
      ? {
          ...candidate,
          status: nextStatus,
        }
      : candidate,
  );

  const nextAssignments = state.assignments.map((candidate) =>
    candidate.taskId === input.taskId
      ? {
          ...candidate,
          status: nextStatus,
          assignment: {
            ...(candidate.assignment as Record<string, unknown>),
            status: nextStatus,
          },
        }
      : candidate,
  );

  const reviewPayload: Record<string, unknown> = {
    taskId: input.taskId,
    decision: input.decision,
    actor: input.actor ?? "codex-control",
    notes: input.notes ?? "",
    decidedAt: at,
  };
  if (evidence) {
    reviewPayload.evidence = evidence;
  }

  const nextReviews = upsertByTaskId(state.reviews, reviewPayload);

  const nextPullRequests = state.pullRequests.map((pullRequest) =>
    pullRequest.taskId === input.taskId
      ? {
          ...pullRequest,
          status: input.decision === "merge" ? "merged" : "changes_requested",
          updatedAt: at,
        }
      : pullRequest,
  );

  const nextState: LocalRuntimeState = {
    ...state,
    updatedAt: at,
    events: nextEvents,
    tasks: nextTasks,
    assignments: nextAssignments,
    reviews: nextReviews,
    pullRequests: nextPullRequests,
  };

  return {
    state: nextState,
    result: {
      taskId: input.taskId,
      decision: input.decision,
      status: nextStatus,
      actor: input.actor ?? "codex-control",
      notes: input.notes ?? "",
      at,
      task,
      assignment,
    },
  };
}

export async function runDecide(options: DecideOptions & {
  fetchImpl?: typeof globalThis.fetch;
}): Promise<DecideResult> {
  const decision = normalizeDecision(options.decision);
  if (decision === "merge") {
    await assertMergeRiskAcknowledged(options);
  }
  const evidence = buildDecisionEvidence(options);
  const payload = {
    actor: options.actor ?? "codex-control",
    decision,
    notes: options.notes ?? "",
    at: options.at ?? readNowIso(),
    ...(options.acknowledgeRisk === true ? { acknowledgeRisk: true } : {}),
    ...(evidence ? { evidence } : {}),
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

  const state = loadRuntimeState(path.resolve(options.stateDir));
  const result = buildLocalDecisionState(state, {
    ...options,
    decision,
  });
  saveRuntimeState(path.resolve(options.stateDir), result.state);

  return {
    taskId: options.taskId,
    decision,
    status: decision === "merge" ? "merged" : "blocked",
    source: "state-dir",
    payload: result.result as Record<string, unknown>,
  };
}

import path from "node:path";

import type { InspectOptions, InspectResult, InspectSummaryResult } from "./types.js";

import { createJsonHttpClient, loadRuntimeState } from "./http.js";

function findTask(snapshot: { tasks?: Array<Record<string, unknown>> }, taskId: string) {
  return (snapshot.tasks ?? []).find((task) => task.id === taskId) ?? null;
}

function findAssignment(snapshot: { assignments?: Array<Record<string, unknown>> }, taskId: string) {
  return (snapshot.assignments ?? []).find((assignment) => assignment.taskId === taskId) ?? null;
}

function findReviews(snapshot: { reviews?: Array<Record<string, unknown>> }, taskId: string) {
  return (snapshot.reviews ?? []).filter((review) => review.taskId === taskId);
}

function findPullRequest(snapshot: { pullRequests?: Array<Record<string, unknown>> }, taskId: string) {
  return (snapshot.pullRequests ?? []).find((pr) => pr.taskId === taskId) ?? null;
}

function findEvents(snapshot: { events?: Array<Record<string, unknown>> }, taskId: string) {
  return (snapshot.events ?? []).filter((event) => event.taskId === taskId);
}

function extractStringValue(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function extractNumberValue(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function extractArrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function extractResultEvidence(
  reviews: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
): {
  commit: string | null;
  pushStatus: string | null;
  testOutput: string | null;
  failureType: string | null;
  failureSummary: string | null;
  reasonCode: string | null;
  mustFix: string[];
  canRedrive: boolean | null;
  redriveStrategy: string | null;
} {
  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const latestWorkerResult = latestReview?.latestWorkerResult as Record<string, unknown> | null;
  const workerEvidence = latestWorkerResult?.evidence as Record<string, unknown> | null;
  const reviewEvidence = latestReview?.evidence as Record<string, unknown> | null;

  const failureType = typeof workerEvidence?.failureType === "string" ? workerEvidence.failureType : null;
  const failureSummary = typeof workerEvidence?.failureSummary === "string" ? workerEvidence.failureSummary : null;
  const reasonCode = typeof reviewEvidence?.reasonCode === "string" ? reviewEvidence.reasonCode : null;
  const mustFix = extractArrayOfStrings(reviewEvidence?.mustFix);
  const canRedrive = typeof reviewEvidence?.canRedrive === "boolean" ? reviewEvidence.canRedrive : null;
  const redriveStrategy = typeof reviewEvidence?.redriveStrategy === "string" ? reviewEvidence.redriveStrategy : null;

  if (latestReview) {
    const reviewMaterial = latestReview.reviewMaterial as Record<string, unknown> | null;
    if (reviewMaterial) {
      const pullRequest = reviewMaterial.pullRequest as Record<string, unknown> | null;
      const checks = reviewMaterial.checks as Array<Record<string, unknown>> | null;

      const commit = pullRequest ? extractStringValue(pullRequest, "headBranch") : null;
      const pushStatus = pullRequest ? extractStringValue(pullRequest, "status") : null;
      const testOutput = checks ? (checks.map((c) => extractStringValue(c, "command") ?? "").join("; ") || null) : null;

      if (commit || pushStatus || testOutput) {
        return { commit, pushStatus, testOutput, failureType, failureSummary, reasonCode, mustFix, canRedrive, redriveStrategy };
      }
    }
  }

  const statusChangedEvent = [...events].reverse().find((event) => extractStringValue(event, "type") === "status_changed");
  if (statusChangedEvent) {
    const payload = statusChangedEvent.payload as Record<string, unknown> | undefined;
    if (payload) {
      const github = payload.github as Record<string, unknown> | null;
      return {
        commit: github ? extractStringValue(github, "commit_sha") : null,
        pushStatus: github ? extractStringValue(github, "push_status") : null,
        testOutput: extractStringValue(payload, "test_output"),
        failureType,
        failureSummary,
        reasonCode,
        mustFix,
        canRedrive,
        redriveStrategy,
      };
    }
  }

  return { commit: null, pushStatus: null, testOutput: null, failureType, failureSummary, reasonCode, mustFix, canRedrive, redriveStrategy };
}

function generateSummary(
  task: Record<string, unknown>,
  assignment: Record<string, unknown> | null,
  reviews: Array<Record<string, unknown>>,
  pullRequest: Record<string, unknown> | null,
  events: Array<Record<string, unknown>>,
): InspectSummaryResult {
  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

  const recentEvents = events
    .slice(-5)
    .reverse()
    .map((event) => ({
      type: extractStringValue(event, "type") ?? "unknown",
      at: extractStringValue(event, "at"),
      summary: extractStringValue(event, "summary"),
    }));

  const reviewState = latestReview
    ? {
        decision: extractStringValue(latestReview, "decision"),
        actor: extractStringValue(latestReview, "actor"),
        at: extractStringValue(latestReview, "decidedAt") ?? extractStringValue(latestReview, "at"),
      }
    : null;

  const pullRequestState = pullRequest
    ? {
        url: extractStringValue(pullRequest, "url"),
        status: extractStringValue(pullRequest, "status"),
        number: extractNumberValue(pullRequest, "number"),
      }
    : null;

  return {
    taskId: extractStringValue(task, "id") ?? "",
    status: extractStringValue(task, "status"),
    branch: extractStringValue(task, "branchName"),
    repo: assignment ? extractStringValue(assignment, "repo") : extractStringValue(task, "repo"),
    workerId: assignment ? extractStringValue(assignment, "workerId") : null,
    latestResultEvidence: extractResultEvidence(reviews, events),
    recentEvents,
    reviewState,
    pullRequestState,
  };
}

export async function runInspect(options: InspectOptions & {
  fetchImpl?: typeof globalThis.fetch;
}): Promise<InspectResult | InspectSummaryResult> {
  let snapshot: Record<string, unknown>;

  if (options.dispatcherUrl) {
    const client = createJsonHttpClient(options.dispatcherUrl, {
      fetchImpl: options.fetchImpl,
    });
    snapshot = await client.request("/api/dashboard/snapshot") as Record<string, unknown>;
  } else if (options.stateDir) {
    const state = loadRuntimeState(path.resolve(options.stateDir));
    snapshot = state as unknown as Record<string, unknown>;
  } else {
    throw new Error("dispatcherUrl or stateDir is required");
  }

  const task = findTask(snapshot as { tasks?: Array<Record<string, unknown>> }, options.taskId);

  if (!task) {
    throw new Error(`task not found: ${options.taskId}`);
  }

  const assignment = findAssignment(snapshot as { assignments?: Array<Record<string, unknown>> }, options.taskId);
  const reviews = findReviews(snapshot as { reviews?: Array<Record<string, unknown>> }, options.taskId);
  const pullRequest = findPullRequest(snapshot as { pullRequests?: Array<Record<string, unknown>> }, options.taskId);
  const events = findEvents(snapshot as { events?: Array<Record<string, unknown>> }, options.taskId);

  if (options.summary) {
    return generateSummary(task, assignment, reviews, pullRequest, events);
  }

  return {
    taskId: options.taskId,
    task,
    assignment,
    reviews,
    pullRequest,
    events,
    snapshot,
  };
}
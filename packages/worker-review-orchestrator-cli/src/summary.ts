import type { InspectSummaryResult } from "./types.js";

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

function extractTraceId(
  task: Record<string, unknown>,
  assignment: Record<string, unknown> | null,
): string | null {
  const taskTraceId = extractStringValue(task, "traceId");
  if (taskTraceId) {
    return taskTraceId;
  }
  const assignmentTraceId = extractStringValue(assignment, "traceId");
  if (assignmentTraceId) {
    return assignmentTraceId;
  }
  const assignmentPayload = assignment?.assignment as Record<string, unknown> | undefined;
  return assignmentPayload ? extractStringValue(assignmentPayload, "traceId") : null;
}

function extractEventSummary(event: Record<string, unknown> | null): string | null {
  if (!event) {
    return null;
  }
  const explicitSummary = extractStringValue(event, "summary");
  if (explicitSummary) {
    return explicitSummary;
  }

  const payload = event.payload as Record<string, unknown> | undefined;
  const payloadMessage = typeof payload?.message === "string" ? payload.message : null;
  if (payloadMessage) {
    return payloadMessage;
  }

  const payloadData = payload?.data as Record<string, unknown> | undefined;
  const nestedMessage = typeof payloadData?.message === "string" ? payloadData.message : null;
  if (nestedMessage) {
    return nestedMessage;
  }

  const failureCode = typeof payload?.failureCode === "string"
    ? payload.failureCode
    : typeof payloadData?.failureCode === "string"
      ? payloadData.failureCode
      : null;
  if (failureCode) {
    return failureCode;
  }

  const traceId = typeof payload?.traceId === "string"
    ? payload.traceId
    : typeof payloadData?.traceId === "string"
      ? payloadData.traceId
      : null;
  const sessionId = typeof payload?.sessionId === "string"
    ? payload.sessionId
    : typeof payloadData?.sessionId === "string"
      ? payloadData.sessionId
      : null;
  if (traceId || sessionId) {
    return [sessionId ? `session=${sessionId}` : null, traceId ? `trace=${traceId}` : null]
      .filter(Boolean)
      .join(" ");
  }

  return null;
}

function extractResultEvidence(
  reviews: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
) {
  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const latestWorkerResult = latestReview?.latestWorkerResult as Record<string, unknown> | null;
  const workerEvidence = latestWorkerResult?.evidence as Record<string, unknown> | null;
  const reviewEvidence = latestReview?.evidence as Record<string, unknown> | null;

  const failureType = typeof workerEvidence?.failureType === "string" ? workerEvidence.failureType : null;
  const blockerList = Array.isArray(workerEvidence?.blockers) ? workerEvidence.blockers as Array<Record<string, unknown>> : [];
  const failureCode = blockerList.length > 0 && typeof blockerList[0]?.code === "string" ? blockerList[0].code : null;
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
      const testOutput = checks ? (checks.map((candidate) => extractStringValue(candidate, "command") ?? "").join("; ") || null) : null;
      if (commit || pushStatus || testOutput) {
        return { commit, pushStatus, testOutput, failureType, failureCode, failureSummary, reasonCode, mustFix, canRedrive, redriveStrategy };
      }
    }
  }

  const statusChangedEvent = [...events].reverse().find((event) => extractStringValue(event, "type") === "status_changed");
  if (statusChangedEvent) {
    const payload = statusChangedEvent.payload as Record<string, unknown> | undefined;
    const github = payload?.github as Record<string, unknown> | null;
    return {
      commit: github ? extractStringValue(github, "commit_sha") : null,
      pushStatus: github ? extractStringValue(github, "push_status") : null,
      testOutput: extractStringValue(payload ?? null, "test_output"),
      failureType,
      failureCode,
      failureSummary,
      reasonCode,
      mustFix,
      canRedrive,
      redriveStrategy,
    };
  }

  return { commit: null, pushStatus: null, testOutput: null, failureType, failureCode, failureSummary, reasonCode, mustFix, canRedrive, redriveStrategy };
}

export function buildInspectSummaryFromSnapshot(
  snapshot: Record<string, unknown>,
  taskId: string,
): InspectSummaryResult {
  const task = findTask(snapshot as { tasks?: Array<Record<string, unknown>> }, taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }

  const assignment = findAssignment(snapshot as { assignments?: Array<Record<string, unknown>> }, taskId);
  const reviews = findReviews(snapshot as { reviews?: Array<Record<string, unknown>> }, taskId);
  const pullRequest = findPullRequest(snapshot as { pullRequests?: Array<Record<string, unknown>> }, taskId);
  const events = findEvents(snapshot as { events?: Array<Record<string, unknown>> }, taskId);
  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const latestProgressEvent = [...events].reverse().find((event) => extractStringValue(event, "type") === "progress_reported");
  const latestProgressPayload = latestProgressEvent?.payload as Record<string, unknown> | undefined;
  const latestResultEvidence = extractResultEvidence(reviews, events);
  const riskAssessmentRaw = latestReview?.riskAssessment as Record<string, unknown> | null;
  const protectedPathHitsRaw = Array.isArray(riskAssessmentRaw?.protectedPathHits)
    ? (riskAssessmentRaw?.protectedPathHits as Array<Record<string, unknown>>)
    : [];

  return {
    taskId: extractStringValue(task, "id") ?? "",
    traceId: extractTraceId(task, assignment),
    status: extractStringValue(task, "status"),
    branch: extractStringValue(task, "branchName"),
    repo: assignment ? extractStringValue(assignment, "repo") : extractStringValue(task, "repo"),
    workerId: assignment ? extractStringValue(assignment, "workerId") : null,
    latestResultEvidence,
    recentEvents: events
      .slice(-5)
      .reverse()
      .map((event) => ({
        type: extractStringValue(event, "type") ?? "unknown",
        at: extractStringValue(event, "at"),
        summary: extractEventSummary(event),
      })),
    reviewState: latestReview
      ? {
          decision: extractStringValue(latestReview, "decision"),
          actor: extractStringValue(latestReview, "actor"),
          at: extractStringValue(latestReview, "decidedAt") ?? extractStringValue(latestReview, "at"),
        }
      : null,
    riskAssessment: riskAssessmentRaw
      ? {
          level: extractStringValue(riskAssessmentRaw, "level"),
          reasons: extractArrayOfStrings(riskAssessmentRaw.reasons),
          changedFileCount: extractNumberValue(riskAssessmentRaw, "changedFileCount"),
          protectedPathHits: protectedPathHitsRaw
            .map((hit) => extractStringValue(hit, "pattern"))
            .filter((pattern): pattern is string => typeof pattern === "string"),
        }
      : null,
    pullRequestState: pullRequest
      ? {
          url: extractStringValue(pullRequest, "url"),
          status: extractStringValue(pullRequest, "status"),
          number: extractNumberValue(pullRequest, "number"),
        }
      : null,
    canRedrive: latestResultEvidence.canRedrive,
    latestProgressAt: extractStringValue(latestProgressEvent ?? null, "at"),
    latestProgressSummary: extractStringValue(latestProgressPayload ?? null, "message")
      ?? extractStringValue(latestProgressPayload?.data as Record<string, unknown> | null, "message")
      ?? extractStringValue(latestProgressEvent ?? null, "summary"),
    lineage: {
      continueFromTaskId: extractStringValue(task, "continueFromTaskId"),
      followUpOfTaskId: extractStringValue(task, "followUpOfTaskId"),
      parentTaskId: extractStringValue(task, "continueFromTaskId") ?? extractStringValue(task, "followUpOfTaskId"),
    },
  };
}

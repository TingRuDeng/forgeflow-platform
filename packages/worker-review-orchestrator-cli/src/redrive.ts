import { randomUUID } from "node:crypto";

import type { RedriveOptions, RedriveResult, RedriveFailureType } from "./types.js";
import { createJsonHttpClient } from "./http.js";
import { buildSingleTaskDispatchInput, runDispatch } from "./dispatch.js";
import type { DispatchInput, DispatchResult } from "./types.js";
import { compareTimestampDesc } from "./time.js";

const REDRIVEABLE_FAILURE_PATTERNS: Array<{ type: RedriveFailureType; patterns: RegExp[] }> = [
  {
    type: "worktree_mismatch",
    patterns: [/worktree[_ ]mismatch/i, /workspace.*worktree.*mismatch/i, /worktree.*workspace.*mismatch/i],
  },
  {
    type: "branch_mismatch",
    patterns: [/branch[_ ]mismatch/i, /workspace.*branch.*mismatch/i, /branch.*workspace.*mismatch/i],
  },
  {
    type: "preflight_workspace_mismatch",
    patterns: [/preflight.*workspace.*mismatch/i, /workspace.*preflight.*mismatch/i],
  },
];

function extractStringValue(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function extractArrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function findFailureType(failureSummary: string): RedriveFailureType | null {
  for (const { type, patterns } of REDRIVEABLE_FAILURE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(failureSummary)) {
        return type;
      }
    }
  }
  return null;
}

function extractFailedSummaryFromEvents(events: Array<Record<string, unknown>>): string | null {
  const statusChangedEvents = events.filter((event) => {
    const type = extractStringValue(event, "type");
    const payload = event.payload as Record<string, unknown> | undefined;
    return type === "status_changed" && payload?.to === "failed";
  });

  if (statusChangedEvents.length === 0) return null;

  const latestStatusChanged = statusChangedEvents[statusChangedEvents.length - 1];
  const payload = latestStatusChanged.payload as Record<string, unknown> | undefined;
  const structuredFailureSummary = extractStringValue(payload ?? null, "failureSummary");
  if (structuredFailureSummary) {
    return structuredFailureSummary;
  }
  return extractStringValue(payload ?? null, "summary");
}

function extractLatestReviewDecision(
  reviews: Array<Record<string, unknown>>,
  taskId: string,
): { decision: string | null; notes: string | null; reviewRecord: Record<string, unknown> | null } {
  const taskReviews = reviews.filter((r) => {
    const reviewTaskId = extractStringValue(r, "taskId");
    return reviewTaskId === taskId;
  });

  if (taskReviews.length === 0) {
    return { decision: null, notes: null, reviewRecord: null };
  }

  const sortedReviews = [...taskReviews].sort((a, b) => {
    const aAt = extractStringValue(a, "decidedAt") ?? extractStringValue(a, "at") ?? "";
    const bAt = extractStringValue(b, "decidedAt") ?? extractStringValue(b, "at") ?? "";
    return compareTimestampDesc(aAt, bAt);
  });

  const latestReview = sortedReviews[0];
  return {
    decision: extractStringValue(latestReview, "decision"),
    notes: extractStringValue(latestReview, "notes"),
    reviewRecord: latestReview,
  };
}

function extractLatestWorkerResultEvidenceFailureSummary(
  reviews: Array<Record<string, unknown>>,
  taskId: string,
): string | null {
  const taskReview = reviews.find((r) => extractStringValue(r, "taskId") === taskId);
  if (!taskReview) return null;

  const latestWorkerResult = taskReview.latestWorkerResult as Record<string, unknown> | undefined;
  if (!latestWorkerResult) return null;

  const evidence = latestWorkerResult.evidence as Record<string, unknown> | undefined;
  if (!evidence) return null;

  return extractStringValue(evidence, "failureSummary");
}

function extractTaskFailureInfo(
  task: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
  reviews: Array<Record<string, unknown>>,
): { status: string | null; failureSummary: string | null } {
  const status = extractStringValue(task, "status");
  const taskId = extractStringValue(task, "id");

  const evidenceFailureSummary = taskId
    ? extractLatestWorkerResultEvidenceFailureSummary(reviews, taskId)
    : null;
  if (evidenceFailureSummary) {
    return { status, failureSummary: evidenceFailureSummary };
  }

  const eventFailureSummary = extractFailedSummaryFromEvents(events);
  return { status, failureSummary: eventFailureSummary };
}

interface RecoverableTaskFields {
  repo: string;
  defaultBranch: string;
  title: string;
  pool: string;
  originalBranchName: string;
  allowedPaths: string[];
  acceptance: string[];
  targetWorkerId: string | null;
  workerPrompt: string;
  contextMarkdown: string;
}

function recoverFieldsFromTask(
  task: Record<string, unknown>,
  assignment: Record<string, unknown> | null,
): RecoverableTaskFields {
  const assignmentRecord = assignment as Record<string, unknown> | null;
  const originalBranchName = assignment
    ? extractStringValue(assignment, "branchName") ?? extractStringValue(task, "branchName") ?? ""
    : extractStringValue(task, "branchName") ?? "";
  return {
    repo: assignment ? extractStringValue(assignment, "repo") ?? extractStringValue(task, "repo") ?? "" : extractStringValue(task, "repo") ?? "",
    defaultBranch: assignment ? extractStringValue(assignment, "defaultBranch") ?? extractStringValue(task, "defaultBranch") ?? "" : extractStringValue(task, "defaultBranch") ?? "",
    title: extractStringValue(task, "title") ?? "",
    pool: assignment ? extractStringValue(assignment, "pool") ?? extractStringValue(task, "pool") ?? "" : extractStringValue(task, "pool") ?? "",
    originalBranchName,
    allowedPaths: Array.isArray(assignment?.allowedPaths) ? (assignment.allowedPaths as string[]) : Array.isArray(task?.allowedPaths) ? (task.allowedPaths as string[]) : [],
    acceptance: Array.isArray(task.acceptance) ? (task.acceptance as string[]) : [],
    targetWorkerId: assignment ? extractStringValue(assignment, "targetWorkerId") ?? extractStringValue(assignment, "workerId") : null,
    workerPrompt: extractStringValue(assignmentRecord, "workerPrompt") ?? "You are a ForgeFlow worker. Stay within allowedPaths and satisfy acceptance.",
    contextMarkdown: extractStringValue(assignmentRecord, "contextMarkdown") ?? "# Context\n\nComplete the assigned task within scope.",
  };
}

function generateRedriveBranchName(originalBranchName: string): string {
  const shortId = randomUUID().slice(0, 8);
  return `${originalBranchName}-redrive-${shortId}`;
}

function buildRedrivePayload(
  fields: RecoverableTaskFields,
  newTaskId: string,
  newBranchName: string,
  originalTaskId: string,
  reworkNotes?: string | null,
): DispatchInput {
  const allowedPaths = fields.allowedPaths.join(",");
  const acceptance = fields.acceptance.join(",");

  let workerPrompt = fields.workerPrompt;
  let contextMarkdown = fields.contextMarkdown;

  if (reworkNotes) {
    const reworkSection = `\n\n## Rework Notes\n\n${reworkNotes}`;
    workerPrompt = workerPrompt + reworkSection;
    contextMarkdown = contextMarkdown + reworkSection;
  }

  return buildSingleTaskDispatchInput({
    repo: fields.repo,
    defaultBranch: fields.defaultBranch,
    taskId: newTaskId,
    title: fields.title,
    pool: fields.pool,
    branchName: newBranchName,
    allowedPaths,
    acceptance,
    targetWorkerId: fields.targetWorkerId ?? undefined,
    workerPrompt,
    contextMarkdown,
    continuationMode: "continue",
    continueFromTaskId: originalTaskId,
  });
}

export async function runRedrive(options: RedriveOptions): Promise<RedriveResult> {
  const client = createJsonHttpClient(options.dispatcherUrl, {
    fetchImpl: options.fetchImpl,
  });

  const snapshot = await client.request("/api/dashboard/snapshot") as Record<string, unknown>;

  const tasks = (snapshot.tasks as Array<Record<string, unknown>>) ?? [];
  const task = tasks.find((t) => t.id === options.taskId);
  if (!task) {
    throw new Error(`task not found: ${options.taskId}`);
  }

  const assignments = (snapshot.assignments as Array<Record<string, unknown>>) ?? [];
  const assignment = assignments.find((a) => a.taskId === options.taskId) ?? null;

  const events = ((snapshot.events as Array<Record<string, unknown>>) ?? []).filter(
    (e) => e.taskId === options.taskId,
  );

  const reviews = (snapshot.reviews as Array<Record<string, unknown>>) ?? [];

  const { status, failureSummary } = extractTaskFailureInfo(task, events, reviews);

  let redriveReason: string;
  let latestReview: { decision: string | null; notes: string | null; reviewRecord: Record<string, unknown> | null } | null = null;

  if (status === "failed") {
    if (!failureSummary) {
      throw new Error(`task ${options.taskId} has no failure summary to analyze`);
    }
    const failureType = findFailureType(failureSummary);
    if (!failureType) {
      throw new Error(
        `task ${options.taskId} failed for a non-redriveable reason: ${failureSummary.slice(0, 100)}`,
      );
    }
    redriveReason = failureSummary.slice(0, 200);
  } else if (status === "blocked") {
    latestReview = extractLatestReviewDecision(reviews, options.taskId);
    if (!latestReview.decision) {
      throw new Error(
        `task ${options.taskId} is blocked but has no review decision`,
      );
    }
    if (latestReview.decision !== "rework") {
      throw new Error(
        `task ${options.taskId} is blocked but latest review decision is "${latestReview.decision}" (only "rework" is redriveable)`,
      );
    }

    const latestReviewEvidence = latestReview.reviewRecord?.evidence as Record<string, unknown> | null;
    const mustFix = extractArrayOfStrings(latestReviewEvidence?.mustFix);
    const reasonCode =
      typeof latestReviewEvidence?.reasonCode === "string" ? latestReviewEvidence.reasonCode : null;
    const canRedrive =
      typeof latestReviewEvidence?.canRedrive === "boolean" ? latestReviewEvidence.canRedrive : null;

    if (canRedrive === false) {
      throw new Error(`task ${options.taskId} latest review explicitly disabled redrive`);
    }

    if (mustFix.length > 0) {
      redriveReason = `rework: ${mustFix.join("; ")}`;
    } else if (reasonCode) {
      redriveReason = `rework: ${reasonCode}`;
    } else {
      redriveReason = `rework: ${latestReview.notes ?? "no notes"}`;
    }
  } else {
    throw new Error(
      `task ${options.taskId} is in "${status}" state and is not redriveable (only "failed" and "blocked" with rework are redriveable)`,
    );
  }

  const fields = recoverFieldsFromTask(task, assignment);
  const newTaskId = `redrive-${randomUUID().slice(0, 8)}`;
  const newBranchName = generateRedriveBranchName(fields.originalBranchName);

  let reworkNotes: string | null = null;
  if (status === "blocked" && latestReview) {
    const latestReviewEvidence = latestReview.reviewRecord?.evidence as Record<string, unknown> | null;
    const mustFixForNotes = extractArrayOfStrings(latestReviewEvidence?.mustFix);
    if (mustFixForNotes.length > 0) {
      reworkNotes = mustFixForNotes.join("; ");
    } else {
      reworkNotes = latestReview.notes;
    }
  }
  const payload = buildRedrivePayload(fields, newTaskId, newBranchName, options.taskId, reworkNotes);

  const dispatchResult = await runDispatch({
    dispatcherUrl: options.dispatcherUrl,
    input: "-",
    payload,
    requestTimeoutMs: 30_000,
    fetchImpl: options.fetchImpl,
  }) as DispatchResult;

  const realTaskIds = dispatchResult.taskIds;
  if (!realTaskIds || realTaskIds.length === 0) {
    throw new Error(`dispatch response missing taskIds for redrive of ${options.taskId}`);
  }

  return {
    originalTaskId: options.taskId,
    newTaskId: realTaskIds[0],
    targetWorkerId: fields.targetWorkerId,
    failureSummary: redriveReason,
    continuationMode: "continue",
    continueFromTaskId: options.taskId,
  };
}

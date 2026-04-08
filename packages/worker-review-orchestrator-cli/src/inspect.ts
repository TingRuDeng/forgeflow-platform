import path from "node:path";

import type { InspectOptions, InspectResult, InspectSummaryResult } from "./types.js";

import { createJsonHttpClient, loadRuntimeState } from "./http.js";
import { loadLocalSnapshot } from "./local-dispatcher.js";
import { buildInspectSummaryFromSnapshot } from "./summary.js";
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
    try {
      snapshot = await loadLocalSnapshot(path.resolve(options.stateDir));
    } catch {
      const state = loadRuntimeState(path.resolve(options.stateDir));
      snapshot = state as unknown as Record<string, unknown>;
    }
  } else {
    throw new Error("dispatcherUrl or stateDir is required");
  }

  const task = findTask(snapshot as { tasks?: Array<Record<string, unknown>> }, options.taskId);

  if (!task) {
    throw new Error(`task not found: ${options.taskId}`);
  }

  if (options.summary) {
    return buildInspectSummaryFromSnapshot(snapshot, options.taskId);
  }

  const assignment = findAssignment(snapshot as { assignments?: Array<Record<string, unknown>> }, options.taskId);
  const reviews = findReviews(snapshot as { reviews?: Array<Record<string, unknown>> }, options.taskId);
  const pullRequest = findPullRequest(snapshot as { pullRequests?: Array<Record<string, unknown>> }, options.taskId);
  const events = findEvents(snapshot as { events?: Array<Record<string, unknown>> }, options.taskId);

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

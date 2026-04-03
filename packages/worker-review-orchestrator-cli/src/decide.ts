import path from "node:path";

import type { DecideOptions, DecideResult, LocalRuntimeState } from "./types.js";

import { createJsonHttpClient, createEmptyRuntimeState, loadRuntimeState, saveRuntimeState } from "./http.js";

function normalizeDecision(decision: DecideOptions["decision"]) {
  if (decision === "merge") {
    return "merge" as const;
  }
  return "block" as const;
}

function readNowIso() {
  return new Date().toISOString();
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

function buildLocalDecisionState(state: LocalRuntimeState, input: DecideOptions & { decision: "merge" | "block" }) {
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

  const nextReviews = upsertByTaskId(state.reviews, {
    taskId: input.taskId,
    decision: input.decision,
    actor: input.actor ?? "codex-control",
    notes: input.notes ?? "",
    decidedAt: at,
  });

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
  const payload = {
    actor: options.actor ?? "codex-control",
    decision,
    notes: options.notes ?? "",
    at: options.at ?? readNowIso(),
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

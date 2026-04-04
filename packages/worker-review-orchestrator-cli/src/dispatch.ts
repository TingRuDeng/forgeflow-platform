import type { DispatchInput, DispatchResult, DispatchTaskInputOptions } from "./types.js";

import { createJsonHttpClient, readJsonInput } from "./http.js";
import { readFileSync } from "node:fs";

export interface DispatchOptions {
  dispatcherUrl: string;
  input: string;
  payload?: DispatchInput;
  targetWorkerId?: string;
  requireExistingWorker?: boolean;
  requestTimeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
  readStdin?: () => Promise<string>;
  followUpOfTaskId?: string;
  workerChangeReason?: string;
}

export async function loadDispatchInput(source: string, readStdin?: () => Promise<string>) {
  return readJsonInput(source, { readStdin }) as Promise<DispatchInput>;
}

function splitCsv(input?: string) {
  return String(input || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasPlaceholderValue(input?: string) {
  return /<[^>\n]+>/.test(String(input || ""));
}

function buildStructuredContextMarkdown(options: DispatchTaskInputOptions): string | undefined {
  const goal = String(options.goal || "").trim();
  const sourceOfTruth = splitCsv(options.sourceOfTruth);
  const disallowedPaths = splitCsv(options.disallowedPaths);
  const requiredChanges = splitCsv(options.requiredChanges);
  const nonGoals = splitCsv(options.nonGoals);
  const mustPreserve = splitCsv(options.mustPreserve);
  const reworkMapping = splitCsv(options.reworkMapping);
  const allowedPaths = splitCsv(options.allowedPaths);
  const acceptance = splitCsv(options.acceptance);

  const hasStructuredFields = Boolean(
    goal
    || sourceOfTruth.length
    || disallowedPaths.length
    || requiredChanges.length
    || nonGoals.length
    || mustPreserve.length
    || reworkMapping.length,
  );
  if (!hasStructuredFields) {
    return undefined;
  }

  const lines = [
    "# Goal",
    goal || options.title,
    "",
    "# Source of Truth",
    ...(sourceOfTruth.length > 0 ? sourceOfTruth.map((item) => `- ${item}`) : ["- (not provided)"]),
    "",
    "# Allowed Paths",
    ...(allowedPaths.length > 0 ? allowedPaths.map((item) => `- ${item}`) : ["- (none)"]),
    "",
  ];

  if (disallowedPaths.length > 0) {
    lines.push("# Disallowed Paths", ...disallowedPaths.map((item) => `- ${item}`), "");
  }

  lines.push(
    "# Required Changes",
    ...(requiredChanges.length > 0 ? requiredChanges.map((item, index) => `${index + 1}. ${item}`) : ["1. (not provided)"]),
    "",
    "# Non-Goals",
    ...(nonGoals.length > 0 ? nonGoals.map((item) => `- ${item}`) : ["- (not provided)"]),
    "",
    "# Must Preserve",
    ...(mustPreserve.length > 0 ? mustPreserve.map((item) => `- ${item}`) : ["- (not provided)"]),
    "",
    "# Acceptance",
    ...(acceptance.length > 0 ? acceptance.map((item) => `- Run: ${item}`) : ["- Run: (not provided)"]),
  );

  if (reworkMapping.length > 0) {
    lines.push("", "# Rework Mapping", ...reworkMapping.map((item) => `- ${item}`));
  }

  return lines.join("\n").trim();
}

function validateStrictTaskSpec(options: DispatchTaskInputOptions): void {
  if (options.strictTaskSpec !== true) {
    return;
  }

  const requiredFields = [
    { name: "goal", value: options.goal },
    { name: "source-of-truth", value: options.sourceOfTruth },
    { name: "required-changes", value: options.requiredChanges },
    { name: "non-goals", value: options.nonGoals },
    { name: "must-preserve", value: options.mustPreserve },
  ];

  const missing = requiredFields
    .filter((field) => String(field.value || "").trim().length === 0)
    .map((field) => `--${field.name}`);
  if (missing.length > 0) {
    throw new Error(`strict task spec is missing required fields: ${missing.join(", ")}`);
  }

  const placeholderFields = requiredFields
    .filter((field) => hasPlaceholderValue(field.value))
    .map((field) => `--${field.name}`);
  if (placeholderFields.length > 0) {
    throw new Error(`strict task spec still contains placeholder values in: ${placeholderFields.join(", ")}`);
  }
}

function readFileContent(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return undefined;
  }
}

export function buildSingleTaskDispatchInput(options: DispatchTaskInputOptions): DispatchInput {
  validateStrictTaskSpec(options);

  const targetWorkerId = String(options.targetWorkerId || "").trim() || undefined;
  const followUpOfTaskId = String(options.followUpOfTaskId || "").trim() || undefined;
  const workerChangeReason = String(options.workerChangeReason || "").trim() || undefined;
  const allowedPaths = splitCsv(options.allowedPaths);
  const acceptance = splitCsv(options.acceptance);
  const dependsOn = splitCsv(options.dependsOn);

  const workerPromptFromFile = readFileContent(options.workerPromptFile);
  const contextMarkdownFromFile = readFileContent(options.contextMarkdownFile);
  const structuredContextMarkdown = buildStructuredContextMarkdown(options);

  const workerPrompt = workerPromptFromFile || options.workerPrompt || "You are a ForgeFlow worker. Stay within allowedPaths and satisfy acceptance.";
  const contextMarkdown = contextMarkdownFromFile || options.contextMarkdown || structuredContextMarkdown || "# Context\n\nComplete the assigned task within scope.";

  return {
    repo: options.repo,
    defaultBranch: options.defaultBranch,
    requestedBy: options.requestedBy || "codex-control",
    tasks: [
      {
        id: options.taskId,
        title: options.title,
        pool: options.pool,
        allowedPaths,
        acceptance,
        dependsOn,
        branchName: options.branchName,
        verification: {
          mode: String(options.verificationMode || "run"),
        },
        ...(targetWorkerId ? { targetWorkerId } : {}),
        ...(options.continuationMode ? { continuationMode: options.continuationMode } : {}),
        ...(options.continueFromTaskId ? { continueFromTaskId: options.continueFromTaskId } : {}),
        ...(followUpOfTaskId ? { followUpOfTaskId } : {}),
        ...(workerChangeReason ? { workerChangeReason } : {}),
      },
    ],
    packages: [
      {
        taskId: options.taskId,
        assignment: {
          taskId: options.taskId,
          workerId: null,
          pool: options.pool,
          status: "pending",
          branchName: options.branchName,
          allowedPaths,
          repo: options.repo,
          defaultBranch: options.defaultBranch,
          ...(targetWorkerId ? { targetWorkerId } : {}),
          ...(options.continuationMode ? { continuationMode: options.continuationMode } : {}),
          ...(options.continueFromTaskId ? { continueFromTaskId: options.continueFromTaskId } : {}),
          ...(followUpOfTaskId ? { followUpOfTaskId } : {}),
          ...(workerChangeReason ? { workerChangeReason } : {}),
        },
        workerPrompt,
        contextMarkdown,
      },
    ],
  };
}

function applyTargetWorkerToRecords(records: Array<Record<string, unknown>>, targetWorkerId: string) {
  return records.map((record) => ({
    ...record,
    targetWorkerId,
    target_worker_id: targetWorkerId,
  }));
}

export function applyDispatchTargetWorker(payload: DispatchInput, targetWorkerId?: string): DispatchInput {
  const normalizedTargetWorkerId = String(targetWorkerId || "").trim();
  if (!normalizedTargetWorkerId) {
    return payload;
  }

  return {
    ...payload,
    tasks: applyTargetWorkerToRecords(payload.tasks, normalizedTargetWorkerId),
    packages: applyTargetWorkerToRecords(payload.packages, normalizedTargetWorkerId),
  };
}

interface SnapshotWorkerRecord {
  id?: unknown;
  pool?: unknown;
  status?: unknown;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isOnlineWorkerStatus(status: unknown) {
  return status === "idle" || status === "busy";
}

function formatWorkerInventory(workers: SnapshotWorkerRecord[]) {
  if (workers.length === 0) {
    return "none";
  }

  return workers.map((worker) => {
    const id = normalizeString(worker.id) || "<unknown>";
    const pool = normalizeString(worker.pool) || "<unknown-pool>";
    const status = normalizeString(worker.status) || "<unknown-status>";
    return `${id}(${pool},${status})`;
  }).join(", ");
}

interface SourceTaskInfo {
  taskId: string;
  originalWorkerId: string | null;
}

async function ensureExistingWorkersAvailable(
  payload: DispatchInput,
  options: Pick<DispatchOptions, "dispatcherUrl" | "fetchImpl" | "requestTimeoutMs">,
) {
  const client = createJsonHttpClient(options.dispatcherUrl, {
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const snapshot = await client.request("/api/dashboard/snapshot") as Record<string, unknown>;
  const workers = Array.isArray(snapshot.workers) ? snapshot.workers as SnapshotWorkerRecord[] : [];
  const onlineWorkers = workers.filter((worker) => isOnlineWorkerStatus(worker.status));

  if (onlineWorkers.length === 0) {
    throw new Error(
      `require-existing-worker check failed: dispatcher snapshot has no online workers. Snapshot workers: ${formatWorkerInventory(workers)}`,
    );
  }

  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const targetWorkerIds = [...new Set(tasks.map((task) =>
    normalizeString(task.targetWorkerId) || normalizeString(task.target_worker_id),
  ).filter((value): value is string => Boolean(value)))];

  if (targetWorkerIds.length > 0) {
    for (const targetWorkerId of targetWorkerIds) {
      const matchedWorker = onlineWorkers.find((worker) => normalizeString(worker.id) === targetWorkerId);
      if (!matchedWorker) {
        throw new Error(
          `require-existing-worker check failed: target worker "${targetWorkerId}" is not online. Online workers: ${formatWorkerInventory(onlineWorkers)}`,
        );
      }
    }
    return;
  }

  const requiredPools = [...new Set(tasks.map((task) => normalizeString(task.pool)).filter((value): value is string => Boolean(value)))];
  if (requiredPools.length === 0) {
    throw new Error(
      "require-existing-worker check failed: every dispatch task must declare a pool or targetWorkerId",
    );
  }

  for (const pool of requiredPools) {
    const hasOnlineWorker = onlineWorkers.some((worker) => normalizeString(worker.pool) === pool);
    if (!hasOnlineWorker) {
      throw new Error(
        `require-existing-worker check failed: no online worker available for pool "${pool}". Online workers: ${formatWorkerInventory(onlineWorkers)}`,
      );
    }
  }
}

async function fetchSourceTask(
  followUpOfTaskId: string,
  options: Pick<DispatchOptions, "dispatcherUrl" | "fetchImpl" | "requestTimeoutMs">,
): Promise<SourceTaskInfo> {
  const client = createJsonHttpClient(options.dispatcherUrl, {
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const snapshot = await client.request("/api/dashboard/snapshot") as Record<string, unknown>;

  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks as Array<Record<string, unknown>> : [];
  const sourceTask = tasks.find((task) => task.id === followUpOfTaskId);
  if (!sourceTask) {
    throw new Error(`source task not found: ${followUpOfTaskId}`);
  }

  const assignments = Array.isArray(snapshot.assignments) ? snapshot.assignments as Array<Record<string, unknown>> : [];
  const assignment = assignments.find((item) => item.taskId === followUpOfTaskId);
  const assignmentRecord = assignment && typeof assignment.assignment === "object" && assignment.assignment
    ? assignment.assignment as Record<string, unknown>
    : null;

  const originalWorkerId = normalizeString(sourceTask.lastAssignedWorkerId)
    ?? normalizeString(sourceTask.assignedWorkerId)
    ?? normalizeString(assignmentRecord?.targetWorkerId)
    ?? normalizeString(assignmentRecord?.workerId)
    ?? normalizeString(assignment?.workerId)
    ?? null;

  return {
    taskId: followUpOfTaskId,
    originalWorkerId,
  };
}

function verifyTargetWorkerMatch(
  sourceTaskInfo: SourceTaskInfo,
  targetWorkerId: string | undefined,
  workerChangeReason: string | undefined,
): void {
  if (!sourceTaskInfo.originalWorkerId || !targetWorkerId) {
    return;
  }

  if (targetWorkerId !== sourceTaskInfo.originalWorkerId && !workerChangeReason) {
    throw new Error(
      `target worker mismatch: source task "${sourceTaskInfo.taskId}" was assigned to worker "${sourceTaskInfo.originalWorkerId}", but target worker is "${targetWorkerId}". `
      + "To change the worker, you must provide a --worker-change-reason explaining why.",
    );
  }
}

function verifyDispatchAssignment(
  dispatchResult: DispatchResult,
  intendedWorkerId: string | undefined,
): void {
  if (!intendedWorkerId || !Array.isArray(dispatchResult.assignments)) {
    return;
  }

  for (const assignment of dispatchResult.assignments) {
    const record = assignment as Record<string, unknown>;
    const assignedWorkerId = normalizeString(record.workerId)
      ?? normalizeString(record.targetWorkerId)
      ?? normalizeString(record.target_worker_id);
    if (assignedWorkerId && assignedWorkerId !== intendedWorkerId) {
      throw new Error(
        `dispatch verification failed: expected worker "${intendedWorkerId}" but dispatcher assigned worker "${assignedWorkerId}"`,
      );
    }
  }
}

export async function runDispatch(options: DispatchOptions): Promise<DispatchResult> {
  if (options.followUpOfTaskId) {
    const sourceTaskInfo = await fetchSourceTask(options.followUpOfTaskId, options);
    verifyTargetWorkerMatch(sourceTaskInfo, options.targetWorkerId, options.workerChangeReason);
  }

  const payload = options.payload
    ? applyDispatchTargetWorker(options.payload, options.targetWorkerId)
    : applyDispatchTargetWorker(
        await loadDispatchInput(options.input, options.readStdin),
        options.targetWorkerId,
      );

  if (options.requireExistingWorker) {
    await ensureExistingWorkersAvailable(payload, options);
  }

  const client = createJsonHttpClient(options.dispatcherUrl, {
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  const dispatchResult = await client.request("/api/dispatches", {
    method: "POST",
    body: payload,
  }) as DispatchResult;

  verifyDispatchAssignment(dispatchResult, options.targetWorkerId);

  return dispatchResult;
}

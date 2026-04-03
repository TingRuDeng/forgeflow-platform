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
  const targetWorkerId = String(options.targetWorkerId || "").trim() || undefined;
  const allowedPaths = splitCsv(options.allowedPaths);
  const acceptance = splitCsv(options.acceptance);
  const dependsOn = splitCsv(options.dependsOn);

  const workerPromptFromFile = readFileContent(options.workerPromptFile);
  const contextMarkdownFromFile = readFileContent(options.contextMarkdownFile);

  const workerPrompt = workerPromptFromFile || options.workerPrompt || "You are a ForgeFlow worker. Stay within allowedPaths and satisfy acceptance.";
  const contextMarkdown = contextMarkdownFromFile || options.contextMarkdown || "# Context\n\nComplete the assigned task within scope.";

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

export async function runDispatch(options: DispatchOptions): Promise<DispatchResult> {
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

  return client.request("/api/dispatches", {
    method: "POST",
    body: payload,
  }) as Promise<DispatchResult>;
}

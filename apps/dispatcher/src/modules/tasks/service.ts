import type { TaskEvent } from "@forgeflow/task-schema";

import { TaskEventService } from "../events/service.js";

export type DispatcherTaskStatus =
  | "planned"
  | "ready"
  | "assigned"
  | "in_progress"
  | "partial_success"
  | "expired"
  | "review"
  | "merged"
  | "blocked"
  | "failed";

export interface DispatcherTask {
  id: string;
  repo: string;
  title: string;
  pool: "codex" | "gemini";
  allowedPaths: string[];
  acceptance: string[];
  dependsOn: string[];
  status: DispatcherTaskStatus;
}

const VALID_TRANSITIONS: Record<DispatcherTaskStatus, DispatcherTaskStatus[]> = {
  planned: ["ready"],
  ready: ["assigned", "blocked"],
  assigned: ["in_progress", "blocked"],
  in_progress: ["partial_success", "expired", "review", "failed", "blocked"],
  partial_success: [],
  expired: [],
  review: ["merged", "blocked", "failed"],
  merged: [],
  blocked: ["ready", "failed"],
  failed: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

export class TaskService {
  private readonly tasks = new Map<string, DispatcherTask>();

  constructor(private readonly events: TaskEventService) {}

  create(task: DispatcherTask): void {
    this.tasks.set(task.id, task);
    this.record({
      taskId: task.id,
      type: "created",
      at: nowIso(),
      payload: { status: task.status },
    });
  }

  get(taskId: string): DispatcherTask | undefined {
    return this.tasks.get(taskId);
  }

  transition(taskId: string, nextStatus: DispatcherTaskStatus): void {
    const current = this.tasks.get(taskId);
    if (!current) {
      throw new Error(`task not found: ${taskId}`);
    }

    const allowed = VALID_TRANSITIONS[current.status];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`illegal transition ${current.status} -> ${nextStatus}`);
    }

    const updated: DispatcherTask = {
      ...current,
      status: nextStatus,
    };
    this.tasks.set(taskId, updated);

    this.record({
      taskId,
      type: "status_changed",
      at: nowIso(),
      payload: {
        from: current.status,
        to: nextStatus,
      },
    });
  }

  private record(event: TaskEvent): void {
    this.events.append(event);
  }
}

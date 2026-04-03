import type { TaskEvent } from "@forgeflow/task-schema";

export class TaskEventService {
  private readonly events = new Map<string, TaskEvent[]>();

  append(event: TaskEvent): void {
    const existing = this.events.get(event.taskId) ?? [];
    existing.push(event);
    this.events.set(event.taskId, existing);
  }

  listByTask(taskId: string): TaskEvent[] {
    return [...(this.events.get(taskId) ?? [])];
  }
}

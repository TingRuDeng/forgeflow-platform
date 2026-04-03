import { TaskService } from "../tasks/service.js";
import { WorkerService } from "../workers/service.js";

const roundRobinOffsets = new Map<string, number>();

export class DispatchService {
  constructor(
    private readonly workers: WorkerService,
    private readonly tasks: TaskService,
  ) {}

  selectWorkerForTask(pool: "codex" | "gemini") {
    const idleWorkers = this.workers
      .listByPool(pool)
      .filter((worker) => worker.status === "idle" && !worker.disabledAt)
      .sort((left, right) => {
        const timeCompare = left.lastHeartbeatAt.localeCompare(right.lastHeartbeatAt);
        if (timeCompare !== 0) {
          return timeCompare;
        }
        return left.id.localeCompare(right.id);
      });

    if (idleWorkers.length === 0) {
      return undefined;
    }

    const oldestTimestamp = idleWorkers[0]?.lastHeartbeatAt;
    const oldestGroup = idleWorkers.filter(
      (worker) => worker.lastHeartbeatAt === oldestTimestamp,
    );

    const offset = roundRobinOffsets.get(pool) ?? 0;
    const selected = oldestGroup[offset % oldestGroup.length];
    roundRobinOffsets.set(pool, (offset + 1) % oldestGroup.length);

    return selected;
  }

  assignReadyTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }
    if (task.status !== "ready") {
      throw new Error(`task not ready: ${taskId}`);
    }

    const worker = this.selectWorkerForTask(task.pool);
    if (!worker) {
      return undefined;
    }

    this.tasks.transition(taskId, "assigned");
    this.workers.assign(worker.id, taskId);

    return {
      taskId,
      workerId: worker.id,
    };
  }
}

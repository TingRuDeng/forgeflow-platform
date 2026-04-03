import type { Worker } from "@forgeflow/task-schema";

export class WorkerService {
  private readonly workers = new Map<string, Worker>();

  register(worker: Worker): void {
    this.workers.set(worker.id, worker);
  }

  heartbeat(workerId: string, at: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`worker not found: ${workerId}`);
    }

    this.workers.set(workerId, {
      ...worker,
      lastHeartbeatAt: at,
    });
  }

  get(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  listByPool(pool: Worker["pool"]): Worker[] {
    return [...this.workers.values()].filter((worker) => worker.pool === pool);
  }

  assign(workerId: string, taskId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`worker not found: ${workerId}`);
    }

    this.workers.set(workerId, {
      ...worker,
      status: "busy",
      currentTaskId: taskId,
    });
  }

  complete(workerId: string, at: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`worker not found: ${workerId}`);
    }

    this.workers.set(workerId, {
      id: worker.id,
      pool: worker.pool,
      status: "idle",
      lastHeartbeatAt: at,
    });
  }

  disable(workerId: string, disabledBy?: string | null, at?: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`worker not found: ${workerId}`);
    }

    this.workers.set(workerId, {
      ...worker,
      status: "disabled",
      disabledAt: at ?? new Date().toISOString(),
      disabledBy: disabledBy ?? undefined,
    });
  }

  enable(workerId: string, at?: string): void{
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`worker not found: ${workerId}`);
    }

    this.workers.set(workerId, {
      ...worker,
      status: "idle",
      disabledAt: undefined,
      disabledBy: undefined,
      lastHeartbeatAt: at ?? new Date().toISOString(),
    });
  }
}

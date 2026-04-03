import type { ReviewMaterialInput } from "../review/service.js";
import type { WorkerExecutionResult } from "../runtime/types.js";
import type { DispatcherTask } from "../tasks/service.js";
import type { Worker } from "@forgeflow/task-schema";

import { ReviewService } from "../review/service.js";
import { TaskService } from "../tasks/service.js";
import { WorkerService } from "../workers/service.js";

export interface ProcessWorkerResultInput {
  result: WorkerExecutionResult;
  changedFiles?: string[];
}

export interface ProcessWorkerResultOutput {
  task: DispatcherTask;
  worker: Worker;
  reviewMaterial?: ReviewMaterialInput;
}

export class ExecutionService {
  constructor(
    private readonly tasks: TaskService,
    private readonly workers: WorkerService,
    private readonly review: ReviewService,
  ) {}

  processWorkerResult(
    input: ProcessWorkerResultInput,
  ): ProcessWorkerResultOutput {
    const task = this.tasks.get(input.result.taskId);
    if (!task) {
      throw new Error(`task not found: ${input.result.taskId}`);
    }

    if (task.status === "assigned") {
      this.tasks.transition(task.id, "in_progress");
    } else if (task.status !== "in_progress") {
      throw new Error(`task is not executing: ${task.id}`);
    }

    let reviewMaterial: ReviewMaterialInput | undefined;
    if (input.result.verification.allPassed) {
      reviewMaterial = this.review.collectReviewMaterial({
        repo: input.result.repo,
        title: task.title,
        changedFiles: input.changedFiles ?? [],
        selfTestPassed: true,
        checks: input.result.verification.commands.map((item) => item.command),
      });
      this.tasks.transition(task.id, "review");
    } else {
      this.tasks.transition(task.id, "failed");
    }

    this.workers.complete(input.result.workerId, input.result.generatedAt);

    const updatedTask = this.tasks.get(task.id);
    const updatedWorker = this.workers.get(input.result.workerId);

    if (!updatedTask) {
      throw new Error(`task not found after processing: ${task.id}`);
    }
    if (!updatedWorker) {
      throw new Error(`worker not found after processing: ${input.result.workerId}`);
    }

    return {
      task: updatedTask,
      worker: updatedWorker,
      reviewMaterial,
    };
  }
}

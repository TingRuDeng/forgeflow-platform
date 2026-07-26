import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKER_EXECUTION_TIMEOUT_MS,
  WorkerResultDeliveryError,
  resolveManagedWorkerTaskRetryPolicy,
  resolveWorkerExecutionTimeoutMs,
  submitFailedWorkerResult,
} from "../src/runtime/worker-daemon.js";

describe("managed worker task processor", () => {
  it("resolves submit-result retry policy inside beta-runtime-core", () => {
    expect(resolveManagedWorkerTaskRetryPolicy({})).toEqual({
      maxFailedResultRetries: 3,
      failedResultRetryDelayMs: 2_000,
    });
    expect(resolveManagedWorkerTaskRetryPolicy({
      WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES: "5",
      WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS: "250",
    })).toEqual({
      maxFailedResultRetries: 5,
      failedResultRetryDelayMs: 250,
    });
    expect(resolveManagedWorkerTaskRetryPolicy({
      WORKER_DAEMON_SUBMIT_RESULT_MAX_RETRIES: "0",
      WORKER_DAEMON_SUBMIT_RESULT_RETRY_DELAY_MS: "NaN",
    })).toEqual({
      maxFailedResultRetries: 3,
      failedResultRetryDelayMs: 2_000,
    });
  });

  it("resolves a bounded worker assignment execution timeout", () => {
    expect(resolveWorkerExecutionTimeoutMs({})).toBe(DEFAULT_WORKER_EXECUTION_TIMEOUT_MS);
    expect(resolveWorkerExecutionTimeoutMs({
      WORKER_DAEMON_EXECUTION_TIMEOUT_MS: "45000",
    })).toBe(45_000);
    expect(resolveWorkerExecutionTimeoutMs({
      WORKER_DAEMON_EXECUTION_TIMEOUT_MS: "0",
    })).toBe(DEFAULT_WORKER_EXECUTION_TIMEOUT_MS);
    expect(resolveWorkerExecutionTimeoutMs({
      WORKER_DAEMON_EXECUTION_TIMEOUT_MS: "not-a-number",
    })).toBe(DEFAULT_WORKER_EXECUTION_TIMEOUT_MS);
  });

  it("surfaces exhausted failed-result delivery attempts", async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-failed-result-"));
    const onFallbackFailed = vi.fn();
    const submitResult = vi.fn().mockRejectedValue(new Error("dispatcher unavailable"));
    try {
      await expect(submitFailedWorkerResult({
        input: {
          client: { submitResult },
          workerId: "codex-worker",
          repoDir,
          payload: {
            task: {
              id: "task-1",
              title: "task",
              repo: "test/repo",
            },
            assignment: {
              taskId: "task-1",
              pool: "codex",
              branchName: "codex/task-1",
              repo: "test/repo",
              defaultBranch: "main",
            },
            attemptId: "attempt-1",
            leaseToken: "lease-1",
            protocolVersion: "2026-05-v1",
            traceId: "trace-1",
            idempotencyKey: "worker-v1:task-1:attempt-1",
          },
        } as any,
        error: new Error("task execution failed"),
        maxRetries: 2,
        retryDelayMs: 0,
        onFallbackFailed,
      })).rejects.toBeInstanceOf(WorkerResultDeliveryError);

      expect(submitResult).toHaveBeenCalledTimes(2);
      expect(onFallbackFailed).toHaveBeenCalledWith({
        taskId: "task-1",
        error: expect.stringContaining("after 2 attempts"),
      });
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

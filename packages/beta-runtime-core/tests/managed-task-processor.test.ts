import { describe, expect, it } from "vitest";

import { resolveManagedWorkerTaskRetryPolicy } from "../src/runtime/worker-daemon.js";

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
  });
});

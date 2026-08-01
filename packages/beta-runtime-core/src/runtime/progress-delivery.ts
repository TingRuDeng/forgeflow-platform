import {
  retryDispatcherRequest,
  snapshotDispatcherPayload,
  type DispatcherRetryPolicy,
  type RetryDispatcherRequestInput,
} from "./dispatcher-request-retry.js";

export const DEFAULT_PROGRESS_DELIVERY_MAX_ATTEMPTS = 3;
export const DEFAULT_PROGRESS_DELIVERY_RETRY_DELAY_MS = 1_000;

export type ProgressDeliveryPolicy = DispatcherRetryPolicy;

export type RetryProgressDeliveryInput<T> = Omit<
  RetryDispatcherRequestInput<T>,
  "operation"
>;

export function snapshotProgressPayload<T>(payload: T): T {
  return snapshotDispatcherPayload(payload);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveProgressDeliveryPolicy(
  env: NodeJS.ProcessEnv = process.env,
): ProgressDeliveryPolicy {
  return {
    maxAttempts: readPositiveInteger(
      env.WORKER_PROGRESS_MAX_ATTEMPTS,
      DEFAULT_PROGRESS_DELIVERY_MAX_ATTEMPTS,
    ),
    retryDelayMs: readNonNegativeInteger(
      env.WORKER_PROGRESS_RETRY_DELAY_MS,
      DEFAULT_PROGRESS_DELIVERY_RETRY_DELAY_MS,
    ),
  };
}

export async function retryProgressDelivery<T>(
  input: RetryProgressDeliveryInput<T>,
): Promise<T> {
  return retryDispatcherRequest({
    ...input,
    operation: "progress delivery",
  });
}

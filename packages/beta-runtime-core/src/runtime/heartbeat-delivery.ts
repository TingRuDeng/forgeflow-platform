import {
  retryDispatcherRequest,
  snapshotDispatcherPayload,
  type DispatcherRetryPolicy,
  type RetryDispatcherRequestInput,
} from "./dispatcher-request-retry.js";

export const DEFAULT_HEARTBEAT_DELIVERY_MAX_ATTEMPTS = 4;
export const DEFAULT_HEARTBEAT_DELIVERY_RETRY_DELAY_MS = 1_000;

export type RetryHeartbeatDeliveryInput<T> = Omit<
  RetryDispatcherRequestInput<T>,
  "operation" | "maxAttempts" | "retryDelayMs"
> & Partial<DispatcherRetryPolicy>;

export function snapshotHeartbeatPayload<T>(payload: T): T {
  return snapshotDispatcherPayload(payload);
}

export async function retryHeartbeatDelivery<T>(
  input: RetryHeartbeatDeliveryInput<T>,
): Promise<T> {
  const {
    maxAttempts = DEFAULT_HEARTBEAT_DELIVERY_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_HEARTBEAT_DELIVERY_RETRY_DELAY_MS,
    ...request
  } = input;
  return retryDispatcherRequest({
    ...request,
    operation: "heartbeat delivery",
    maxAttempts,
    retryDelayMs,
  });
}

export interface SingleFlightIntervalInput {
  intervalMs: number;
  run: () => Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

export function startSingleFlightInterval(input: SingleFlightIntervalInput): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const intervalMs = Number.isSafeInteger(input.intervalMs) && input.intervalMs > 0
    ? input.intervalMs
    : 1;

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      inFlight = (async () => {
        try {
          await input.run();
        } catch (error) {
          try {
            await input.onError?.(error);
          } catch {
            // Heartbeat diagnostics must not terminate the task lifecycle.
          }
        }
      })().finally(() => {
        inFlight = null;
        schedule();
      });
    }, intervalMs);
    timer.unref?.();
  };

  schedule();

  return async () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await inFlight;
  };
}

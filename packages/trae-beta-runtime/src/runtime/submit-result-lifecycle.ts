export interface SubmitResultLifecycleInput<Request> {
  taskId: string;
  sessionId: string | null;
  status: string;
  startPayload: Record<string, unknown>;
  startDebug: Record<string, unknown>;
  request: Request;
  donePayload: Record<string, unknown>;
  emitPhaseEvent: (type: string, payload: Record<string, unknown>, taskId: string) => Promise<void>;
  debugLog: (event: string, payload: Record<string, unknown>) => void;
  submitResult: (request: Request) => Promise<unknown>;
  promoteToIdle: () => void;
  releaseSession: (sessionId: string | null) => Promise<void>;
}

export async function submitResultLifecycle<Request>(input: SubmitResultLifecycleInput<Request>): Promise<void> {
  await input.emitPhaseEvent("submit_result_start", input.startPayload, input.taskId);
  input.debugLog("dispatcher.submit_result.start", input.startDebug);
  try {
    await input.submitResult(input.request);
    await input.emitPhaseEvent("submit_result_done", input.donePayload, input.taskId);
    input.debugLog("dispatcher.submit_result.done", { taskId: input.taskId, status: input.status });
  } finally {
    input.promoteToIdle();
    await input.releaseSession(input.sessionId);
  }
}

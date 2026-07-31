import { extractResponseError, parseJsonResponse } from './http';

export async function postTaskCancel(input: { taskId: string; reason: string }) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(input.taskId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      at: new Date().toISOString(),
      actor: 'console-ui',
      reason: input.reason,
    }),
  });

  if (!res.ok) {
    const errorMessage = extractResponseError(await parseJsonResponse(res), 'Failed to cancel task');
    throw new Error(errorMessage);
  }
}

export async function postTaskResume(input: {
  taskId: string;
  requestId?: string;
  attemptId?: string;
  resumePayload: Record<string, unknown>;
}) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(input.taskId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      at: new Date().toISOString(),
      actor: 'console-ui',
      requestId: input.requestId,
      attemptId: input.attemptId,
      resumePayload: input.resumePayload,
    }),
  });

  if (!res.ok) {
    const errorMessage = extractResponseError(await parseJsonResponse(res), 'Failed to resume task');
    throw new Error(errorMessage);
  }
}

export interface TaskRedriveResponse {
  status: "redriven";
  originalTaskId: string;
  newTaskId: string;
  targetWorkerId: string | null;
  failureCode: string | null;
  failureSummary: string;
  continuationMode: "continue";
  continueFromTaskId: string;
}

export async function postTaskRedrive(input: { taskId: string }): Promise<TaskRedriveResponse> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(input.taskId)}/redrive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      at: new Date().toISOString(),
      actor: 'console-ui',
    }),
  });

  const body = await parseJsonResponse(res);
  if (!res.ok) {
    const errorMessage = extractResponseError(body, 'Failed to redrive task');
    throw new Error(errorMessage);
  }
  return body as TaskRedriveResponse;
}

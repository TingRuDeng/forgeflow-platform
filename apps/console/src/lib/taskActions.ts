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
  resumePayload: Record<string, unknown>;
}) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(input.taskId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      at: new Date().toISOString(),
      actor: 'console-ui',
      resumePayload: input.resumePayload,
    }),
  });

  if (!res.ok) {
    const errorMessage = extractResponseError(await parseJsonResponse(res), 'Failed to resume task');
    throw new Error(errorMessage);
  }
}

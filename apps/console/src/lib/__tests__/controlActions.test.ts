import { afterEach, describe, expect, it, vi } from 'vitest';

import { postReviewDecision } from '../reviewDecision';
import { postTaskResume } from '../taskActions';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('control action identity fences', () => {
  it('posts the current HITL request and attempt identity when resuming', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);

    await postTaskResume({
      taskId: 'dispatch-1:task-1',
      requestId: 'input-request-1',
      attemptId: 'attempt-1',
      resumePayload: { decision: 'continue' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/dispatch-1%3Atask-1/resume',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      requestId: 'input-request-1',
      attemptId: 'attempt-1',
      resumePayload: { decision: 'continue' },
    });
  });

  it('posts the reviewed attempt and artifact identity with a decision', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);

    await postReviewDecision({
      taskId: 'dispatch-1:task-1',
      decision: 'merge',
      notes: 'reviewed',
      reviewInput: {
        expectedFreshness: {
          attemptId: 'attempt-1',
          artifactBundleId: 'attempt-1:artifact-bundle',
          commitSha: 'abc123',
        },
      },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      expectedFreshness: {
        attemptId: 'attempt-1',
        artifactBundleId: 'attempt-1:artifact-bundle',
        commitSha: 'abc123',
      },
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import App from '../App';
import { LanguageProvider } from '../lib/i18n';

const snapshot = {
  updatedAt: '2026-05-18T10:00:00.000Z',
  stats: {
    workers: { total: 1, idle: 1, busy: 0, disabled: 0 },
    tasks: { total: 0, review: 0, merged: 0 },
  },
  metrics: {
    queueDepth: 0,
    plannedTasks: 0,
    reviewBacklog: 0,
    avgAssignmentLagMs: 0,
    maxAssignmentLagMs: 0,
    submitResultRetryCount: 0,
    retryRatePct: 0,
    deliveryFailedCount: 0,
    cleanupFailureCount: 0,
  },
  tasks: [],
  workers: [
    {
      id: 'worker-1',
      status: 'ready',
      pool: 'default',
      hostname: 'host-1',
    },
  ],
  assignments: [],
  reviews: [],
  pullRequests: [],
  events: [],
  taskAttempts: [],
  artifactBundles: [],
};

function renderApp() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </SWRConfig>
  );
}

describe('App dashboard loading', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the connection error when the dashboard snapshot returns a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ message: 'server down' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )));

    renderApp();

    expect(await screen.findByText(/连接错误.*server down/i)).toBeInTheDocument();
  });

  it('refreshes the snapshot after disabling a worker', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...snapshot,
        workers: [{ ...snapshot.workers[0], status: 'disabled' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /禁用|disable/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workers/worker-1/disable',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('submits a review decision from the task details panel', async () => {
    const reviewSnapshot = {
      ...snapshot,
      stats: {
        ...snapshot.stats,
        tasks: { total: 1, review: 1, merged: 0 },
      },
      metrics: {
        ...snapshot.metrics,
        reviewBacklog: 1,
      },
      tasks: [
        {
          id: 'dispatch-1:task-review',
          title: 'Review task',
          status: 'review',
          branchName: 'codex/review-task',
          repo: 'owner/repo',
          pool: 'codex',
        },
      ],
      reviews: [
        {
          taskId: 'dispatch-1:task-review',
          decision: 'pending',
          notes: '',
          riskAssessment: {
            level: 'needs_human_attention',
            reasons: ['protected paths touched'],
            changedFileCount: 2,
            protectedPathHits: [],
          },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(reviewSnapshot), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'decision_recorded' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...reviewSnapshot,
        tasks: [{ ...reviewSnapshot.tasks[0], status: 'merged' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('alert', vi.fn());

    renderApp();

    const reasonInputs = await screen.findAllByLabelText(/原因码|reason code/i);
    fireEvent.change(reasonInputs[0], {
      target: { value: 'needs_manual_review' },
    });
    fireEvent.change(screen.getAllByLabelText(/必须修复|must fix/i)[0], {
      target: { value: '补齐协议测试\n更新发布说明' },
    });
    fireEvent.click(screen.getByLabelText(/确认风险|acknowledge risk/i));
    fireEvent.click(await screen.findByRole('button', { name: /合并|merge/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const submittedBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/reviews/dispatch-1%3Atask-review/decision',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(submittedBody).toMatchObject({
      decision: 'merge',
      acknowledgeRisk: true,
      evidence: {
        reasonCode: 'needs_manual_review',
        mustFix: ['补齐协议测试', '更新发布说明'],
        canRedrive: true,
        redriveStrategy: 'same_worker_continue',
      },
    });
  });

  it('shows dispatcher review decision errors in the alert', async () => {
    const reviewSnapshot = {
      ...snapshot,
      tasks: [
        {
          id: 'dispatch-1:task-review',
          title: 'Review task',
          status: 'review',
        },
      ],
      reviews: [
        {
          taskId: 'dispatch-1:task-review',
          decision: 'pending',
        },
      ],
    };
    const alertMock = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(reviewSnapshot), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'risk_ack_required' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('alert', alertMock);

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /合并|merge/i }));

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('risk_ack_required')));
  });
});

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

const drStatus = {
  readOnly: false,
  structuredReads: true,
  shadowMode: 'shadow-write',
  shadowWrite: { status: 'ok' },
  shadowReconciler: {
    status: 'ok',
    runCount: 2,
    failedRunCount: 0,
  },
  projectionHealth: { matches: true },
  backups: [],
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
    let snapshotCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url === '/api/dr/status') {
        return new Response(JSON.stringify(drStatus), { status: 200 });
      }
      if (url === '/api/workers/worker-1/disable') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url === '/api/dashboard/snapshot') {
        snapshotCalls += 1;
        const body = snapshotCalls > 1
          ? { ...snapshot, workers: [{ ...snapshot.workers[0], status: 'disabled' }] }
          : snapshot;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /禁用|disable/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/workers/worker-1/disable',
      expect.objectContaining({ method: 'POST' })
    ));
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
    let snapshotCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url === '/api/dr/status') {
        return new Response(JSON.stringify(drStatus), { status: 200 });
      }
      if (url === '/api/reviews/dispatch-1%3Atask-review/decision') {
        return new Response(JSON.stringify({ status: 'decision_recorded' }), { status: 200 });
      }
      if (url === '/api/dashboard/snapshot') {
        snapshotCalls += 1;
        const body = snapshotCalls > 1
          ? { ...reviewSnapshot, tasks: [{ ...reviewSnapshot.tasks[0], status: 'merged' }] }
          : reviewSnapshot;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 500 });
    });
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
    fireEvent.click(await screen.findByRole('button', { name: /^(合并|merge)$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/reviews/dispatch-1%3Atask-review/decision',
      expect.objectContaining({
        method: 'POST',
      })
    ));
    const reviewCall = fetchMock.mock.calls.find(([url]) =>
      url === '/api/reviews/dispatch-1%3Atask-review/decision',
    );
    const submittedBody = JSON.parse(String(reviewCall?.[1]?.body));
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
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/dr/status') {
        return new Response(JSON.stringify(drStatus), { status: 200 });
      }
      if (url === '/api/reviews/dispatch-1%3Atask-review/decision') {
        return new Response(JSON.stringify({ error: 'risk_ack_required' }), { status: 409 });
      }
      if (url === '/api/dashboard/snapshot') {
        return new Response(JSON.stringify(reviewSnapshot), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('alert', alertMock);

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /^(合并|merge)$/i }));

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('risk_ack_required')));
  });

  it('redrives a failed task through the dispatcher recovery endpoint', async () => {
    const failedTask = {
      id: 'dispatch-1:task-failed',
      title: 'Recover failed task',
      status: 'failed',
      branchName: 'codex/task-failed',
      repo: 'owner/repo',
      pool: 'codex',
      redriveEligibility: {
        canRedrive: true,
        reason: 'recoverable_failure',
        failureCode: 'transient_gateway_timeout',
        existingTaskId: null,
      },
    };
    const failedSnapshot = {
      ...snapshot,
      stats: {
        ...snapshot.stats,
        tasks: { total: 1, review: 0, merged: 0 },
      },
      tasks: [failedTask],
      assignments: [{
        taskId: failedTask.id,
        workerId: 'worker-1',
        branchName: failedTask.branchName,
        repo: failedTask.repo,
        pool: failedTask.pool,
      }],
      reviews: [{
        taskId: failedTask.id,
        decision: 'pending',
        latestWorkerResult: {
          generatedAt: '2026-07-26T10:00:00Z',
          output: 'gateway timeout',
          evidence: {
            failureType: 'execution',
            failureSummary: 'gateway timeout',
            blockers: [{
              kind: 'execution',
              code: 'transient_gateway_timeout',
              message: 'gateway timeout',
            }],
          },
        },
      }],
      taskAttempts: [{
        taskId: failedTask.id,
        attemptId: 'attempt-1',
        status: 'failed',
        failureCode: 'transient_gateway_timeout',
        failureMessage: 'gateway timeout',
      }],
    };
    const newTask = {
      ...failedTask,
      id: 'dispatch-2:redrive-2',
      status: 'assigned',
      branchName: 'codex/task-failed-r2',
      continueFromTaskId: failedTask.id,
      redriveEligibility: {
        canRedrive: false,
        reason: 'state_not_redriveable',
        failureCode: null,
        existingTaskId: null,
      },
    };
    let snapshotCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/dr/status') {
        return new Response(JSON.stringify(drStatus), { status: 200 });
      }
      if (url === '/api/tasks/dispatch-1%3Atask-failed/redrive') {
        return new Response(JSON.stringify({
          status: 'redriven',
          originalTaskId: failedTask.id,
          newTaskId: newTask.id,
          targetWorkerId: 'worker-1',
          failureCode: 'transient_gateway_timeout',
          failureSummary: 'gateway timeout',
          continuationMode: 'continue',
          continueFromTaskId: failedTask.id,
        }), { status: 200 });
      }
      if (url === '/api/dashboard/snapshot') {
        snapshotCalls += 1;
        return new Response(JSON.stringify(
          snapshotCalls > 1
            ? { ...failedSnapshot, tasks: [failedTask, newTask] }
            : failedSnapshot,
        ), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());

    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /重新执行|redrive task/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/dispatch-1%3Atask-failed/redrive',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(await screen.findByText(newTask.id)).toBeInTheDocument();
  });

  it('shows bulk review failures in the review queue instead of an alert', async () => {
    const reviewSnapshot = {
      ...snapshot,
      stats: {
        ...snapshot.stats,
        tasks: { total: 2, review: 2, merged: 0 },
      },
      metrics: {
        ...snapshot.metrics,
        reviewBacklog: 2,
      },
      tasks: [
        { id: 'task-safe', title: 'Safe task', status: 'review', repo: 'owner/docs' },
        { id: 'task-risky', title: 'Risky task', status: 'review', repo: 'owner/auth' },
      ],
      reviews: [
        { taskId: 'task-safe', decision: 'pending' },
        { taskId: 'task-risky', decision: 'pending' },
      ],
    };
    const alertMock = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let decisionCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/dr/status') {
        return new Response(JSON.stringify(drStatus), { status: 200 });
      }
      if (url.startsWith('/api/reviews/')) {
        decisionCalls += 1;
        if (decisionCalls === 1) {
          return new Response(JSON.stringify({ status: 'decision_recorded' }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'risk_ack_required' }), { status: 409 });
      }
      if (url === '/api/dashboard/snapshot') {
        return new Response(JSON.stringify(reviewSnapshot), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('alert', alertMock);

    renderApp();

    fireEvent.click(await screen.findByLabelText(/选择任务 task-safe|select task task-safe/i));
    fireEvent.click(screen.getByLabelText(/选择任务 task-risky|select task task-risky/i));
    fireEvent.click(screen.getByRole('button', { name: /批量返工|bulk rework/i }));

    expect(await screen.findByText(/批量审查结果|bulk review result/i)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/i)).toBeInTheDocument();
    expect(screen.getAllByText(/task-risky/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/risk_ack_required/i)).toBeInTheDocument();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

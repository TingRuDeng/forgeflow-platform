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
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { TaskDetailsPanel } from '../TaskDetailsPanel';
import { LanguageProvider } from '../../lib/i18n';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
}

describe('TaskDetailsPanel termination policy', () => {
  it('renders task-level termination policy alongside HITL and review context', () => {
    renderWithProviders(
      <TaskDetailsPanel
        task={{
          id: 'dispatch-1:policy-task',
          title: 'Review retry boundaries',
          status: 'review',
          repo: 'owner/repo',
          pool: 'codex',
          terminationPolicy: {
            maxAttempts: 2,
            attemptLeaseTimeoutMs: 30000,
            heartbeatTimeoutMs: 60000,
            assignmentTimeoutMs: 120000,
          },
        }}
      />
    );

    expect(screen.getByText(/终止策略|termination policy/i)).toBeInTheDocument();
    expect(screen.getByText(/最大尝试次数|Max Attempts/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/30s/)).toBeInTheDocument();
    expect(screen.getByText(/60s/)).toBeInTheDocument();
    expect(screen.getByText(/120s/)).toBeInTheDocument();
  });
});

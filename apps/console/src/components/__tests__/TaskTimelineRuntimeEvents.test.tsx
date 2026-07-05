import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { RuntimeEventList } from '../TaskTimeline';
import { LanguageProvider } from '../../lib/i18n';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
}

function makeEvents(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    taskId: 'dispatch-1:task-1',
    type: `progress_${index + 1}`,
    at: `2026-07-06T00:${String(index).padStart(2, '0')}:00.000Z`,
    summary: `event summary ${index + 1}`,
  }));
}

describe('RuntimeEventList', () => {
  it('defaults to the latest ten runtime events and can expand all events for review', () => {
    renderWithProviders(<RuntimeEventList events={makeEvents(12)} />);

    expect(screen.getByText('progress_1', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('progress_10', { selector: 'div' })).toBeInTheDocument();
    expect(screen.queryByText('progress_11', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.getByText(/10 \/ 12/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /显示全部|Show all/i }));

    expect(screen.getByText('progress_12', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText(/12 \/ 12/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /收起|Collapse/i }));

    expect(screen.queryByText('progress_11', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('filters expanded runtime events by event type', () => {
    renderWithProviders(<RuntimeEventList events={[
      {
        taskId: 'dispatch-1:task-1',
        type: 'progress_reported',
        at: '2026-07-06T00:00:00.000Z',
        summary: 'running tests',
      },
      {
        taskId: 'dispatch-1:task-1',
        type: 'delivery_failed',
        at: '2026-07-06T00:01:00.000Z',
        summary: 'submitResult failed',
      },
      {
        taskId: 'dispatch-1:task-1',
        type: 'delivery_failed',
        at: '2026-07-06T00:02:00.000Z',
        summary: 'retry exhausted',
      },
    ]} />);

    fireEvent.change(screen.getByLabelText(/事件类型|Event type/i), {
      target: { value: 'delivery_failed' },
    });

    expect(screen.queryByText('progress_reported', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.getAllByText('delivery_failed', { selector: 'div' })).toHaveLength(2);
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { TerminalPanel } from '../TerminalPanel';
import { LanguageProvider } from '../../lib/i18n';

// Mock JsonView because it might have issues in JSDOM or we just want to test TerminalPanel's logic
vi.mock('@uiw/react-json-view', () => ({
  default: ({ value }: { value: any }) => (
    <pre data-testid="json-view">{JSON.stringify(value)}</pre>
  ),
}));

vi.mock('@uiw/react-json-view/dark', () => ({
  darkTheme: {},
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
};

describe('TerminalPanel', () => {
  // JSDOM doesn't implement scrollTo, so we need to mock it
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });
  const mockEvents = [
    {
      taskId: 'TASK-1',
      type: 'info',
      payload: 'Step 1 completed'
    },
    {
      taskId: 'TASK-2',
      type: 'data',
      payload: { status: 'success', code: 200 }
    }
  ];

  it('should render "no events" message when events list is empty', () => {
    renderWithProviders(<TerminalPanel events={[]} />);
    // In i18n, 'noRecentEvents' usually maps to something like "No recent events" or "暂无最近事件"
    // Since we are using LanguageProvider, it should render the translated text.
    // Given the previous code, it uses t('noRecentEvents')
    expect(screen.getByText(/noRecentEvents|暂无最近事件|No recent events/i)).toBeInTheDocument();
  });

  it('should render a list of events with correct task IDs', () => {
    renderWithProviders(<TerminalPanel events={mockEvents} />);
    
    expect(screen.getByText('TASK-1')).toBeInTheDocument();
    expect(screen.getByText('TASK-2')).toBeInTheDocument();
  });

  it('should render string payload directly', () => {
    renderWithProviders(<TerminalPanel events={[mockEvents[0]]} />);
    expect(screen.getByText('Step 1 completed')).toBeInTheDocument();
  });

  it('should render object payload using JsonView', () => {
    renderWithProviders(<TerminalPanel events={[mockEvents[1]]} />);
    const jsonView = screen.getByTestId('json-view');
    expect(jsonView).toBeInTheDocument();
    expect(jsonView.textContent).toContain('"status":"success"');
    expect(jsonView.textContent).toContain('"code":200');
  });

  it('should have the terminal header decoration', () => {
    renderWithProviders(<TerminalPanel events={[]} />);
    expect(screen.getByText('SYSTEM_LOG_STREAM')).toBeInTheDocument();
  });
});

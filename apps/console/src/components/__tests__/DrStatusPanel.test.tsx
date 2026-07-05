import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DrStatusPanel } from '../DrStatusPanel';
import { LanguageProvider } from '../../lib/i18n';

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
};

describe('DrStatusPanel', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('renders shadow write, reconciler, and projection status', () => {
    renderWithProviders(
      <DrStatusPanel
        status={{
          readOnly: false,
          structuredReads: true,
          shadowMode: 'shadow-write',
          shadowWrite: { status: 'ok' },
          shadowReconciler: {
            status: 'ok',
            runCount: 4,
            failedRunCount: 0,
          },
          projectionHealth: { matches: true },
          backups: [{ id: 'backup-1' }],
        }}
      />,
    );

    expect(screen.getByLabelText(/DR 状态/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Shadow 写入/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/自动对账/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/运行次数: 4 · 失败: 0/i)).toBeInTheDocument();
    expect(screen.getByText(/匹配 · 备份: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/只读: 否 · 结构化读取: 是/i)).toBeInTheDocument();
  });

  it('surfaces reconciler failures', () => {
    renderWithProviders(
      <DrStatusPanel
        status={{
          shadowMode: 'shadow-write',
          shadowWrite: { status: 'failed', lastError: 'postgres unavailable' },
          shadowReconciler: {
            status: 'failed',
            runCount: 5,
            failedRunCount: 2,
            lastError: 'drift still present',
          },
          projectionHealth: { matches: false },
          backups: [],
        }}
      />,
    );

    expect(screen.getByText(/postgres unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/drift still present/i)).toBeInTheDocument();
    expect(screen.getByText(/运行次数: 5 · 失败: 2/i)).toBeInTheDocument();
  });
});

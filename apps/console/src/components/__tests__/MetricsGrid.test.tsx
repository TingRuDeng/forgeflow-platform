import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MetricsGrid } from '../MetricsGrid';
import { LanguageProvider } from '../../lib/i18n';

const mockStats = {
  workers: { total: 10, idle: 7, busy: 3, disabled: 0 },
  tasks: { total: 25, review: 5, merged: 15 }
};

const mockMetrics = {
  queueDepth: 12,
  plannedTasks: 4,
  reviewBacklog: 5,
  avgAssignmentLagMs: 12_300,
  maxAssignmentLagMs: 54_000,
  submitResultRetryCount: 2,
  retryRatePct: 16.7,
  deliveryFailedCount: 3,
  cleanupFailureCount: 1
};

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
};

describe('MetricsGrid', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('should render correct worker counts', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} metrics={mockMetrics} />);

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/空闲 \/ 忙碌: 7 \/ 3/i)).toBeInTheDocument();
  });

  it('should render correct task counts', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} metrics={mockMetrics} />);

    expect(screen.getByText((_, node) => node?.textContent === '12 / 5')).toBeInTheDocument();
    expect(screen.getByText(/待依赖: 4/i)).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === '16.7%')).toBeInTheDocument();
    expect(screen.getByText(/交付失败: 3 · 清理失败: 1/i)).toBeInTheDocument();
  });

  it('should render localized labels (default to zh)', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} metrics={mockMetrics} />);

    expect(screen.getByText(/活跃工作节点/i)).toBeInTheDocument();
    expect(screen.getByText(/排队 \/ 审查/i)).toBeInTheDocument();
    expect(screen.getByText(/分配延迟/i)).toBeInTheDocument();
    expect(screen.getByText(/重试率/i)).toBeInTheDocument();
  });
});

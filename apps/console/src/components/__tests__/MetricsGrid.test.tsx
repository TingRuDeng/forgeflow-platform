import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MetricsGrid } from '../MetricsGrid';
import { LanguageProvider } from '../../lib/i18n';

const mockStats = {
  workers: { total: 10, idle: 7, busy: 3, disabled: 0 },
  tasks: { total: 25, review: 5, merged: 15 }
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
    renderWithProviders(<MetricsGrid stats={mockStats} />);
    
    // Using matcher function to handle potential breakage by spaces or other elements
    expect(screen.getByText((content) => content.trim() === '10')).toBeInTheDocument();
    expect(screen.getByText((content) => content.trim() === '7')).toBeInTheDocument();
    expect(screen.getByText((content) => content.trim() === '3')).toBeInTheDocument();
  });

  it('should render correct task counts', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} />);
    
    expect(screen.getByText((content) => content.trim() === '25')).toBeInTheDocument();
    expect(screen.getByText((content) => content.trim() === '5')).toBeInTheDocument();
    expect(screen.getByText((content) => content.trim() === '15')).toBeInTheDocument();
  });

  it('should render localized labels (default to zh)', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} />);
    
    expect(screen.getByText(/活跃工作节点/i)).toBeInTheDocument();
    expect(screen.getByText(/任务总数/i)).toBeInTheDocument();
  });
});

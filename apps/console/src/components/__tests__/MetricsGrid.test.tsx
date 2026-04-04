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
    
    // Using exact text match for the containers that hold only the number
    expect(screen.getByText('10')).toBeInTheDocument();
    
    // For idle/busy, they are in the same div but separate nodes. 
    // JSDOM/Testing-Library findByText('7') should work if they are distinct text nodes.
    const idleBusyContainer = screen.getByText(/空闲/i).closest('div')?.nextElementSibling;
    expect(idleBusyContainer).toHaveTextContent('7');
    expect(idleBusyContainer).toHaveTextContent('3');
  });

  it('should render correct task counts', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} />);
    
    expect(screen.getByText('25')).toBeInTheDocument();
    
    const reviewMergedContainer = screen.getByText(/待审查/i).closest('div')?.nextElementSibling;
    expect(reviewMergedContainer).toHaveTextContent('5');
    expect(reviewMergedContainer).toHaveTextContent('15');
  });

  it('should render localized labels (default to zh)', () => {
    renderWithProviders(<MetricsGrid stats={mockStats} />);
    
    expect(screen.getByText(/活跃工作节点/i)).toBeInTheDocument();
    expect(screen.getByText(/任务总数/i)).toBeInTheDocument();
  });
});

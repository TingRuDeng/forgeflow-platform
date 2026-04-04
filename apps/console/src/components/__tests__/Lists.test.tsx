import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskList } from '../Lists';
import { LanguageProvider } from '../../lib/i18n';

// Mock Tasks
const mockTasks = (count: number) => 
  Array.from({ length: count }, (_, i) => ({
    id: `T-${i + 1}`,
    title: `Task ${i + 1}`,
    status: 'idle',
  }));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
};

describe('TaskList Pagination', () => {
  it('should not show pagination when task count is <= 10', () => {
    renderWithProviders(<TaskList tasks={mockTasks(5)} />);
    
    expect(screen.queryByText(/Previous/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Next/i)).not.toBeInTheDocument();
  });

  it('should show pagination when task count is > 10', () => {
    renderWithProviders(<TaskList tasks={mockTasks(15)} />);
    
    // Check for page indicator (1 / 2)
    const indicator = screen.getByTestId('page-indicator');
    expect(indicator.textContent).toContain('1');
    expect(indicator.textContent).toContain('/');
    expect(indicator.textContent).toContain('2');
    // Buttons are present
    expect(screen.getByRole('button', { name: /next|下一页/i })).toBeInTheDocument();
  });

  it('should disable "Previous" button on the first page', () => {
    renderWithProviders(<TaskList tasks={mockTasks(15)} />);
    const prevBtn = screen.getByRole('button', { name: /previous|上一页/i });
    expect(prevBtn).toBeDisabled();
  });

  it('should navigate to the next page when "Next" is clicked', () => {
    renderWithProviders(<TaskList tasks={mockTasks(15)} />);
    const nextBtn = screen.getByRole('button', { name: /next|下一页/i });
    
    // Initially on page 1, should see Task 1
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.queryByText('Task 11')).not.toBeInTheDocument();

    fireEvent.click(nextBtn);

    // Now on page 2, should see Task 11 but not Task 1
    expect(screen.getByTestId('page-indicator').textContent).toContain('2');
    expect(screen.getByText('Task 11')).toBeInTheDocument();
    expect(screen.queryByText('Task 1')).not.toBeInTheDocument();
    
    // Next button should now be disabled
    expect(nextBtn).toBeDisabled();
  });

  it('should navigate back to the previous page when "Previous" is clicked', () => {
    renderWithProviders(<TaskList tasks={mockTasks(15)} />);
    const nextBtn = screen.getByRole('button', { name: /next|下一页/i });
    const prevBtn = screen.getByRole('button', { name: /previous|上一页/i });

    // Go to page 2
    fireEvent.click(nextBtn);
    expect(screen.getByTestId('page-indicator').textContent).toContain('2');

    // Go back to page 1
    fireEvent.click(prevBtn);
    expect(screen.getByTestId('page-indicator').textContent).toContain('1');
    expect(screen.getByText('Task 1')).toBeInTheDocument();
  });
});

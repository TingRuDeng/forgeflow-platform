import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskDetailsPanel, TaskList } from '../Lists';
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

  it('should clamp pagination when the task list shrinks', () => {
    const { rerender } = renderWithProviders(<TaskList tasks={mockTasks(15)} />);
    const nextBtn = screen.getByRole('button', { name: /next|下一页/i });

    fireEvent.click(nextBtn);
    expect(screen.getByText('Task 11')).toBeInTheDocument();

    rerender(
      <LanguageProvider>
        <TaskList tasks={mockTasks(5)} />
      </LanguageProvider>
    );

    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.queryByTestId('page-indicator')).not.toBeInTheDocument();
  });
});

describe('Task drill-down', () => {
  it('highlights the selected task and emits selection changes', () => {
    const onSelect = vi.fn();

    renderWithProviders(
      <TaskList tasks={mockTasks(2)} selectedTaskId="T-2" onSelect={onSelect} />
    );

    fireEvent.click(screen.getByText('Task 1'));

    expect(onSelect).toHaveBeenCalledWith('T-1');
  });

  it('renders task details and exposes the cancel action for cancellable tasks', () => {
    const onCancel = vi.fn();
    const onReviewDecision = vi.fn();

    renderWithProviders(
      <TaskDetailsPanel
        task={{
          id: 'dispatch-1:task-1',
          traceId: 'trace-dispatch-1-task-1',
          title: 'Fix auth gate',
          status: 'review',
          branchName: 'codex/auth-fix',
          repo: 'owner/repo',
          pool: 'trae',
          continueFromTaskId: 'dispatch-1:task-0',
        }}
        assignment={{
          taskId: 'dispatch-1:task-1',
          workerId: 'trae-remote-forgeflow',
          repo: 'owner/repo',
          pool: 'trae',
        }}
        review={{
          taskId: 'dispatch-1:task-1',
          decision: 'rework',
          actor: 'codex-control',
          decidedAt: '2026-04-08T10:00:00Z',
          evidence: {
            reasonCode: 'test_gap',
            canRedrive: true,
            redriveStrategy: 'same_worker_continue',
            mustFix: ['补齐失败测试'],
          },
          latestWorkerResult: {
            evidence: {
              failureType: 'verification',
              blockers: [{ code: 'verification_failed' }],
              failureSummary: 'pnpm test failed',
            },
          },
        }}
        pullRequest={{
          taskId: 'dispatch-1:task-1',
          number: 42,
          status: 'draft',
          url: 'https://example.com/pr/42',
        }}
        events={[
          {
            taskId: 'dispatch-1:task-1',
            type: 'progress_reported',
            at: '2026-04-08T10:01:00Z',
            payload: { message: 'running tests' },
          },
          {
            taskId: 'dispatch-1:task-1',
            type: 'artifact_bundle_created',
            at: '2026-04-08T10:02:00Z',
            summary: 'artifact ready',
          },
        ]}
        attempts={[
          {
            taskId: 'dispatch-1:task-1',
            attemptId: 'att-001',
            attemptNo: 1,
            status: 'review',
            workerId: 'trae-remote-forgeflow',
            startedAt: '2026-04-08T10:00:30Z',
            completedAt: '2026-04-08T10:02:30Z',
            artifactBundleId: 'att-001:artifact-bundle',
          },
        ]}
        artifactBundles={[
          {
            taskId: 'dispatch-1:task-1',
            attemptId: 'att-001',
            bundleId: 'att-001:artifact-bundle',
            summary: '修改鉴权守卫并补充失败测试',
            changedFiles: [{ path: 'src/auth.ts', changeType: 'modified' }],
            refs: {
              diff: 'artifact://att-001/diff.patch',
              logs: 'artifact://att-001/session.log',
            },
            retainedContent: {
              diff: 'diff --git a/src/auth.ts b/src/auth.ts',
              logs: 'pnpm test passed',
            },
            riskNotes: ['需要人工复核权限边界'],
            nextActions: ['合并后观察登录链路'],
          },
        ]}
        onCancel={onCancel}
        onReviewDecision={onReviewDecision}
      />
    );

    expect(screen.getByText('Fix auth gate')).toBeInTheDocument();
    expect(screen.getByText(/trace-dispatch-1-task-1/i)).toBeInTheDocument();
    expect(screen.getByText(/verification_failed/i)).toBeInTheDocument();
    expect(screen.getByText(/test_gap/i)).toBeInTheDocument();
    expect(screen.getByText(/pnpm test failed/i)).toBeInTheDocument();
    expect(screen.getAllByText(/att-001/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/artifact ready/i)).toBeInTheDocument();
    expect(screen.getByText(/修改鉴权守卫并补充失败测试/i)).toBeInTheDocument();
    expect(screen.getByText(/src\/auth.ts/i)).toBeInTheDocument();
    expect(screen.getByText(/需要人工复核权限边界/i)).toBeInTheDocument();
    expect(screen.getByText(/合并后观察登录链路/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /refs|引用/i }));
    expect(screen.getByText(/artifact:\/\/att-001\/diff.patch/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /retained|正文/i }));
    expect(screen.getByText(/diff --git a\/src\/auth.ts b\/src\/auth.ts/i)).toBeInTheDocument();
    expect(screen.getByText(/pnpm test passed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /作废任务|cancel task/i }));

    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dispatch-1:task-1',
    }));

    fireEvent.click(screen.getByRole('button', { name: /合并|merge/i }));

    expect(onReviewDecision).toHaveBeenCalledWith('merge');
  });
});

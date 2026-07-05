import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskDetailsPanel, TaskList } from '../Lists';
import { ArtifactWorkbench } from '../ArtifactWorkbench';
import { ReviewQueue } from '../ReviewQueue';
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it('renders task details and exposes the cancel action for cancellable tasks', async () => {
    const onCancel = vi.fn();
    const onReviewDecision = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ fileName: 'diff.patch', content: 'artifact file body' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const appendChild = vi.spyOn(document.body, 'appendChild');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectUrl = vi.fn(() => 'blob:artifact');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

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
          riskAssessment: {
            level: 'needs_human_attention',
            reasons: ['protected paths touched: auth/**'],
            changedFileCount: 3,
            protectedPathHits: [{ pattern: 'auth/**', files: ['auth/login.ts'] }],
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
            trajectory: {
              schemaVersion: 'artifact-trajectory/v1',
              steps: [
                {
                  sequence: 1,
                  phase: 'verification',
                  action: 'pnpm test',
                  observation: '58 tests passed',
                  status: 'succeeded',
                },
              ],
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

    // Deterministic review risk grade is surfaced with reasons and a merge hint.
    expect(screen.getAllByText(/需人工关注|needs human attention/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/protected paths touched: auth/i)).toBeInTheDocument();
    expect(screen.getByText(/合并前请人工确认|confirm manually before merge/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /refs|引用/i }));
    expect(screen.getByText(/artifact:\/\/att-001\/diff.patch/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /展开文件|open file/i })[0]);
    expect(await screen.findByText(/artifact file body/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/att-001/files/diff.patch');
    fireEvent.click(screen.getAllByRole('button', { name: /下载文件|download file/i })[0]);
    expect(await screen.findByText(/artifact file body/i)).toBeInTheDocument();
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:artifact');
    expect(appendChild).toHaveBeenCalledWith(expect.objectContaining({
      download: 'diff.patch',
    }));

    fireEvent.click(screen.getByRole('tab', { name: /retained|正文/i }));
    expect(screen.getByText(/diff --git a\/src\/auth.ts b\/src\/auth.ts/i)).toBeInTheDocument();
    expect(screen.getByText(/pnpm test passed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /trajectory|轨迹/i }));
    expect(screen.getByText(/58 tests passed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /作废任务|cancel task/i }));

    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dispatch-1:task-1',
    }));

    fireEvent.click(screen.getByRole('button', { name: /合并|merge/i }));

    expect(onReviewDecision).toHaveBeenCalledWith('merge', expect.objectContaining({
      acknowledgeRisk: false,
      canRedrive: true,
      mustFix: ['补齐失败测试'],
      reasonCode: 'test_gap',
      redriveStrategy: 'same_worker_continue',
    }));
  });

  it('submits resume payload for tasks waiting for input', () => {
    const onResume = vi.fn();

    renderWithProviders(
      <TaskDetailsPanel
        task={{
          id: 'dispatch-1:hitl-task',
          title: 'Need rollout input',
          status: 'waiting_for_input',
          branchName: 'codex/hitl',
          repo: 'owner/repo',
          pool: 'codex',
          waitingForInput: {
            requestedBy: 'codex-worker',
            reason: 'choose rollout scope',
            requestedAt: '2026-07-05T10:00:00Z',
          },
        }}
        assignment={{
          taskId: 'dispatch-1:hitl-task',
          repo: 'owner/repo',
          pool: 'codex',
        }}
        onResume={onResume}
      />
    );

    expect(screen.getByText(/choose rollout scope/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/恢复输入|resume payload/i), {
      target: { value: '{"decision":"ship narrow scope"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /恢复任务|resume task/i }));

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dispatch-1:hitl-task',
    }), {
      decision: 'ship narrow scope',
    });
  });

  it('renders resume payload schema fields when worker requests structured input', () => {
    const onResume = vi.fn();

    renderWithProviders(
      <TaskDetailsPanel
        task={{
          id: 'dispatch-1:schema-hitl',
          title: 'Need deploy input',
          status: 'waiting_for_input',
          branchName: 'codex/hitl-schema',
          repo: 'owner/repo',
          pool: 'codex',
          waitingForInput: {
            requestedBy: 'codex-worker',
            reason: 'choose rollout options',
            requestedAt: '2026-07-05T10:00:00Z',
            resumePayloadSchema: {
              properties: {
                decision: { type: 'string', title: 'Decision' },
                rollout: { type: 'string', enum: ['narrow', 'full'], title: 'Rollout' },
                acknowledgeRisk: { type: 'boolean', title: 'Acknowledge Risk' },
              },
              required: ['decision', 'rollout'],
            },
          },
        }}
        assignment={{
          taskId: 'dispatch-1:schema-hitl',
          repo: 'owner/repo',
          pool: 'codex',
        }}
        onResume={onResume}
      />
    );

    fireEvent.change(screen.getByLabelText(/Decision/i), {
      target: { value: 'ship narrow scope' },
    });
    fireEvent.change(screen.getByLabelText(/Rollout/i), {
      target: { value: 'narrow' },
    });
    fireEvent.click(screen.getByLabelText(/Acknowledge Risk/i));
    fireEvent.click(screen.getByRole('button', { name: /恢复任务|resume task/i }));

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dispatch-1:schema-hitl',
    }), {
      decision: 'ship narrow scope',
      rollout: 'narrow',
      acknowledgeRisk: true,
    });
  });
});

describe('ArtifactWorkbench', () => {
  it('filters artifacts across tasks and selects the owning task', () => {
    const onSelectTask = vi.fn();

    renderWithProviders(
      <ArtifactWorkbench
        selectedTaskId="task-2"
        onSelectTask={onSelectTask}
        tasks={[
          { id: 'task-1', title: 'Fix auth gate', status: 'review', repo: 'owner/auth' },
          { id: 'task-2', title: 'Update docs', status: 'merged', repo: 'owner/docs' },
        ]}
        bundles={[
          {
            taskId: 'task-1',
            bundleId: 'bundle-auth',
            attemptId: 'attempt-auth',
            summary: 'auth diff ready',
            changedFiles: [{ path: 'src/auth.ts' }],
            refs: { diff: 'artifact://bundle-auth/diff.patch' },
          },
          {
            taskId: 'task-2',
            bundleId: 'bundle-docs',
            attemptId: 'attempt-docs',
            summary: 'docs updated',
            changedFiles: [{ path: 'docs/README.md' }],
            refs: { report: 'artifact://bundle-docs/report.md' },
          },
        ]}
      />
    );

    expect(screen.getByText(/docs updated/i)).toBeInTheDocument();
    expect(screen.getByText(/auth diff ready/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/筛选|filter/i), {
      target: { value: 'auth' },
    });

    expect(screen.getByText(/auth diff ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/docs updated/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Fix auth gate/i));

    expect(onSelectTask).toHaveBeenCalledWith('task-1');
  });
});

describe('ReviewQueue', () => {
  it('surfaces waiting-for-input tasks and keeps them out of bulk review selection', () => {
    const onSelectTask = vi.fn();

    renderWithProviders(
      <ReviewQueue
        selectedTaskId="task-hitl"
        tasks={[
          {
            id: 'task-hitl',
            title: 'Need rollout input',
            status: 'waiting_for_input',
            repo: 'owner/app',
            waitingForInput: {
              requestedBy: 'codex-worker',
              reason: 'choose rollout scope',
            },
          },
          { id: 'task-review', title: 'Ready for review', status: 'review', repo: 'owner/app' },
        ]}
        onSelectTask={onSelectTask}
      />
    );

    expect(screen.getByText(/等待人工输入|waiting for human input/i)).toBeInTheDocument();
    expect(screen.getByText(/Need rollout input/i)).toBeInTheDocument();
    expect(screen.getByText(/choose rollout scope/i)).toBeInTheDocument();
    expect(screen.getByText(/已选|selected/i).textContent).toMatch(/0 \/ 1/);

    fireEvent.click(screen.getByText(/Need rollout input/i));

    expect(onSelectTask).toHaveBeenCalledWith('task-hitl');
  });

  it('selects review tasks and submits a shared rework decision', () => {
    const onBulkReviewDecision = vi.fn();

    renderWithProviders(
      <ReviewQueue
        selectedTaskId="task-1"
        tasks={[
          { id: 'task-1', title: 'Fix auth gate', status: 'review', repo: 'owner/auth', branchName: 'codex/auth' },
          { id: 'task-2', title: 'Update docs', status: 'review', repo: 'owner/docs', branchName: 'codex/docs' },
          { id: 'task-3', title: 'Already merged', status: 'merged', repo: 'owner/app' },
        ]}
        reviews={[
          {
            taskId: 'task-1',
            evidence: {
              reasonCode: 'test_gap',
              mustFix: ['补齐鉴权失败测试'],
              canRedrive: true,
              redriveStrategy: 'same_worker_continue',
            },
            riskAssessment: { level: 'needs_human_attention', reasons: ['auth touched'] },
          },
        ]}
        onBulkReviewDecision={onBulkReviewDecision}
      />
    );

    expect(screen.getByText(/Fix auth gate/i)).toBeInTheDocument();
    expect(screen.getByText(/Update docs/i)).toBeInTheDocument();
    expect(screen.queryByText(/Already merged/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/选择任务 task-1|select task task-1/i));
    fireEvent.click(screen.getByLabelText(/选择任务 task-2|select task task-2/i));
    fireEvent.change(screen.getByLabelText(/原因码|reason code/i), {
      target: { value: 'test_gap' },
    });
    fireEvent.change(screen.getByLabelText(/必须修复|must fix/i), {
      target: { value: '补齐鉴权失败测试\n补齐文档回归测试' },
    });
    fireEvent.click(screen.getByRole('button', { name: /批量返工|bulk rework/i }));

    expect(onBulkReviewDecision).toHaveBeenCalledWith('rework', ['task-1', 'task-2'], {
      reasonCode: 'test_gap',
      mustFix: ['补齐鉴权失败测试', '补齐文档回归测试'],
      canRedrive: true,
      redriveStrategy: 'same_worker_continue',
    });
  });

  it('requires risk acknowledgement before bulk merge risky review tasks', () => {
    const onBulkReviewDecision = vi.fn();

    renderWithProviders(
      <ReviewQueue
        tasks={[
          { id: 'task-risky', title: 'Touch auth', status: 'review', repo: 'owner/auth' },
          { id: 'task-safe', title: 'Update docs', status: 'review', repo: 'owner/docs' },
        ]}
        reviews={[
          {
            taskId: 'task-risky',
            riskAssessment: { level: 'needs_human_attention', reasons: ['auth touched'] },
          },
          {
            taskId: 'task-safe',
            riskAssessment: { level: 'low', reasons: [] },
          },
        ]}
        onBulkReviewDecision={onBulkReviewDecision}
      />
    );

    fireEvent.click(screen.getByLabelText(/选择任务 task-risky|select task task-risky/i));
    const mergeButton = screen.getByRole('button', { name: /批量合并|bulk merge/i });
    expect(mergeButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/确认批量合并风险任务|acknowledge risky bulk merge tasks/i));
    fireEvent.click(mergeButton);

    expect(onBulkReviewDecision).toHaveBeenCalledWith('merge', ['task-risky'], expect.objectContaining({
      acknowledgeRisk: true,
    }));
  });

  it('shows bulk review result details inside the queue', () => {
    renderWithProviders(
      <ReviewQueue
        tasks={[{ id: 'task-risky', title: 'Touch auth', status: 'review', repo: 'owner/auth' }]}
        bulkResult={{
          total: 2,
          succeeded: ['task-safe'],
          failed: [{ taskId: 'task-risky', message: 'risk_ack_required' }],
        }}
      />
    );

    expect(screen.getByText(/批量审查结果|bulk review result/i)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/i)).toBeInTheDocument();
    expect(screen.getAllByText(/task-risky/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/risk_ack_required/i)).toBeInTheDocument();
  });
});

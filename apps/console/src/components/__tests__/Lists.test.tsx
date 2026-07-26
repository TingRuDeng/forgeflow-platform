import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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

    const firstTask = screen.getByRole('button', { name: /Task 1/i });
    const selectedTask = screen.getByRole('button', { name: /Task 2/i });
    firstTask.focus();

    expect(firstTask).toHaveFocus();
    expect(firstTask).toHaveAttribute('aria-pressed', 'false');
    expect(selectedTask).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(firstTask);
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
                  artifactRef: 'artifact://att-001/test-results.txt',
                },
                {
                  sequence: 2,
                  phase: 'typecheck',
                  action: 'pnpm typecheck',
                  observation: 'typecheck passed',
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
    expect(screen.getByText(/步骤 1 \/ 2|step 1 \/ 2/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('trajectory-step-detail')).getByText(/pnpm test/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('trajectory-step-detail')).queryByText(/pnpm typecheck/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /下一步|next step/i }));
    expect(screen.getByText(/步骤 2 \/ 2|step 2 \/ 2/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('trajectory-step-detail')).getByText(/pnpm typecheck/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /上一步|previous step/i }));
    expect(within(screen.getByTestId('trajectory-step-detail')).getByText(/58 tests passed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /展开轨迹文件|open trajectory file/i }));
    expect(await screen.findByText(/artifact file body/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/att-001/files/test-results.txt');

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

  it('only exposes recovery when dispatcher marks the task as redriveable', () => {
    const onRedrive = vi.fn();

    renderWithProviders(
      <TaskDetailsPanel
        task={{
          id: 'dispatch-1:verification-failed',
          title: 'Non-recoverable verification failure',
          status: 'failed',
          redriveEligibility: {
            canRedrive: false,
            reason: 'non_redriveable_failure',
            failureCode: null,
            existingTaskId: null,
          },
        }}
        onRedrive={onRedrive}
      />
    );

    expect(screen.queryByRole('button', { name: /重新执行|redrive task/i })).not.toBeInTheDocument();
    expect(onRedrive).not.toHaveBeenCalled();
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

  it('submits richer schema fields and shows validation copy for invalid values', () => {
    const onResume = vi.fn();

    renderWithProviders(
      <TaskDetailsPanel
        task={{
          id: 'dispatch-1:richer-schema-hitl',
          title: 'Need richer deploy input',
          status: 'waiting_for_input',
          branchName: 'codex/hitl-richer-schema',
          repo: 'owner/repo',
          pool: 'codex',
          waitingForInput: {
            requestedBy: 'codex-worker',
            reason: 'choose detailed rollout options',
            requestedAt: '2026-07-05T10:00:00Z',
            resumePayloadSchema: {
              properties: {
                notes: { type: 'string', format: 'textarea', title: 'Notes' },
                retryLimit: { type: 'integer', title: 'Retry Limit', minimum: 1, maximum: 3, default: 2 },
                reviewers: { type: 'array', title: 'Reviewers', items: { type: 'string' }, minItems: 1 },
              },
              required: ['notes', 'reviewers'],
            },
          },
        }}
        assignment={{
          taskId: 'dispatch-1:richer-schema-hitl',
          repo: 'owner/repo',
          pool: 'codex',
        }}
        onResume={onResume}
      />
    );

    fireEvent.change(screen.getByLabelText(/Notes/i), {
      target: { value: 'ship narrow scope after review' },
    });
    fireEvent.change(screen.getByLabelText(/Retry Limit/i), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText(/Reviewers/i), {
      target: { value: 'alice\nbob' },
    });
    fireEvent.click(screen.getByRole('button', { name: /恢复任务|resume task/i }));

    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByText(/恢复输入校验失败|resume payload validation failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Retry Limit must be <= 3/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Retry Limit/i), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: /恢复任务|resume task/i }));

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dispatch-1:richer-schema-hitl',
    }), {
      notes: 'ship narrow scope after review',
      retryLimit: 3,
      reviewers: ['alice', 'bob'],
    });
  });
});

describe('ArtifactWorkbench', () => {
  it('searches runtime events across tasks and selects the owning task', () => {
    const onSelectTask = vi.fn();

    renderWithProviders(
      <ArtifactWorkbench
        selectedTaskId="task-2"
        onSelectTask={onSelectTask}
        tasks={[
          { id: 'task-1', title: 'Fix auth gate', status: 'review', repo: 'owner/auth' },
          { id: 'task-2', title: 'Update docs', status: 'merged', repo: 'owner/docs' },
        ]}
        events={[
          {
            taskId: 'task-1',
            type: 'delivery_failed',
            at: '2026-07-06T10:00:00Z',
            payload: { message: 'submitResult exhausted retries' },
          },
          {
            taskId: 'task-2',
            type: 'progress_reported',
            at: '2026-07-06T10:01:00Z',
            payload: { message: 'docs verification passed' },
          },
        ]}
        bundles={[]}
      />
    );

    expect(screen.getByText(/运行事件搜索|runtime event search/i)).toBeInTheDocument();
    expect(screen.getByText(/delivery_failed.*1/i)).toBeInTheDocument();
    expect(screen.getByText(/progress_reported.*1/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/事件类型|event type/i), {
      target: { value: 'delivery_failed' },
    });
    fireEvent.change(screen.getByPlaceholderText(/搜索运行事件|search runtime events/i), {
      target: { value: 'submitResult' },
    });

    expect(screen.getByText(/submitResult exhausted retries/i)).toBeInTheDocument();
    expect(screen.queryByText(/docs verification passed/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText(/^Fix auth gate$/i)[0]);

    expect(onSelectTask).toHaveBeenCalledWith('task-1');
  });

  it('filters artifacts across tasks and selects the owning task', async () => {
    const onSelectTask = vi.fn();
    const writeText = vi.fn();
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => JSON.stringify({
        fileName: url.includes('test-results') ? 'test-results.txt' : 'diff.patch',
        content: url.includes('test-results') ? 'trajectory observation body' : 'workbench diff body',
      }),
    }));
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <ArtifactWorkbench
        selectedTaskId="task-2"
        onSelectTask={onSelectTask}
        tasks={[
          { id: 'task-1', title: 'Fix auth gate', status: 'review', repo: 'owner/auth' },
          { id: 'task-2', title: 'Update docs', status: 'merged', repo: 'owner/docs' },
        ]}
        reviews={[
          {
            taskId: 'task-1',
            evidence: {
              reasonCode: 'test_gap',
              mustFix: ['补齐鉴权失败测试'],
            },
            riskAssessment: { level: 'needs_human_attention', reasons: ['auth touched'] },
          },
          {
            taskId: 'task-2',
            evidence: {
              reasonCode: 'docs_ready',
              mustFix: [],
            },
            riskAssessment: { level: 'low', reasons: [] },
          },
        ]}
        bundles={[
          {
            taskId: 'task-1',
            bundleId: 'bundle-auth',
            attemptId: 'attempt-auth',
            summary: 'auth diff ready',
            changedFiles: [{ path: 'src/auth.ts' }],
            refs: { diff: 'artifact://bundle-auth/diff.patch' },
            trajectory: {
              schemaVersion: 'artifact-trajectory/v1',
              steps: [
                {
                  sequence: 1,
                  phase: 'action',
                  action: 'run auth regression',
                  observation: 'auth guard failed before patch',
                  status: 'failed',
                  command: 'pnpm test auth',
                  artifactRef: 'artifact://bundle-auth/test-results.txt',
                },
                {
                  sequence: 2,
                  phase: 'verification',
                  action: 'rerun auth regression',
                  observation: 'auth guard passed after patch',
                  status: 'succeeded',
                  command: 'pnpm test auth',
                },
              ],
            },
          },
          {
            taskId: 'task-2',
            bundleId: 'bundle-docs',
            attemptId: 'attempt-docs',
            summary: 'docs updated',
            changedFiles: [{ path: 'docs/README.md' }],
            refs: { report: 'artifact://bundle-docs/report.md' },
            trajectory: {
              schemaVersion: 'artifact-trajectory/v1',
              steps: [
                {
                  sequence: 1,
                  phase: 'verification',
                  action: 'verify docs index',
                  observation: 'docs checklist passed',
                  status: 'succeeded',
                  command: 'pnpm docs:validate',
                },
              ],
            },
          },
        ]}
      />
    );

    expect(screen.getByText(/docs updated/i)).toBeInTheDocument();
    expect(screen.getByText(/auth diff ready/i)).toBeInTheDocument();
    expect(screen.getAllByText(/test_gap/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/needs_human_attention/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/补齐鉴权失败测试/i)).toBeInTheDocument();
    expect(screen.getByText(/证据对比|evidence comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/test_gap.*1/i)).toBeInTheDocument();
    expect(screen.getByText(/docs_ready.*1/i)).toBeInTheDocument();
    expect(screen.getByText(/needs_human_attention.*1/i)).toBeInTheDocument();
    expect(screen.getByText(/low.*1/i)).toBeInTheDocument();
    expect(screen.getByText(/证据差异|evidence differences/i)).toBeInTheDocument();
    expect(screen.getByText(/原因码.*2|reasoncode.*2/i)).toBeInTheDocument();
    expect(screen.getByText(/风险.*2|risk.*2/i)).toBeInTheDocument();
    expect(screen.getByText(/^(并排详情|side-by-side details)$/i)).toBeInTheDocument();
    const trajectorySummary = within(screen.getByTestId('artifact-workbench-trajectory-bundle-auth'));
    expect(trajectorySummary.getByText(/轨迹|trajectory/i)).toBeInTheDocument();
    expect(trajectorySummary.getByText('2')).toBeInTheDocument();
    expect(trajectorySummary.getByText(/失败步骤|failed steps/i)).toBeInTheDocument();
    expect(trajectorySummary.getByText('1')).toBeInTheDocument();
    expect(trajectorySummary.getByText(/最后步骤|last step/i)).toBeInTheDocument();
    expect(trajectorySummary.getByText(/rerun auth regression/i)).toBeInTheDocument();
    const trajectoryComparison = within(screen.getByTestId('artifact-workbench-trajectory-comparison'));
    expect(trajectoryComparison.getByText(/轨迹并排详情|trajectory side-by-side/i)).toBeInTheDocument();
    expect(trajectoryComparison.getByText(/^run auth regression$/i)).toBeInTheDocument();
    expect(trajectoryComparison.getByText(/verify docs index/i)).toBeInTheDocument();
    expect(trajectoryComparison.getByText(/pnpm docs:validate/i)).toBeInTheDocument();
    expect(screen.getByText(/Fix auth gate.*test_gap.*needs_human_attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Update docs.*docs_ready.*low/i)).toBeInTheDocument();
    expect(screen.getByText(/artifact:\/\/bundle-auth\/diff.patch/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /复制引用 diff|copy ref diff/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('artifact://bundle-auth/diff.patch'));
    fireEvent.click(screen.getByRole('button', { name: /展开文件 diff|open file diff/i }));
    expect(await screen.findByText(/workbench diff body/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/bundle-auth/files/diff.patch');
    fireEvent.click(screen.getByRole('button', { name: /展开轨迹文件 1|open trajectory file 1/i }));
    expect(await screen.findByText(/trajectory observation body/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/bundle-auth/files/test-results.txt');

    fireEvent.change(screen.getByPlaceholderText(/筛选|filter/i), {
      target: { value: 'test_gap' },
    });

    expect(screen.getByText(/auth diff ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/docs updated/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/筛选|filter/i), {
      target: { value: 'auth guard passed' },
    });

    expect(screen.getByText(/auth diff ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/docs updated/i)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('artifact-workbench-trajectory-comparison')).queryByText(/verify docs index/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText(/^Fix auth gate$/i)[0]);

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

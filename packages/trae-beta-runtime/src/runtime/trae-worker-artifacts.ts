import type { WorkerRuntimeReport, WorkerRuntimeTask } from "./worker.js";

interface ArtifactTrajectoryStep {
  stepId: string;
  sequence: number;
  phase: "preflight" | "action" | "observation" | "verification" | "result" | "cleanup";
  action: string;
  observation?: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "unknown";
}

export interface TraeWorkerPhaseEvent {
  type: string;
  taskId?: string | null;
  at: string;
  payload: Record<string, unknown>;
}

export interface TraeWorkerArtifactBundle {
  bundleId?: string;
  taskId: string;
  attemptId: string;
  schemaVersion: "artifact-bundle/v1";
  summary?: string;
  branch?: string;
  commit?: string;
  pullRequestUrl?: string;
  changedFiles: Array<{
    path: string;
    changeType: "added" | "modified" | "deleted" | "renamed";
  }>;
  refs: Record<string, unknown>;
  trajectory?: {
    schemaVersion: "artifact-trajectory/v1";
    steps: ArtifactTrajectoryStep[];
  };
  retainedContent?: {
    logs?: string;
    testResults?: string;
    trajectory?: string;
  };
  testResults?: Array<{
    name: string;
    status: "passed" | "failed" | "skipped" | "unknown";
    outputRef?: string;
  }>;
  riskNotes?: string[];
  nextActions?: string[];
  createdAt?: string;
}

export function buildTraeWorkerArtifactBundle(input: {
  task: WorkerRuntimeTask;
  status: "review_ready" | "failed";
  summary: string;
  filesChanged: string[];
  testOutput?: string;
  risks?: string[];
  notes?: string;
  github?: WorkerRuntimeReport["github"];
  sessionId?: string | null;
  remoteVerified?: boolean;
  failurePhase?: string;
  phaseEvents?: TraeWorkerPhaseEvent[];
}): TraeWorkerArtifactBundle | undefined {
  const attemptId = String(input.task.attempt_id || "").trim();
  if (!attemptId) {
    return undefined;
  }

  const trajectory = buildTraeWorkerTrajectory(input);
  return {
    bundleId: `${attemptId}:artifact-bundle`,
    taskId: input.task.task_id,
    attemptId,
    schemaVersion: "artifact-bundle/v1",
    summary: input.summary,
    branch: input.github?.branchName || input.task.branch,
    commit: input.github?.commitSha || undefined,
    pullRequestUrl: input.github?.prUrl || undefined,
    changedFiles: input.filesChanged.map((filePath) => ({
      path: filePath,
      changeType: "modified",
    })),
    refs: {
      structuredReport: `artifact://${attemptId}/result.json`,
      ...(input.sessionId ? { terminalTranscript: `artifact://${attemptId}/session-${input.sessionId}.log` } : {}),
    },
    trajectory,
    retainedContent: buildRetainedContent({
      taskId: input.task.task_id,
      status: input.status,
      summary: input.summary,
      sessionId: input.sessionId,
      testOutput: input.testOutput,
      trajectory,
      phaseEvents: input.phaseEvents ?? [],
    }),
    testResults: input.testOutput
      ? [{
          name: "trae:test_output",
          status: input.status === "review_ready" ? "passed" : "failed",
          outputRef: `artifact://${attemptId}/tests.txt`,
        }]
      : undefined,
    riskNotes: input.risks ?? [],
    nextActions: input.notes ? [input.notes] : [],
    createdAt: new Date().toISOString(),
  };
}

function buildRetainedContent(input: {
  taskId: string;
  status: "review_ready" | "failed";
  summary: string;
  sessionId?: string | null;
  testOutput?: string;
  trajectory: TraeWorkerArtifactBundle["trajectory"];
  phaseEvents: TraeWorkerPhaseEvent[];
}) {
  const lines = [
    `taskId=${input.taskId}`,
    `status=${input.status}`,
    ...(input.sessionId ? [`sessionId=${input.sessionId}`] : []),
    `summary=${input.summary}`,
    ...input.phaseEvents.map((event) => `phaseEvent=${event.at} ${event.type} ${formatPayload(event.payload)}`),
  ];
  return {
    logs: `${lines.join("\n")}\n`,
    ...(input.testOutput ? { testResults: input.testOutput } : {}),
    trajectory: JSON.stringify(input.trajectory, null, 2),
  };
}

function buildTraeWorkerTrajectory(input: {
  status: "review_ready" | "failed";
  summary: string;
  sessionId?: string | null;
  testOutput?: string;
  remoteVerified?: boolean;
  failurePhase?: string;
  phaseEvents?: TraeWorkerPhaseEvent[];
}) {
  const steps = buildPhaseEventSteps(input.phaseEvents ?? []);

  pushFallbackStep(steps, "等待 Trae automation gateway readiness", () => (
    step(steps.length, "preflight", "等待 Trae automation gateway readiness", "succeeded")
  ));
  pushFallbackStep(steps, "准备 Trae automation 会话", () => (
    step(steps.length, "preflight", "准备 Trae automation 会话", input.sessionId ? "succeeded" : "unknown", input.sessionId || undefined)
  ));
  pushFallbackStep(steps, "发送任务 prompt 到 Trae 会话", () => (
    step(steps.length, "action", "发送任务 prompt 到 Trae 会话", input.status === "review_ready" ? "succeeded" : "unknown")
  ));

  if (input.testOutput) {
    steps.push(step(steps.length, "verification", "记录 worker 验证输出", input.status === "review_ready" ? "succeeded" : "failed", input.testOutput));
  }

  steps.push(step(
    steps.length,
    "verification",
    "校验远端分支和提交可审查",
    input.remoteVerified === true ? "succeeded" : input.status === "review_ready" ? "unknown" : "skipped",
  ));
  steps.push(step(
    steps.length,
    "result",
    "提交 worker 结果到 dispatcher",
    input.status === "review_ready" ? "succeeded" : "failed",
    input.summary,
  ));

  if (input.sessionId) {
    steps.push(step(steps.length, "cleanup", "释放 Trae automation 会话", "succeeded", input.sessionId));
  }

  return {
    schemaVersion: "artifact-trajectory/v1" as const,
    steps,
  };
}

function step(
  sequence: number,
  phase: ArtifactTrajectoryStep["phase"],
  action: string,
  status: ArtifactTrajectoryStep["status"],
  observation?: string,
): ArtifactTrajectoryStep {
  return {
    stepId: `trae-${sequence}`,
    sequence,
    phase,
    action,
    status,
    ...(observation ? { observation } : {}),
  };
}

function buildPhaseEventSteps(events: TraeWorkerPhaseEvent[]): ArtifactTrajectoryStep[] {
  const mapped = events
    .map((event) => phaseEventStep(event))
    .filter((value): value is Omit<ArtifactTrajectoryStep, "sequence"> => Boolean(value));
  return mapped.map((item, sequence) => ({ ...item, sequence }));
}

function phaseEventStep(event: TraeWorkerPhaseEvent): Omit<ArtifactTrajectoryStep, "sequence"> | null {
  const mapped = mapPhaseEvent(event.type);
  if (!mapped) {
    return null;
  }
  return {
    stepId: `trae-${event.type}`,
    phase: mapped.phase,
    action: mapped.action,
    status: mapped.status,
    observation: formatPayload(event.payload),
  };
}

function mapPhaseEvent(type: string): Pick<ArtifactTrajectoryStep, "phase" | "action" | "status"> | null {
  if (type === "readiness_wait_done" || type === "readiness_wait_failed") {
    return { phase: "preflight", action: "等待 Trae automation gateway readiness", status: type.endsWith("_failed") ? "failed" : "succeeded" };
  }
  if (type === "prepare_session_done" || type === "prepare_session_failed") {
    return { phase: "preflight", action: "准备 Trae automation 会话", status: type.endsWith("_failed") ? "failed" : "succeeded" };
  }
  if (type === "send_chat_done" || type === "send_chat_failed") {
    return { phase: "action", action: "发送任务 prompt 到 Trae 会话", status: type.endsWith("_failed") ? "failed" : "succeeded" };
  }
  if (type === "session_recovery_start" || type === "session_recovery_done" || type === "session_recovery_failed") {
    return { phase: "observation", action: "恢复 Trae automation 会话", status: type.endsWith("_failed") ? "failed" : type.endsWith("_done") ? "succeeded" : "running" };
  }
  if (type === "artifact_check_done" || type === "artifact_check_failed") {
    return { phase: "verification", action: "检查 git artifact 可审查性", status: type.endsWith("_failed") ? "failed" : "succeeded" };
  }
  if (type === "workspace_prepare_done" || type === "workspace_prepare_failed") {
    return { phase: "preflight", action: "准备任务 worktree", status: type.endsWith("_failed") ? "failed" : "succeeded" };
  }
  if (type === "start_task_done" || type === "start_task_failed") {
    return { phase: "preflight", action: "启动 dispatcher task attempt", status: type.endsWith("_failed") ? "failed" : "succeeded" };
  }
  return null;
}

function pushFallbackStep(
  steps: ArtifactTrajectoryStep[],
  action: string,
  create: () => ArtifactTrajectoryStep,
) {
  if (!steps.some((item) => item.action === action)) {
    steps.push(create());
  }
}

function formatPayload(payload: Record<string, unknown>) {
  if (Object.keys(payload).length === 0) {
    return "{}";
  }
  return JSON.stringify(payload);
}

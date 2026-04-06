import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isEquivalentReportedTaskId,
  isPlaceholderTaskId,
} from "@tingrudeng/automation-gateway-core";

interface WorkerFailure {
  type: string;
  message: string;
}

interface WorkerEvidence {
  failureType?: string;
  failureSummary?: string;
  blockers?: WorkerFailure[];
  findings?: unknown[];
  artifacts?: Record<string, string>;
}

import {
  createAutomationGatewayClient,
  createDispatcherClient,
} from "./clients.js";
import { checkArtifactReviewability } from "./trae-automation-artifact-checks.js";
import { launchTraeForAutomation } from "./trae-launcher.js";
import {
  prepareTaskWorktree,
  safeTaskDirName,
} from "./task-worktree.js";

const DEFAULT_POLL_INTERVAL_MS = Number(process.env.TRAE_AUTOMATION_POLL_INTERVAL_MS || 5000);
const DEFAULT_ERROR_BACKOFF_MS = Number(process.env.TRAE_AUTOMATION_ERROR_BACKOFF_MS || 5000);
const MAX_ERROR_BACKOFF_MS = Number(process.env.TRAE_AUTOMATION_MAX_ERROR_BACKOFF_MS || 30000);
const DEFAULT_READINESS_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_READY_TIMEOUT_MS || 30000);
const DEFAULT_READINESS_RETRY_MS = Number(process.env.TRAE_AUTOMATION_READY_RETRY_MS || 1000);
const DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS = Number(
  process.env.TRAE_AUTOMATION_CHAT_REQUEST_TIMEOUT_BUFFER_MS || 30000
);
const HIGH_HEARTBEAT_INTERVAL_MS = 10_000;
const IDLE_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_SOFT_CHAT_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_SOFT_CHAT_TIMEOUT_MS || 30 * 60 * 1000);
const DEFAULT_HARD_CHAT_TIMEOUT_MS = Number(process.env.TRAE_AUTOMATION_HARD_CHAT_TIMEOUT_MS || 60 * 60 * 1000);
const MAX_HARD_CHAT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_POLL_INTERVAL_MS = Number(process.env.TRAE_AUTOMATION_SESSION_POLL_INTERVAL_MS || 10000);
const DEFAULT_ACTIVITY_IDLE_THRESHOLD_MS = Number(process.env.TRAE_AUTOMATION_ACTIVITY_IDLE_THRESHOLD_MS || 5 * 60 * 1000);
const SESSION_EXTENSION_INTERVAL_MS = 5 * 60 * 1000;

export interface WorkerRuntimeOptions {
  dispatcherClient: ReturnType<typeof createDispatcherClient>;
  automationClient: ReturnType<typeof createAutomationGatewayClient>;
  workerId: string;
  repoDir: string;
  traeBin?: string;
  remoteDebuggingPort?: number;
  logger?: Pick<typeof console, "warn" | "log">;
  debug?: boolean;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  errorBackoffMs?: number;
  maxErrorBackoffMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  launchTrae?: (options: {
    traeBin: string;
    projectPath: string;
    remoteDebuggingPort: number;
  }) => Promise<unknown>;
}

export interface WorkerDiscoveryHints {
  titleContains?: string[];
  urlContains?: string[];
}

export interface WorkerRuntimeTask {
  task_id: string;
  repo?: string;
  branch?: string;
  default_branch?: string;
  defaultBranch?: string;
  scope?: string[];
  acceptance?: string[];
  constraints?: string[];
  goal?: string;
  prompt?: string;
  worktree_dir?: string;
  assignment_dir?: string;
  execution_dir?: string;
  continuationMode?: string;
  continuation_mode?: string;
  chatMode?: string;
  chat_mode?: string;
}

export interface WorkerRuntimeReport {
  result: string;
  taskId: string;
  conclusionType: "repo_fix" | "environment_only" | null;
  filesChanged: string[];
  testOutput: string;
  risks: string[];
  environmentEvidence: string;
  notes: string;
  github: {
    branchName: string | null;
    commitSha: string | null;
    pushStatus: string;
    pushError: string | null;
    prNumber: number | null;
    prUrl: string | null;
  };
}

function isDebugEnabled(value: unknown) {
  if (value === true) {
    return true;
  }
  const envValue = String(process.env.TRAE_AUTOMATION_DEBUG || "").trim().toLowerCase();
  return envValue === "1" || envValue === "true";
}

function makeDebugLogger(
  logger: Pick<typeof console, "warn" | "log">,
  enabled: boolean,
) {
  return (event: string, details: Record<string, unknown> = {}) => {
    if (!enabled) {
      return;
    }
    const payload = {
      at: new Date().toISOString(),
      event,
      ...details,
    };
    try {
      logger.log?.(`[trae-automation-worker][debug] ${JSON.stringify(payload)}`);
    } catch {
      logger.log?.(`[trae-automation-worker][debug] ${event}`);
    }
  };
}

function previewText(value: string, maxLength = 200) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function buildFinalReportTemplate() {
  return [
    "## 任务完成",
    "- 结果: 成功 / 失败",
    "- 任务ID: <task_id>",
    "- 结论类型: <repo_fix / environment_only；默认 repo_fix，无环境结论时也可写\"无\">",
    "- 修改文件: <files_changed> (无则写\"无\")",
    "- 测试结果: <test_output> (无则写\"无\")",
    "- 风险: <risks> (无则写\"无\")",
    "- 环境证据: <仅 environment_only 时填写；否则写\"无\">",
    "- GitHub 证据:",
    "  - branch: <branch_name> (无则写\"无\")",
    "  - commit: <commit_sha> (无则写\"无\")",
    "  - push: <push_status> (无则写\"无\")",
    "  - push_error: <push_error> (无则写\"无\")",
    "  - PR: <pr_number> (无则写\"无\")",
    "  - PR URL: <pr_url> (无则写\"无\")",
    "- 备注: <阻塞/后续动作；无则写\"无\">",
  ].join("\n");
}

function normalizeFieldValue(value: unknown) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "无") {
    return "";
  }
  return trimmed;
}

function splitListValue(value: unknown) {
  const normalized = normalizeFieldValue(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[，,、;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizePushStatus(value: unknown) {
  const normalized = normalizeFieldValue(value).toLowerCase();
  if (!normalized) {
    return "not_attempted";
  }
  if (normalized === "success" || normalized === "成功") {
    return "success";
  }
  if (normalized === "failed" || normalized === "failure" || normalized === "失败") {
    return "failed";
  }
  return "not_attempted";
}

function normalizeConclusionType(value: unknown): WorkerRuntimeReport["conclusionType"] {
  const normalized = normalizeFieldValue(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "repo_fix") {
    return "repo_fix";
  }
  if (normalized === "environment_only") {
    return "environment_only";
  }
  return null;
}

function basenameFromPath(value: unknown) {
  const normalized = String(value || "").trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "";
}

export function buildAutomationPrompt(task: WorkerRuntimeTask) {
  const scope = Array.isArray(task.scope) && task.scope.length > 0 ? task.scope.join(", ") : "all";
  const constraints = Array.isArray(task.constraints) && task.constraints.length > 0
    ? task.constraints.map((item) => `- ${item}`).join("\n")
    : "- none";
  const acceptance = Array.isArray(task.acceptance) && task.acceptance.length > 0
    ? task.acceptance.map((item) => `- ${item}`).join("\n")
    : "- none";

  return [
    "你正在以 ForgeFlow 的无人值守 Trae 执行 worker 身份工作。",
    "请直接执行任务，不要解释流程，不要反问。",
    "",
    `任务ID: ${task.task_id}`,
    `仓库: ${task.repo || "unknown"}`,
    `分支: ${task.branch || "unknown"}`,
    `目标: ${task.goal || task.prompt || "未提供"}`,
    `允许范围: ${scope}`,
    `worktree_dir: ${task.worktree_dir || "无"}`,
    `assignment_dir: ${task.assignment_dir || "无"}`,
    "",
    "约束：",
    constraints,
    "",
    "验收命令：",
    acceptance,
    "",
    "任务说明：",
    task.prompt || task.goal || "",
    "",
    "执行上下文预检要求：",
    "在进行任何文件编辑之前，必须先完成执行上下文预检证明：",
    "1. 报告当前仓库路径 (pwd 或 cwd)",
    "2. 报告当前分支 (git branch --show-current)",
    "3. 报告 git status --short 输出",
    "",
    "说明：以上信息仅供了解当前工作环境，不是失败条件。",
    "",
    "完成要求：",
    "- 先完成执行上下文预检证明",
    "- 只在允许范围内修改文件",
    "- 运行验收命令",
    "- 如果可以，提交并推送变更",
    "- 最终必须严格按下面模板回复",
    "",
    buildFinalReportTemplate(),
  ].join("\n");
}

export function parseFinalReport(text: string): WorkerRuntimeReport {
  const lines = String(text || "").split(/\r?\n/);
  const fields = {
    result: "",
    taskId: "",
    conclusionType: "",
    filesChanged: "",
    testOutput: "",
    risks: "",
    environmentEvidence: "",
    notes: "",
    branch: "",
    commit: "",
    push: "",
    pushError: "",
    pr: "",
    prUrl: "",
  };

  let section = "";
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    if (line.trim() === "## 任务完成" || line.trim() === "任务完成") {
      continue;
    }
    if (line.trim() === "- GitHub 证据:" || line.trim() === "GitHub 证据:") {
      section = "github";
      continue;
    }

    const match = line.match(/^\s*(?:-\s*)?([^:]+):\s*(.*)$/);
    if (!match) {
      if (section === "test" && fields.testOutput) {
        fields.testOutput += `\n${line.trim()}`;
      } else if (section === "environment" && fields.environmentEvidence) {
        fields.environmentEvidence += `\n${line.trim()}`;
      }
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim();
    switch (key) {
      case "结果":
        fields.result = value;
        section = "";
        break;
      case "任务ID":
        fields.taskId = value;
        section = "";
        break;
      case "结论类型":
        fields.conclusionType = value;
        section = "";
        break;
      case "修改文件":
        fields.filesChanged = value;
        section = "";
        break;
      case "测试结果":
        fields.testOutput = value;
        section = "test";
        break;
      case "风险":
        fields.risks = value;
        section = "";
        break;
      case "环境证据":
        fields.environmentEvidence = value;
        section = "environment";
        break;
      case "备注":
        fields.notes = value;
        section = "";
        break;
      case "branch":
        fields.branch = value;
        break;
      case "commit":
        fields.commit = value;
        break;
      case "push":
        fields.push = value;
        break;
      case "push_error":
        fields.pushError = value;
        break;
      case "PR":
        fields.pr = value;
        break;
      case "PR URL":
        fields.prUrl = value;
        break;
      default:
        break;
    }
  }

  if (!fields.result || !fields.taskId) {
    throw new Error("final report did not match the required template");
  }

  return {
    result: fields.result,
    taskId: fields.taskId,
    conclusionType: normalizeConclusionType(fields.conclusionType),
    filesChanged: splitListValue(fields.filesChanged),
    testOutput: normalizeFieldValue(fields.testOutput),
    risks: splitListValue(fields.risks),
    environmentEvidence: normalizeFieldValue(fields.environmentEvidence),
    notes: normalizeFieldValue(fields.notes),
    github: {
      branchName: normalizeFieldValue(fields.branch) || null,
      commitSha: normalizeFieldValue(fields.commit) || null,
      pushStatus: normalizePushStatus(fields.push),
      pushError: normalizeFieldValue(fields.pushError) || null,
      prNumber: normalizeFieldValue(fields.pr) ? Number(normalizeFieldValue(fields.pr)) : null,
      prUrl: normalizeFieldValue(fields.prUrl) || null,
    },
  };
}

function hasCodeChangeEvidence(parsed: WorkerRuntimeReport) {
  return parsed.filesChanged.length > 0
    || Boolean(parsed.github.commitSha)
    || parsed.github.pushStatus === "success"
    || parsed.github.pushStatus === "verified"
    || Boolean(parsed.github.prNumber)
    || Boolean(parsed.github.prUrl);
}

function isEnvironmentOnlySuccess(parsed: WorkerRuntimeReport) {
  return parsed.conclusionType === "environment_only" && Boolean(parsed.environmentEvidence);
}

function buildSuccessEvidence(parsed: WorkerRuntimeReport, source = "chat_completion"): WorkerEvidence {
  const artifacts: Record<string, string> = {
    source,
    conclusionType: parsed.conclusionType || "repo_fix",
    branchName: parsed.github.branchName || "unknown",
    commitSha: parsed.github.commitSha || "unknown",
    pushStatus: parsed.github.pushStatus,
    filesChanged: parsed.filesChanged.join(","),
  };

  if (parsed.environmentEvidence) {
    artifacts.environmentEvidence = parsed.environmentEvidence;
  }
  if (parsed.conclusionType === "environment_only") {
    artifacts.noRepoCodeChange = "true";
  }

  return {
    blockers: [],
    findings: [],
    artifacts,
  };
}

function buildInvalidSuccessFailureEvidence(message: string): WorkerEvidence {
  return {
    failureType: "unknown",
    failureSummary: message,
    blockers: [],
    findings: [],
  };
}

export function deriveTaskDiscoveryHints(
  task: Pick<WorkerRuntimeTask, "worktree_dir" | "assignment_dir"> | undefined,
  repoDir = "",
) {
  const titleContains: string[] = [];
  const seen = new Set<string>();

  const taskCandidates = [
    task?.worktree_dir,
    task?.assignment_dir,
  ];

  for (const candidate of taskCandidates) {
    const hint = basenameFromPath(candidate);
    if (!hint) {
      continue;
    }
    const key = hint.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    titleContains.push(hint);
  }

  if (titleContains.length === 0) {
    const repoHint = basenameFromPath(repoDir);
    if (repoHint) {
      titleContains.push(repoHint);
    }
  }

  return titleContains.length > 0 ? { titleContains } : undefined;
}

function isTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out/i.test(message);
}

function isTemplateEchoError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /template echo/i.test(message);
}

function shouldAttemptSessionRecovery(error: unknown) {
  return isTimeoutError(error) || isTemplateEchoError(error);
}

function createMissingSessionIdRecoveryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Session recovery unavailable: missing sessionId from prepareSession. Original chat error: ${message}`);
}

export function deriveRegisterDiscoveryHints(repoDir = "") {
  const hint = basenameFromPath(repoDir);
  return hint ? { titleContains: [hint] } : undefined;
}

export function isAutomationGatewayReady(readiness: unknown) {
  const typed = readiness as { data?: { ready?: boolean }; ready?: boolean } | undefined;
  return typed?.data?.ready === true || typed?.ready === true;
}

export async function waitForAutomationGatewayReady(options: {
  automationClient: { ready: (input?: { discovery?: WorkerDiscoveryHints }) => Promise<unknown> };
  repoDir?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  logger?: Pick<typeof console, "warn">;
  timeoutMs?: number;
  retryIntervalMs?: number;
  discovery?: WorkerDiscoveryHints;
  initialReadiness?: unknown;
}){
  const automationClient = options.automationClient;
  const repoDir = options.repoDir || "";
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = typeof options.now === "function" ? options.now : Date.now;
  const logger = options.logger || console;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_READINESS_TIMEOUT_MS);
  const retryIntervalMs = Number(options.retryIntervalMs || DEFAULT_READINESS_RETRY_MS);
  const discovery = options.discovery || deriveRegisterDiscoveryHints(repoDir);

  if (!automationClient || typeof automationClient.ready !== "function") {
    throw new Error("automationClient.ready is required");
  }

  const startedAt = now();
  let attempt = 0;
  let lastReadiness = options.initialReadiness;
  let lastError: Error | null = null;

  while (now() - startedAt < timeoutMs) {
    attempt += 1;
    try {
      const readiness = attempt === 1 && lastReadiness !== undefined
        ? lastReadiness
        : await automationClient.ready({ discovery });
      lastReadiness = readiness;
      if (isAutomationGatewayReady(readiness)) {
        return readiness;
      }
      const code = (readiness as { error?: { code?: string } } | undefined)?.error?.code || "AUTOMATION_NOT_READY";
      logger?.warn?.(
        `[trae-automation-worker] gateway readiness attempt ${attempt} not ready: ${code}`
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger?.warn?.(
        `[trae-automation-worker] gateway readiness attempt ${attempt} failed: ${lastError.message}`
      );
    }

    if (now() - startedAt + retryIntervalMs >= timeoutMs) {
      break;
    }
    await sleep(retryIntervalMs);
  }

  if (lastError) {
    throw new Error(`Trae automation gateway is not ready: ${lastError.message}`);
  }
  if ((lastReadiness as { error?: { code?: string } } | undefined)?.error?.code) {
    throw new Error(`Trae automation gateway is not ready: ${(lastReadiness as { error?: { code?: string } }).error?.code}`);
  }
  throw new Error("Trae automation gateway is not ready");
}

export function materializeTaskWorkspace(task: WorkerRuntimeTask, repoDir: string) {
  const taskId = String(task?.task_id || "").trim();
  if (!taskId) {
    throw new Error("task_id is required to materialize task workspace");
  }

  const resolvedRepoDir = String(repoDir || "").trim();
  if (!resolvedRepoDir) {
    throw new Error("repoDir is required to materialize task workspace");
  }

  const worktreeDir = prepareTaskWorktree(resolvedRepoDir, {
    taskId,
    branchName: task.branch,
    defaultBranch: task.default_branch || task.defaultBranch,
  }, {
    allowReuse: true,
  });
  const assignmentDir = path.join(
    worktreeDir,
    ".orchestrator",
    "assignments",
    safeTaskDirName(taskId)
  );

  fs.mkdirSync(assignmentDir, { recursive: true });

  const assignmentPayload = {
    taskId,
    repo: task.repo || "",
    branchName: task.branch || "",
    defaultBranch: task.default_branch || task.defaultBranch || "",
    allowedPaths: Array.isArray(task.scope) ? task.scope : [],
    acceptance: Array.isArray(task.acceptance) ? task.acceptance : [],
    constraints: Array.isArray(task.constraints) ? task.constraints : [],
    goal: task.goal || "",
  };

  fs.writeFileSync(
    path.join(assignmentDir, "assignment.json"),
    JSON.stringify(assignmentPayload, null, 2)
  );
  fs.writeFileSync(path.join(assignmentDir, "worker-prompt.md"), task.prompt || "");
  fs.writeFileSync(path.join(assignmentDir, "context.md"), task.prompt || task.goal || "");

  task.worktree_dir = worktreeDir;
  task.assignment_dir = assignmentDir;
  return { worktree_dir: worktreeDir, assignment_dir: assignmentDir };
}

function createHeartbeatController(
  dispatcherClient: WorkerRuntimeOptions["dispatcherClient"],
  workerId: string,
  logger: Pick<typeof console, "warn">,
  options: WorkerRuntimeOptions,
) {
  const timers = {
    interval: null as ReturnType<typeof setInterval> | null,
    mode: "idle",
  };
  const setIntervalImpl = options.setIntervalImpl || setInterval;
  const clearIntervalImpl = options.clearIntervalImpl || clearInterval;

  function start(mode = "high") {
    if (timers.interval) {
      clearIntervalImpl(timers.interval);
    }
    timers.mode = mode;
    const intervalMs = mode === "high" ? HIGH_HEARTBEAT_INTERVAL_MS : IDLE_HEARTBEAT_INTERVAL_MS;
    timers.interval = setIntervalImpl(async () => {
      try {
        await dispatcherClient.heartbeat(workerId);
      } catch (error) {
        logger?.warn?.(`[trae-automation-worker] heartbeat failed: ${(error as Error).message}`);
      }
    }, intervalMs);
  }

  function promoteToIdle() {
    if (timers.mode !== "idle") {
      start("idle");
    }
  }

  function stop() {
    if (timers.interval) {
      clearIntervalImpl(timers.interval);
      timers.interval = null;
    }
  }

  return { start, promoteToIdle, stop };
}

export function createTraeAutomationWorkerRuntime(options: WorkerRuntimeOptions) {
  const dispatcherClient = options.dispatcherClient;
  const automationClient = options.automationClient;
  const workerId = options.workerId;
  const repoDir = options.repoDir;
  const logger = options.logger || console;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  const errorBackoffMs = Number(options.errorBackoffMs || DEFAULT_ERROR_BACKOFF_MS);
  const maxErrorBackoffMs = Number(options.maxErrorBackoffMs || MAX_ERROR_BACKOFF_MS);
  const traeBin = String(
    options.traeBin
    || process.env.FORGEFLOW_TRAE_BIN
    || process.env.TRAE_BIN
    || "",
  ).trim();
  const remoteDebuggingPort = Number(
    options.remoteDebuggingPort
    || process.env.FORGEFLOW_REMOTE_DEBUGGING_PORT
    || process.env.TRAE_REMOTE_DEBUGGING_PORT
    || 9222,
  );
  const heartbeat = createHeartbeatController(dispatcherClient, workerId, logger, options);
  const launchTrae = options.launchTrae || ((launchOptions) => launchTraeForAutomation({
    ...launchOptions,
    preferExisting: false,
  }));
  const debugLog = makeDebugLogger(logger, isDebugEnabled(options.debug));

  if (!dispatcherClient || !automationClient || !workerId || !repoDir) {
    throw new Error("dispatcherClient, automationClient, workerId, and repoDir are required");
  }

  async function releaseTaskSession(sessionId: string | null) {
    if (!sessionId) {
      return;
    }
    debugLog("session.release.start", { sessionId });
    try {
      await automationClient.releaseSession(sessionId);
      debugLog("session.release.done", { sessionId });
    } catch (error) {
      debugLog("session.release.error", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      logger.warn?.(
        `[trae-automation-worker] failed to release session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function submitParsedResult(task: WorkerRuntimeTask, parsed: WorkerRuntimeReport, sessionId: string | null) {
    const successRequested = parsed.result === "成功";
    const successAllowed = hasCodeChangeEvidence(parsed) || isEnvironmentOnlySuccess(parsed);
    const status = successRequested && successAllowed ? "review_ready" : "failed";
    const invalidSuccessMessage = successRequested && !successAllowed
      ? "success report missing code-change evidence or explicit environment_only proof"
      : null;
    const evidence = status === "review_ready"
      ? buildSuccessEvidence(parsed)
      : invalidSuccessMessage
        ? buildInvalidSuccessFailureEvidence(invalidSuccessMessage)
        : undefined;
    const summary = invalidSuccessMessage
      ? invalidSuccessMessage
      : parsed.notes || parsed.environmentEvidence || parsed.result;

    debugLog("dispatcher.submit_result.start", {
      taskId: task.task_id,
      status,
      sessionId,
      filesChangedCount: parsed.filesChanged.length,
      hasCommit: Boolean(parsed.github.commitSha),
      pushStatus: parsed.github.pushStatus,
      conclusionType: parsed.conclusionType,
      hasEnvironmentEvidence: Boolean(parsed.environmentEvidence),
    });
    try {
      await dispatcherClient.submitResult({
        taskId: task.task_id,
        status,
        summary,
        testOutput: parsed.testOutput || "",
        risks: parsed.risks,
        filesChanged: parsed.filesChanged,
        github: parsed.github,
        ...(evidence ? { evidence } : {}),
      });
      debugLog("dispatcher.submit_result.done", { taskId: task.task_id, status });
    } finally {
      heartbeat.promoteToIdle();
      await releaseTaskSession(sessionId);
    }
    return status;
  }

  async function submitFailure(task: WorkerRuntimeTask, error: Error, rawOutput = "", sessionId: string | null = null) {
    const failureType = /test|vitest|jest|pnpm test/i.test(error.message) ? "verification" : "execution";
    const evidence: WorkerEvidence = {
      failureType,
      failureSummary: error.message,
      blockers: [],
      findings: [],
    };

    debugLog("dispatcher.submit_result.start", {
      taskId: task.task_id,
      status: "failed",
      sessionId,
      summary: error.message,
      failureType,
    });
    try {
      await dispatcherClient.submitResult({
        taskId: task.task_id,
        status: "failed",
        summary: error.message,
        testOutput: rawOutput,
        risks: [],
        filesChanged: [],
        github: {
          branchName: null,
          commitSha: null,
          pushStatus: "not_attempted",
          pushError: null,
          prNumber: null,
          prUrl: null,
        },
        evidence,
      });
      debugLog("dispatcher.submit_result.done", { taskId: task.task_id, status: "failed" });
    } finally {
      heartbeat.promoteToIdle();
      await releaseTaskSession(sessionId);
    }
  }

  function classifyPreStartFailure(error: Error): string {
    const message = String(error?.message || "");
    const isWorkspaceError = /(worktree|branch .*already checked out|failed to create worktree|failed to fetch origin|default branch ref|taskId is required|repoDir is required|branchName is required)/i
      .test(message);
    const code = isWorkspaceError ? "workspace_prepare_failed" : "task_start_failed";
    return `${code}: ${message}`;
  }

  function getResponseText(response: unknown) {
    return (response as {
      data?: { response?: { text?: string }; result?: { response?: { text?: string } } };
      response?: { text?: string };
    })?.data?.response?.text
      || (response as { response?: { text?: string } })?.response?.text
      || (response as { data?: { result?: { response?: { text?: string } } } })?.data?.result?.response?.text
      || "";
  }

  async function tryRecoverFromCurrentSession(task: WorkerRuntimeTask, sessionId: string | null) {
    if (!sessionId || typeof automationClient.getSession !== "function") {
      return null;
    }

    await dispatcherClient.reportProgress(
      task.task_id,
      "Task ID mismatch detected, checking current session response",
      workerId,
    );
    const session = await automationClient.getSession(sessionId);
    const sessionData = (session as {
      data?: {
        status?: string;
        responseText?: string | null;
      };
      status?: string;
      responseText?: string | null;
    } | undefined)?.data
      || (session as {
        status?: string;
        responseText?: string | null;
      } | undefined);

    if (sessionData?.status !== "completed") {
      return null;
    }

    const finalText = String(sessionData.responseText || "").trim();
    if (!finalText) {
      return null;
    }

    const parsed = parseFinalReport(finalText);
    if (isPlaceholderTaskId(parsed.taskId)) {
      return null;
    }
    if (!isEquivalentReportedTaskId(task.task_id, parsed.taskId)) {
      return null;
    }

    await dispatcherClient.reportProgress(
      task.task_id,
      "Session completed, extracting stored response",
      workerId,
    );
    const finalStatus = await submitParsedResult(task, parsed, sessionId);
    return {
      status: finalStatus,
      taskId: task.task_id,
      responseText: finalText,
    };
  }

  async function pollSessionStatus(
    sessionId: string,
    timeoutMs: number,
    pollIntervalMs: number,
    activityIdleThresholdMs: number = DEFAULT_ACTIVITY_IDLE_THRESHOLD_MS,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const session = await automationClient.getSession(sessionId);
        const sessionData = (session as {
          data?: {
            status?: string;
            lastActivityAt?: string;
            responseDetected?: boolean;
            responseText?: string | null;
            error?: string | null;
          };
          status?: string;
          lastActivityAt?: string;
          responseDetected?: boolean;
          responseText?: string | null;
          error?: string | null;
        } | undefined)?.data
          || (session as {
            status?: string;
            lastActivityAt?: string;
            responseDetected?: boolean;
            responseText?: string | null;
            error?: string | null;
          } | undefined)
          || { status: "running" };
        const status = sessionData.status;
        debugLog("session.poll", {
          sessionId,
          status,
          responseDetected: Boolean(sessionData.responseDetected),
          hasResponseText: Boolean(sessionData.responseText && String(sessionData.responseText).trim()),
          lastActivityAt: sessionData.lastActivityAt || null,
        });
        if (status === "completed" || status === "failed" || status === "interrupted") {
          return sessionData;
        }

        if (sessionData.responseDetected === true) {
          return sessionData;
        }

        const lastActivityAt = sessionData.lastActivityAt;
        if (lastActivityAt) {
          const lastActivityTs = Date.parse(lastActivityAt);
          if (!Number.isNaN(lastActivityTs)) {
            const idleDuration = Date.now() - lastActivityTs;
            if (idleDuration > activityIdleThresholdMs) {
              return {
                ...sessionData,
                status: "running",
                activityStopped: true,
                idleDuration,
              };
            }
          }
        }
        await sleep(pollIntervalMs);
      } catch (error) {
        debugLog("session.poll.error", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        await sleep(pollIntervalMs);
      }
    }
    debugLog("session.poll.timeout", { sessionId, timeoutMs });
    return { status: "running" };
  }

  const runtime = {
    async register() {
      debugLog("worker.register.start", { workerId, repoDir });
      await dispatcherClient.register({
        workerId,
        pool: "trae",
        repoDir,
        labels: ["automation-gateway"],
      });
      heartbeat.start("idle");
      const readiness = await automationClient.ready({
        discovery: deriveRegisterDiscoveryHints(repoDir),
      });
      debugLog("worker.register.done", { workerId, ready: isAutomationGatewayReady(readiness) });
      return readiness;
    },

    async runOnce() {
      const fetched = await dispatcherClient.fetchTask(workerId, repoDir);
      if (!fetched || (fetched as { status?: string }).status === "no_task") {
        debugLog("worker.fetch_task.no_task", { workerId, repoDir });
        return { status: "no_task" };
      }

      const task = (fetched as { task: WorkerRuntimeTask }).task;
      debugLog("worker.fetch_task.assigned", {
        workerId,
        taskId: task.task_id,
        branch: task.branch || null,
        repo: task.repo || null,
      });
      try {
        materializeTaskWorkspace(task, repoDir);
        task.execution_dir = repoDir;
        await dispatcherClient.startTask(workerId, task.task_id);
        heartbeat.start("high");
        await dispatcherClient.reportProgress(task.task_id, "Trae automation worker started task", workerId);
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const summary = classifyPreStartFailure(normalizedError);
        try {
          await dispatcherClient.reportProgress(task.task_id, `Task bootstrap failed: ${summary}`, workerId);
        } catch {
          // progress reporting failure should not block terminal failure submission
        }
        await submitFailure(task, new Error(summary), "");
        return {
          status: "failed",
          taskId: task.task_id,
          error: summary,
        };
      }

      const prompt = buildAutomationPrompt(task);
      debugLog("worker.task.prompt_built", {
        taskId: task.task_id,
        promptLength: prompt.length,
      });
      const discovery = deriveTaskDiscoveryHints(task, repoDir);
      let sessionId: string | null = null;
      const startedAt = Date.now();
      try {
        await dispatcherClient.reportProgress(
          task.task_id,
          "Trae automation gateway is waiting for task target readiness",
          workerId,
        );
        await waitForAutomationGatewayReady({
          automationClient,
          repoDir,
          discovery,
          logger,
          timeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
          retryIntervalMs: DEFAULT_READINESS_RETRY_MS,
          sleep,
        });
        await dispatcherClient.reportProgress(task.task_id, "Trae automation gateway is preparing session", workerId);
        const continuationMode = (task as WorkerRuntimeTask & { continuationMode?: string; continuation_mode?: string }).continuationMode
          || (task as WorkerRuntimeTask & { continuation_mode?: string }).continuation_mode;
        const explicitChatMode = (task as WorkerRuntimeTask & { chatMode?: string; chat_mode?: string }).chatMode
          || (task as WorkerRuntimeTask & { chatMode?: string; chat_mode?: string }).chat_mode;
        const chatMode = continuationMode === "continue"
          ? "continue"
          : (explicitChatMode || "new_chat");
        const prepareResult = await automationClient.prepareSession({
          discovery,
          chatMode,
        });
        sessionId = (prepareResult as { data?: { sessionId?: string }; sessionId?: string } | undefined)?.data?.sessionId
          || (prepareResult as { sessionId?: string } | undefined)?.sessionId
          || null;
        debugLog("gateway.prepare_session.done", {
          taskId: task.task_id,
          sessionId,
          chatMode,
        });

        await dispatcherClient.reportProgress(task.task_id, "Trae automation gateway is sending prompt", workerId);
        const hardTimeoutMs = Math.min(DEFAULT_HARD_CHAT_TIMEOUT_MS, MAX_HARD_CHAT_TIMEOUT_MS);
        const softTimeoutMs = Math.min(DEFAULT_SOFT_CHAT_TIMEOUT_MS, hardTimeoutMs);
        const chatTimeoutMs = softTimeoutMs + DEFAULT_CHAT_REQUEST_TIMEOUT_BUFFER_MS;

        try {
          debugLog("gateway.send_chat.start", {
            taskId: task.task_id,
            sessionId,
            chatMode,
            softTimeoutMs,
            chatTimeoutMs,
          });
          const response = await automationClient.sendChat({
            content: prompt,
            sessionId,
            expectedTaskId: task.task_id,
            prepare: false,
            discovery,
            chatMode,
            responseRequiredPrefix: "任务完成",
            responseTimeoutMs: softTimeoutMs,
            timeoutMs: chatTimeoutMs,
          });
          const finalText = getResponseText(response);
          debugLog("gateway.send_chat.done", {
            taskId: task.task_id,
            sessionId,
            responseLength: finalText.length,
            responsePreview: previewText(finalText),
          });
          const parsed = parseFinalReport(finalText);
          if (isPlaceholderTaskId(parsed.taskId)) {
            await dispatcherClient.reportProgress(task.task_id, "Template placeholder detected in final report, waiting for real response", workerId);
            throw new Error("Response appears to be a template echo; waiting for real response");
          }
          if (!isEquivalentReportedTaskId(task.task_id, parsed.taskId)) {
            const mismatchError = new Error(
              `Task ID mismatch: expected "${task.task_id}" but got "${parsed.taskId}". The response may be from a previous task.`
            );
            const recovered = await tryRecoverFromCurrentSession(task, sessionId);
            if (recovered) {
              return recovered;
            }
            throw mismatchError;
          }
          const finalStatus = await submitParsedResult(task, parsed, sessionId);
          return {
            status: finalStatus,
            taskId: task.task_id,
            responseText: finalText,
          };
        } catch (chatError) {
          debugLog("gateway.send_chat.error", {
            taskId: task.task_id,
            sessionId,
            message: chatError instanceof Error ? chatError.message : String(chatError),
          });
          if (!shouldAttemptSessionRecovery(chatError)) {
            throw chatError;
          }

          if (!sessionId) {
            await dispatcherClient.reportProgress(
              task.task_id,
              "Chat timeout but session id is missing; cannot poll session status",
              workerId,
            );
            throw createMissingSessionIdRecoveryError(chatError);
          }

          const elapsed = Date.now() - startedAt;
          if (elapsed >= hardTimeoutMs) {
            throw chatError;
          }

          await dispatcherClient.reportProgress(task.task_id, "Chat timeout, checking session status", workerId);

          let sessionStatus = await pollSessionStatus(
            sessionId,
            Math.min(SESSION_EXTENSION_INTERVAL_MS, Math.max(hardTimeoutMs - elapsed, 0)),
            DEFAULT_SESSION_POLL_INTERVAL_MS,
          );

          while (true) {
            if (sessionStatus.status === "completed") {
              const sessionResponseText = (sessionStatus as { responseText?: string | null }).responseText;
              if (sessionResponseText && typeof sessionResponseText === "string" && sessionResponseText.trim()) {
                await dispatcherClient.reportProgress(
                  task.task_id,
                  "Session completed, extracting stored response",
                  workerId
                );
                const finalText = sessionResponseText.trim();
                debugLog("session.recovery.completed_with_response", {
                  taskId: task.task_id,
                  sessionId,
                  responseLength: finalText.length,
                  responsePreview: previewText(finalText),
                });
                const parsed = parseFinalReport(finalText);
                if (isPlaceholderTaskId(parsed.taskId)) {
                  throw new Error("Session completed but response is still a template placeholder");
                }
                if (!isEquivalentReportedTaskId(task.task_id, parsed.taskId)) {
                  throw new Error(
                    `Task ID mismatch: expected "${task.task_id}" but got "${parsed.taskId}". The response may be from a previous task.`
                  );
                }
                const finalStatus = await submitParsedResult(task, parsed, sessionId);
                return {
                  status: finalStatus,
                  taskId: task.task_id,
                  responseText: finalText,
                };
              }
              throw new Error("Session completed but no response text available");
            }

            if (sessionStatus.status === "failed" || sessionStatus.status === "interrupted") {
              throw new Error((sessionStatus as { error?: string }).error || `Session ${sessionStatus.status}`);
            }

            if ((sessionStatus as { activityStopped?: boolean }).activityStopped) {
              const idleDuration = (sessionStatus as { idleDuration?: number }).idleDuration || 0;
              debugLog("session.recovery.activity_stopped", {
                taskId: task.task_id,
                sessionId,
                idleDuration,
              });
              await dispatcherClient.reportProgress(
                task.task_id,
                `Session activity stopped (idle for ${Math.round(idleDuration / 1000)}s), checking artifacts`,
                workerId
              );
              break;
            }

            const remainingMs = hardTimeoutMs - (Date.now() - startedAt);
            if (remainingMs <= 0) {
              break;
            }

            if (remainingMs > SESSION_EXTENSION_INTERVAL_MS) {
              debugLog("session.recovery.extend", {
                taskId: task.task_id,
                sessionId,
                remainingMs,
              });
              await dispatcherClient.reportProgress(
                task.task_id,
                "Session still active, extending soft timeout by 5 minutes",
                workerId
              );
            }

            sessionStatus = await pollSessionStatus(
              sessionId,
              Math.min(SESSION_EXTENSION_INTERVAL_MS, remainingMs),
              DEFAULT_SESSION_POLL_INTERVAL_MS,
            );
          }

          const artifactCheck = checkArtifactReviewability(task);
          if (artifactCheck.reviewable && artifactCheck.evidence.remoteVerified) {
            await submitParsedResult(task, {
              result: "成功",
              taskId: task.task_id,
              conclusionType: null,
              notes: `Recovered via artifact check: ${artifactCheck.reason}`,
              testOutput: "",
              risks: ["Session timeout, recovered from git artifacts"],
              environmentEvidence: "",
              filesChanged: artifactCheck.evidence.filesChanged,
              github: {
                branchName: artifactCheck.evidence.branchName,
                commitSha: artifactCheck.evidence.commitSha,
                pushStatus: "verified",
                pushError: null,
                prNumber: null,
                prUrl: null,
              },
            }, sessionId);
            return {
              status: "review_ready",
              taskId: task.task_id,
              responseText: `Recovered via artifact check: ${artifactCheck.reason}`,
            };
          }

          if (artifactCheck.reviewable && !artifactCheck.evidence.remoteVerified) {
            throw new Error(`Artifact not reviewable: ${artifactCheck.evidence.remoteCheckReason || "remote verification failed"}`);
          }

          if ((sessionStatus as { activityStopped?: boolean }).activityStopped) {
            const idleDuration = (sessionStatus as { idleDuration?: number }).idleDuration || 0;
            throw new Error(`Session activity stopped (idle for ${Math.round(idleDuration / 1000)}s) and no reviewable artifacts found`);
          }

          throw new Error("Hard timeout exceeded");
        }
      } catch (error) {
        debugLog("worker.task.error", {
          taskId: task.task_id,
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        const artifactCheck = checkArtifactReviewability(task);
        if (artifactCheck.reviewable && artifactCheck.evidence.remoteVerified) {
          await submitParsedResult(task, {
            result: "成功",
            taskId: task.task_id,
            conclusionType: null,
            notes: `Recovered via artifact check after error: ${artifactCheck.reason}`,
            testOutput: "",
            risks: [`Error: ${error instanceof Error ? error.message : String(error)}`],
            environmentEvidence: "",
            filesChanged: artifactCheck.evidence.filesChanged,
            github: {
              branchName: artifactCheck.evidence.branchName,
              commitSha: artifactCheck.evidence.commitSha,
              pushStatus: "verified",
              pushError: null,
              prNumber: null,
              prUrl: null,
            },
          }, sessionId);
          return {
            status: "review_ready",
            taskId: task.task_id,
            responseText: `Recovered via artifact check: ${artifactCheck.reason}`,
          };
        }
        await submitFailure(task, error instanceof Error ? error : new Error(String(error)), "", sessionId);
        return {
          status: "failed",
          taskId: task.task_id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async runLoop(signal?: AbortSignal) {
      let consecutiveErrors = 0;
      while (!signal?.aborted) {
        try {
          const result = await runtime.runOnce();
          consecutiveErrors = 0;
          if (result.status === "no_task") {
            await sleep(pollIntervalMs);
          }
        } catch (error) {
          consecutiveErrors += 1;
          const backoffMs = Math.min(maxErrorBackoffMs, errorBackoffMs * consecutiveErrors);
          logger?.warn?.(
            `[trae-automation-worker] runLoop recovered from error: ${error instanceof Error ? error.message : String(error)}`
          );
          if (!signal?.aborted) {
            await sleep(backoffMs);
          }
        }
      }
    },

    stop() {
      heartbeat.stop();
    },
  };

  return runtime;
}

export function parseArgs(argv: string[]) {
  const args = {
    dispatcherUrl: "http://127.0.0.1:8787",
    automationUrl: "http://127.0.0.1:8790",
    workerId: "trae-auto-gateway",
    repoDir: "",
    traeBin: "",
    remoteDebuggingPort: 9222,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    once: false,
    debug: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dispatcher-url" && next) {
      args.dispatcherUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--automation-url" && next) {
      args.automationUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--worker-id" && next) {
      args.workerId = next;
      index += 1;
      continue;
    }
    if (arg === "--repo-dir" && next) {
      args.repoDir = next;
      index += 1;
      continue;
    }
    if (arg === "--trae-bin" && next) {
      args.traeBin = next;
      index += 1;
      continue;
    }
    if (arg === "--remote-debugging-port" && next) {
      args.remoteDebuggingPort = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-ms" && next) {
      args.pollIntervalMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--once") {
      args.once = true;
      continue;
    }
    if (arg === "--debug") {
      args.debug = true;
      continue;
    }
    if (arg === "--help") {
      (args as { help?: boolean }).help = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node dist/runtime/worker.js \\
    --repo-dir /abs/path/to/repo \\
    [--dispatcher-url http://127.0.0.1:8787] \\
    [--automation-url http://127.0.0.1:8790] \\
    [--worker-id trae-auto-gateway] \\
    [--trae-bin /Applications/Trae\\ CN.app] \\
    [--remote-debugging-port 9222] \\
    [--poll-interval-ms 5000] \\
    [--debug] \\
    [--once]
`);
}

export async function runWorkerRuntimeFromArgv(argv: string[], partialDeps: Partial<WorkerRuntimeOptions> = {}) {
  const args = parseArgs(argv);
  if ((args as { help?: boolean }).help) {
    printHelp();
    return;
  }
  if (!args.repoDir) {
    throw new Error("--repo-dir is required");
  }

  const dispatcherClient = partialDeps.dispatcherClient || createDispatcherClient(args.dispatcherUrl);
  const automationClient = partialDeps.automationClient || createAutomationGatewayClient(args.automationUrl);
  const runtime = createTraeAutomationWorkerRuntime({
    dispatcherClient,
    automationClient,
    workerId: args.workerId,
    repoDir: args.repoDir,
    traeBin: args.traeBin || undefined,
    remoteDebuggingPort: args.remoteDebuggingPort,
    pollIntervalMs: args.pollIntervalMs,
    debug: args.debug,
    logger: partialDeps.logger || console,
    launchTrae: partialDeps.launchTrae,
  });

  const readiness = await runtime.register();
  await waitForAutomationGatewayReady({
    automationClient,
    repoDir: args.repoDir,
    initialReadiness: readiness,
    retryIntervalMs: Math.min(Math.max(args.pollIntervalMs, 250), 5000),
    logger: partialDeps.logger || console,
  });

  if (args.once) {
    const result = await runtime.runOnce();
    console.log(JSON.stringify(result, null, 2));
    runtime.stop();
    return;
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  await runtime.runLoop(controller.signal);
  runtime.stop();
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runWorkerRuntimeFromArgv(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

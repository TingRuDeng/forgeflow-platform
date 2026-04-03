export interface DecomposerProjectConfig {
  project?: {
    key?: string;
    repo?: string;
    default_branch?: string;
  };
  routing: Record<string, readonly string[] | undefined>;
  worktree?: {
    root_dir?: string;
    branch_template?: string;
    sync_from_default_branch?: boolean;
  };
}

export interface DecomposerInput {
  summary: string;
  taskType: string;
  projectConfig: DecomposerProjectConfig;
}

export interface StructuredTaskDraft {
  id?: string;
  title: string;
  pool: "codex" | "gemini";
  allowedPaths: string[];
  branchName?: string;
  verification: {
    mode: "run" | "review";
  };
}

export interface ParsedProjectContract {
  project: {
    key: string;
    repo: string;
    default_branch: string;
  };
  routing: {
    codex: string[];
    gemini: string[];
  };
  commands: Record<string, string>;
  worktree: {
    root_dir: string;
    branch_template: string;
    sync_from_default_branch: boolean;
  };
  providers: {
    enabled: Array<"codex" | "gemini">;
    capacity: Partial<Record<"codex" | "gemini", number>>;
  };
}

export interface BuildDispatchPlanInput {
  requestSummary: string;
  taskType: string;
  projectContractYaml: string;
  plannerOutputJson?: string;
}

export interface DispatchPlan {
  requestSummary: string;
  taskType: string;
  suggestedPools: Array<"codex" | "gemini">;
  tasks: Array<StructuredTaskDraft & { id: string; branchName: string }>;
}

export interface PlannerOutputTask {
  title: string;
  pool: "codex" | "gemini";
  allowedPaths: string[];
  verification: {
    mode: "run" | "review";
  };
}

export interface PlannerOutput {
  tasks: PlannerOutputTask[];
}

export type TaskLedgerStatus =
  | "planned"
  | "ready"
  | "assigned"
  | "in_progress"
  | "review"
  | "merged"
  | "blocked"
  | "failed";

export interface TaskLedgerTask extends StructuredTaskDraft {
  id: string;
  branchName: string;
  status: TaskLedgerStatus;
  attempts: number;
  assignedWorkerId?: string;
}

export interface TaskLedger {
  requestSummary: string;
  taskType: string;
  repo: string;
  defaultBranch: string;
  generatedAt: string;
  tasks: TaskLedgerTask[];
}

export interface BuildTaskLedgerInput {
  plan: DispatchPlan;
  projectContractYaml: string;
  generatedAt?: string;
}

export interface RenderDispatchSummaryMarkdownInput {
  plan: DispatchPlan;
  ledger: TaskLedger;
}

export interface DispatchRecord {
  ledger: TaskLedger;
  events: Array<{
    taskId: string;
    type: "created" | "status_changed";
    at: string;
    payload: Record<string, string>;
  }>;
}

export interface WorkerRegistryEntry {
  id: string;
  pool: "codex" | "gemini";
  status: "idle" | "busy";
  lastHeartbeatAt: string;
  currentTaskId?: string;
}

export interface BuildWorkerRegistryInput {
  projectContractYaml: string;
  generatedAt?: string;
}

export interface DispatchAssignment {
  taskId: string;
  workerId: string;
  pool: "codex" | "gemini";
  status: "assigned" | "pending";
}

export interface AssignmentRecord {
  ledger: TaskLedger;
  workers: WorkerRegistryEntry[];
  assignments: DispatchAssignment[];
  events: DispatchRecord["events"];
}

export interface AssignmentPackage {
  taskId: string;
  assignment: DispatchAssignment & {
    branchName: string;
    allowedPaths: string[];
    commands: Record<string, string>;
    repo: string;
    defaultBranch: string;
  };
  workerPrompt: string;
  contextMarkdown: string;
}

export interface BuildAssignmentPackagesInput {
  record: AssignmentRecord;
  projectContractYaml: string;
  agentsInstructions: string;
  geminiInstructions?: string;
}

const FRONTEND_KEYWORDS = [
  "frontend",
  "vue",
  "ui",
  "page",
  "component",
  "screen",
  "readme",
  "docs",
  "documentation",
  "前端",
  "页面",
  "组件",
  "文档",
  "说明",
  "接入",
];
const BACKEND_KEYWORDS = [
  "backend",
  "api",
  "auth",
  "token",
  "database",
  "service",
  "后端",
  "接口",
  "鉴权",
  "认证",
  "数据库",
  "服务",
  "测试",
];
const DEFAULT_BRANCH_TEMPLATE = "ai/{pool}/{task_id}-{slug}";

function hasKeyword(summary: string, keywords: string[]): boolean {
  const normalized = summary.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function parseScalar(value: string): string | boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}

function ensureString(value: string | boolean | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function ensureBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBranchName(
  template: string,
  pool: "codex" | "gemini",
  taskId: string,
  title: string,
): string {
  return template
    .replace("{pool}", pool)
    .replace("{task_id}", taskId)
    .replace("{slug}", slugify(title));
}

function buildTask(
  title: string,
  pool: "codex" | "gemini",
  allowedPaths: readonly string[],
): StructuredTaskDraft {
  return {
    title,
    pool,
    allowedPaths: [...allowedPaths],
    verification: {
      mode: "run",
    },
  };
}

function isPlannerPool(value: unknown): value is "codex" | "gemini" {
  return value === "codex" || value === "gemini";
}

function isVerificationMode(value: unknown): value is "run" | "review" {
  return value === "run" || value === "review";
}

export function parsePlannerOutputJson(jsonText: string): PlannerOutput {
  const parsed = JSON.parse(jsonText) as {
    tasks?: Array<{
      title?: unknown;
      pool?: unknown;
      allowedPaths?: unknown;
      verification?: { mode?: unknown } | undefined;
    }>;
  };

  if (!Array.isArray(parsed.tasks)) {
    throw new Error("planner output must contain a tasks array");
  }

  const tasks = parsed.tasks.map((task, index) => {
    if (typeof task.title !== "string" || task.title.length === 0) {
      throw new Error(`planner task ${index + 1} is missing title`);
    }
    if (!isPlannerPool(task.pool)) {
      throw new Error(`planner task ${index + 1} has invalid pool`);
    }
    if (!Array.isArray(task.allowedPaths) || task.allowedPaths.some((path) => typeof path !== "string")) {
      throw new Error(`planner task ${index + 1} has invalid allowedPaths`);
    }

    const mode = task.verification?.mode;
    if (!isVerificationMode(mode)) {
      throw new Error(`planner task ${index + 1} has invalid verification mode`);
    }

    return {
      title: task.title,
      pool: task.pool,
      allowedPaths: [...task.allowedPaths],
      verification: {
        mode,
      },
    };
  });

  return { tasks };
}

export function extractPlannerOutputJson(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const genericFenceMatch = trimmed.match(/```\s*([\s\S]*?)\s*```/);
  if (genericFenceMatch?.[1]) {
    const candidate = genericFenceMatch[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  throw new Error("unable to extract planner JSON from model output");
}

export function buildPlannerPromptMarkdown(input: BuildDispatchPlanInput): string {
  const parsed = parseProjectContractYaml(input.projectContractYaml);
  const enabledPools = parsed.providers.enabled.join(", ") || "(none)";
  const commandLines = Object.entries(parsed.commands).map(
    ([name, command]) => `- ${name}: \`${command}\``,
  );

  return [
    "# Planner Request",
    "",
    "请作为总调度 AI，把下面的需求拆成结构化任务 JSON。",
    "",
    "## Request",
    `- Summary: ${input.requestSummary}`,
    `- Task Type: ${input.taskType}`,
    `- Repo: ${parsed.project.repo}`,
    `- Default Branch: ${parsed.project.default_branch}`,
    "",
    "## Available Pools",
    `- ${enabledPools}`,
    "",
    "## Routing Boundaries",
    `- codex: ${parsed.routing.codex.join(", ") || "(none)"}`,
    `- gemini: ${parsed.routing.gemini.join(", ") || "(none)"}`,
    "",
    "## Verification Commands",
    ...(commandLines.length > 0 ? commandLines : ["- (none)"]),
    "",
    "## Output Contract",
    "只返回 JSON，不要加解释。格式如下：",
    "```json",
    JSON.stringify(
      {
        tasks: [
          {
            title: "前端页面与交互实现",
            pool: "gemini",
            allowedPaths: ["docs/**", "README.md"],
            verification: {
              mode: "run",
            },
          },
          {
            title: "后端接口与测试实现",
            pool: "codex",
            allowedPaths: ["src/**", "plugins/**"],
            verification: {
              mode: "run",
            },
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "要求：",
    "- 只使用已启用的 pool。",
    "- allowedPaths 必须落在仓库契约允许的边界内。",
    "- 如果一个需求只需要一个任务，就只输出一个任务。",
    "- 优先按真实语义拆分，不要只按关键词机械路由。",
    "",
  ].join("\n");
}

export function decomposeTask(input: DecomposerInput): StructuredTaskDraft[] {
  const { summary, projectConfig } = input;
  const wantsFrontend = hasKeyword(summary, FRONTEND_KEYWORDS);
  const wantsBackend = hasKeyword(summary, BACKEND_KEYWORDS);
  const tasks: StructuredTaskDraft[] = [];

  if (wantsFrontend) {
    tasks.push(
      buildTask(`Frontend: ${summary}`, "gemini", projectConfig.routing.gemini ?? []),
    );
  }

  if (wantsBackend || !wantsFrontend) {
    tasks.push(
      buildTask(`Backend: ${summary}`, "codex", projectConfig.routing.codex ?? []),
    );
  }

  return tasks;
}

export function parseProjectContractYaml(yamlText: string): ParsedProjectContract {
  const parsed: ParsedProjectContract = {
    project: {
      key: "",
      repo: "",
      default_branch: "main",
    },
    routing: {
      codex: [],
      gemini: [],
    },
    commands: {},
    worktree: {
      root_dir: ".worktrees",
      branch_template: DEFAULT_BRANCH_TEMPLATE,
      sync_from_default_branch: true,
    },
    providers: {
      enabled: ["codex", "gemini"],
      capacity: {},
    },
  };

  let section = "";
  let subsection = "";

  for (const rawLine of yamlText.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (!line.startsWith(" ")) {
      section = trimmed.replace(/:$/, "");
      subsection = "";
      continue;
    }

    if (line.startsWith("    - ")) {
      const item = trimmed.slice(2).trim();
      if (section === "routing" && (subsection === "codex" || subsection === "gemini")) {
        parsed.routing[subsection].push(item);
      }
      if (section === "providers" && subsection === "enabled" && (item === "codex" || item === "gemini")) {
        parsed.providers.enabled.push(item);
      }
      continue;
    }

    if (line.startsWith("  ") && !line.startsWith("    ")) {
      if (trimmed.endsWith(":")) {
        subsection = trimmed.slice(0, -1);
        continue;
      }

      const [rawKey, ...rest] = trimmed.split(":");
      const key = rawKey.trim();
      const value = parseScalar(rest.join(":").trim());

      if (section === "project") {
        if (key === "key") {
          parsed.project.key = ensureString(value, parsed.project.key);
        }
        if (key === "repo") {
          parsed.project.repo = ensureString(value, parsed.project.repo);
        }
        if (key === "default_branch") {
          parsed.project.default_branch = ensureString(value, parsed.project.default_branch);
        }
      }

      if (section === "commands" && typeof value === "string" && value.length > 0) {
        parsed.commands[key] = value;
      }

      continue;
    }

    if (line.startsWith("    ")) {
      const [rawKey, ...rest] = trimmed.split(":");
      const key = rawKey.trim();
      const value = parseScalar(rest.join(":").trim());

      if (section === "worktree") {
        if (key === "root_dir") {
          parsed.worktree.root_dir = ensureString(value, parsed.worktree.root_dir);
        }
        if (key === "branch_template") {
          parsed.worktree.branch_template = ensureString(
            value,
            parsed.worktree.branch_template,
          );
        }
        if (key === "sync_from_default_branch") {
          parsed.worktree.sync_from_default_branch = ensureBoolean(
            value,
            parsed.worktree.sync_from_default_branch,
          );
        }
      }

      if (section === "providers" && subsection === "capacity") {
        if ((key === "codex" || key === "gemini") && typeof value === "string") {
          const parsedValue = Number(value);
          if (Number.isFinite(parsedValue) && parsedValue > 0) {
            parsed.providers.capacity[key] = parsedValue;
          }
        }
      }
    }
  }

  return parsed;
}

export function buildDispatchPlan(input: BuildDispatchPlanInput): DispatchPlan {
  const parsed = parseProjectContractYaml(input.projectContractYaml);
  const drafts = input.plannerOutputJson
    ? parsePlannerOutputJson(input.plannerOutputJson).tasks
    : decomposeTask({
        summary: input.requestSummary,
        taskType: input.taskType,
        projectConfig: parsed,
      });

  const tasks = drafts.map((draft, index) => {
    const taskId = `task-${index + 1}`;
    const title = draft.title.toLowerCase();
    const branchName = buildBranchName(
      parsed.worktree.branch_template,
      draft.pool,
      taskId,
      title,
    );

    return {
      ...draft,
      id: taskId,
      branchName,
    };
  });

  return {
    requestSummary: input.requestSummary,
    taskType: input.taskType,
    suggestedPools: [...new Set(tasks.map((task) => task.pool))],
    tasks,
  };
}

export function buildTaskLedger(input: BuildTaskLedgerInput): TaskLedger {
  const parsed = parseProjectContractYaml(input.projectContractYaml);

  return {
    requestSummary: input.plan.requestSummary,
    taskType: input.plan.taskType,
    repo: parsed.project.repo,
    defaultBranch: parsed.project.default_branch,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    tasks: input.plan.tasks.map((task) => ({
      ...task,
      status: "planned",
      attempts: 0,
    })),
  };
}

export function renderDispatchSummaryMarkdown(
  input: RenderDispatchSummaryMarkdownInput,
): string {
  const poolLines = input.plan.suggestedPools.map((pool) => `- ${pool}`).join("\n");
  const taskSections = input.ledger.tasks
    .map(
      (task) =>
        [
          `### ${task.id} - ${task.title}`,
          `- Pool: ${task.pool}`,
          `- Status: ${task.status}`,
          task.assignedWorkerId ? `- Assigned Worker: ${task.assignedWorkerId}` : undefined,
          `- Branch: \`${task.branchName}\``,
          `- Allowed Paths: ${task.allowedPaths.join(", ") || "(none)"}`,
          `- Verification: ${task.verification.mode}`,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
    )
    .join("\n\n");

  return [
    "# Dispatch Summary",
    "",
    "## Request",
    `- Summary: ${input.plan.requestSummary}`,
    `- Task Type: ${input.plan.taskType}`,
    `- Repo: ${input.ledger.repo}`,
    `- Default Branch: ${input.ledger.defaultBranch}`,
    `- Generated At: ${input.ledger.generatedAt}`,
    "",
    "## Suggested Pools",
    poolLines || "- (none)",
    "",
    "## Tasks",
    taskSections || "_No tasks generated._",
    "",
  ].join("\n");
}

export function buildDispatchRecord(input: BuildTaskLedgerInput): DispatchRecord {
  const ledger = buildTaskLedger(input);
  const events: DispatchRecord["events"] = [];

  const readyTasks = ledger.tasks.map((task) => {
    events.push({
      taskId: task.id,
      type: "created",
      at: ledger.generatedAt,
      payload: {
        status: task.status,
      },
    });
    events.push({
      taskId: task.id,
      type: "status_changed",
      at: ledger.generatedAt,
      payload: {
        from: task.status,
        to: "ready",
      },
    });

    return {
      ...task,
      status: "ready" as const,
    };
  });

  return {
    ledger: {
      ...ledger,
      tasks: readyTasks,
    },
    events,
  };
}

export function buildWorkerRegistry(input: BuildWorkerRegistryInput): WorkerRegistryEntry[] {
  const parsed = parseProjectContractYaml(input.projectContractYaml);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const uniquePools = [...new Set(parsed.providers.enabled)];

  return uniquePools.flatMap((pool) => {
    const capacity = parsed.providers.capacity[pool] ?? 1;
    return Array.from({ length: capacity }, (_, index) => ({
      id: `${pool}-worker-${index + 1}`,
      pool,
      status: "idle" as const,
      lastHeartbeatAt: generatedAt,
    }));
  });
}

export function buildAssignmentRecord(input: BuildTaskLedgerInput): AssignmentRecord {
  const readyRecord = buildDispatchRecord(input);
  const workers = buildWorkerRegistry({
    projectContractYaml: input.projectContractYaml,
    generatedAt: readyRecord.ledger.generatedAt,
  });
  const events = [...readyRecord.events];
  const assignments: DispatchAssignment[] = [];

  const ledgerTasks = readyRecord.ledger.tasks.map((task) => {
    const worker = workers.find((candidate) => candidate.pool === task.pool && candidate.status === "idle");
    if (!worker) {
      assignments.push({
        taskId: task.id,
        workerId: "",
        pool: task.pool,
        status: "pending",
      });
      return task;
    }

    worker.status = "busy";
    worker.currentTaskId = task.id;
    assignments.push({
      taskId: task.id,
      workerId: worker.id,
      pool: task.pool,
      status: "assigned",
    });
    events.push({
      taskId: task.id,
      type: "status_changed",
      at: readyRecord.ledger.generatedAt,
      payload: {
        from: task.status,
        to: "assigned",
      },
    });

    return {
      ...task,
      status: "assigned" as const,
      assignedWorkerId: worker.id,
    };
  });

  return {
    ledger: {
      ...readyRecord.ledger,
      tasks: ledgerTasks,
    },
    workers,
    assignments,
    events,
  };
}

function buildWorkerPrompt(
  task: TaskLedgerTask,
  agentsInstructions: string,
  geminiInstructions: string | undefined,
): string {
  const basePrompt = [
    `你是 ${task.pool}-worker。`,
    `你的任务：${task.title}`,
    `只允许修改这些路径：${task.allowedPaths.join(", ") || "(none)"}`,
    "完成前必须运行任务要求里的验证命令。",
    "如果超出范围或信息不足，直接返回阻塞点，不要自行扩展任务。",
    "",
    agentsInstructions.trim(),
  ];

  if (task.pool === "gemini" && geminiInstructions) {
    basePrompt.push("", geminiInstructions.trim());
  }

  return `${basePrompt.join("\n")}\n`;
}

function buildContextMarkdown(
  task: TaskLedgerTask,
  assignment: DispatchAssignment,
  project: ParsedProjectContract,
): string {
  return [
    "# Assignment Context",
    "",
    "## Task",
    `- Task ID: ${task.id}`,
    `- Title: ${task.title}`,
    `- Pool: ${task.pool}`,
    `- Worker: ${assignment.workerId || "(unassigned)"}`,
    `- Repo: ${project.project.repo}`,
    `- Default Branch: ${project.project.default_branch}`,
    "",
    "## Paths",
    ...task.allowedPaths.map((path) => `- ${path}`),
    "",
    "## Commands",
    ...Object.entries(project.commands).map(([name, command]) => `- ${name}: \`${command}\``),
    "",
  ].join("\n");
}

export function buildAssignmentPackages(
  input: BuildAssignmentPackagesInput,
): AssignmentPackage[] {
  const project = parseProjectContractYaml(input.projectContractYaml);

  return input.record.assignments
    .filter((assignment) => assignment.status === "assigned")
    .map((assignment) => {
      const task = input.record.ledger.tasks.find((candidate) => candidate.id === assignment.taskId);
      if (!task) {
        throw new Error(`task not found for assignment: ${assignment.taskId}`);
      }

      return {
        taskId: task.id,
        assignment: {
          ...assignment,
          branchName: task.branchName,
          allowedPaths: task.allowedPaths,
          commands: project.commands,
          repo: project.project.repo,
          defaultBranch: project.project.default_branch,
        },
        workerPrompt: buildWorkerPrompt(
          task,
          input.agentsInstructions,
          input.geminiInstructions,
        ),
        contextMarkdown: buildContextMarkdown(task, assignment, project),
      };
    });
}

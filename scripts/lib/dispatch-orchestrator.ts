import fs from "node:fs";
import path from "node:path";

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

interface Task {
  id: string;
  title: string;
  pool: string;
  allowedPaths?: string[];
  acceptance?: string[];
  dependsOn?: string[];
  branchName: string;
  verification?: { mode: string };
}

interface Ledger {
  repo: string;
  defaultBranch: string;
  generatedAt: string;
  tasks: Task[];
}

interface Assignment {
  taskId: string;
}

interface AssignmentPackage {
  taskId: string;
  assignment: Assignment;
  workerPrompt: string;
  contextMarkdown: string;
}

interface BuildPayloadInput {
  orchestratorDir: string;
  requestedBy?: string;
}

interface BuildPayloadOutput {
  repo: string;
  defaultBranch: string;
  requestedBy: string;
  createdAt: string;
  tasks: Array<{
    id: string;
    title: string;
    pool: string;
    allowedPaths: string[];
    acceptance: string[];
    dependsOn: string[];
    branchName: string;
    verification: { mode: string };
  }>;
  packages: AssignmentPackage[];
}

export function buildDispatchServerPayload(input: BuildPayloadInput): BuildPayloadOutput {
  const orchestratorDir = path.resolve(input.orchestratorDir);
  const ledger = readJson(path.join(orchestratorDir, "task-ledger.json")) as Ledger;
  const assignmentsRoot = path.join(orchestratorDir, "assignments");
  const taskDirectories = fs.existsSync(assignmentsRoot)
    ? fs.readdirSync(assignmentsRoot).sort()
    : [];

  const packages = taskDirectories.map((taskId): AssignmentPackage => {
    const assignmentDir = path.join(assignmentsRoot, taskId);
    return {
      taskId,
      assignment: readJson(path.join(assignmentDir, "assignment.json")) as Assignment,
      workerPrompt: fs.readFileSync(path.join(assignmentDir, "worker-prompt.md"), "utf8"),
      contextMarkdown: fs.readFileSync(path.join(assignmentDir, "context.md"), "utf8"),
    };
  });

  return {
    repo: ledger.repo,
    defaultBranch: ledger.defaultBranch,
    requestedBy: input.requestedBy ?? "codex-control",
    createdAt: ledger.generatedAt,
    tasks: ledger.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      pool: task.pool,
      allowedPaths: task.allowedPaths ?? [],
      acceptance: task.acceptance ?? [],
      dependsOn: task.dependsOn ?? [],
      branchName: task.branchName,
      verification: task.verification ?? { mode: "run" },
    })),
    packages,
  };
}

interface PostPayloadInput {
  dispatcherUrl: string;
  payload: BuildPayloadOutput;
}

export async function postDispatchServerPayload(input: PostPayloadInput): Promise<unknown> {
  const response = await fetch(`${input.dispatcherUrl.replace(/\/$/, "")}/api/dispatches`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input.payload),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((json as { error?: string }).error || text || `dispatch publish failed: ${response.status}`);
  }
  return json;
}

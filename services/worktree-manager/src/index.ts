export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (args: string[]) => Promise<CommandResult>;

export interface CreateTaskWorktreeInput {
  rootDir: string;
  branchTemplate: string;
  pool: "codex" | "gemini";
  taskId: string;
  slug: string;
}

function applyBranchTemplate(
  template: string,
  input: CreateTaskWorktreeInput,
): string {
  return template
    .replace("{pool}", input.pool)
    .replace("{task_id}", input.taskId)
    .replace("{slug}", input.slug);
}

async function ensureSuccess(
  runner: CommandRunner,
  args: string[],
): Promise<CommandResult> {
  const result = await runner(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `command failed: ${args.join(" ")}`);
  }
  return result;
}

export class WorktreeManager {
  constructor(private readonly runner: CommandRunner) {}

  async createTaskWorktree(input: CreateTaskWorktreeInput) {
    const branchName = applyBranchTemplate(input.branchTemplate, input);
    const worktreePath = `${input.rootDir}/${input.taskId}-${input.slug}`;

    await ensureSuccess(this.runner, [
      "git",
      "worktree",
      "add",
      worktreePath,
      "-b",
      branchName,
    ]);

    return {
      branchName,
      worktreePath,
    };
  }

  async removeTaskWorktree(path: string): Promise<void> {
    await ensureSuccess(this.runner, [
      "git",
      "worktree",
      "remove",
      path,
      "--force",
    ]);
  }

  async syncTaskWorktree(path: string, defaultBranch: string): Promise<void> {
    await ensureSuccess(this.runner, ["git", "-C", path, "fetch", "origin", defaultBranch]);
    await ensureSuccess(this.runner, ["git", "-C", path, "rebase", `origin/${defaultBranch}`]);
  }
}

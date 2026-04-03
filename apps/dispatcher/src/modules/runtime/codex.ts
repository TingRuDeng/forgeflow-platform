import type {
  NormalizedRuntimeResult,
  RuntimeCollectedResult,
  RuntimeLaunchCommand,
  RuntimeLaunchInput,
  RuntimeMode,
  RuntimeVerificationInput,
  WorkerRuntime,
} from "./types.js";

export type CodexRuntimeRole = "control" | "worker";

const CODEX_MODELS: Record<CodexRuntimeRole, string | null> = {
  control: "GPT-5.4",
  worker: null,
};

function buildLaunchArgs(model: string | null, input: RuntimeLaunchInput): string[] {
  const args = ["codex", "exec"];
  if (model) {
    args.push("-m", model);
  }
  args.push("--sandbox", "workspace-write");
  if (input.mode === "review") {
    args.push("--mode", "review");
  }
  args.push(input.prompt);
  return args;
}

function buildVerificationCommands(input: RuntimeVerificationInput): RuntimeLaunchCommand[] {
  return input.commands.map((command) => ({
    argv: ["zsh", "-lc", command],
    cwd: input.cwd,
  }));
}

function normalizeResult(input: RuntimeCollectedResult): NormalizedRuntimeResult {
  return {
    provider: "codex",
    taskId: input.taskId,
    mode: input.mode,
    output: input.output,
  };
}

export function createCodexRuntime(role: CodexRuntimeRole): WorkerRuntime {
  const model = CODEX_MODELS[role];

  return {
    provider: "codex",
    model: model ?? "default",
    launchTask(input: RuntimeLaunchInput): RuntimeLaunchCommand {
      return {
        argv: buildLaunchArgs(model, input),
        cwd: input.worktreeDir,
      };
    },
    collectResult(input: RuntimeCollectedResult): NormalizedRuntimeResult {
      return normalizeResult(input);
    },
    cancelTask(): RuntimeLaunchCommand | null {
      return null;
    },
    runVerification(input: RuntimeVerificationInput): RuntimeLaunchCommand[] {
      return buildVerificationCommands(input);
    },
    supportsMode(mode: RuntimeMode): boolean {
      return mode === "run" || mode === "review";
    },
  };
}

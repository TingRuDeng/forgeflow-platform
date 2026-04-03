import type {
  NormalizedRuntimeResult,
  RuntimeCollectedResult,
  RuntimeLaunchCommand,
  RuntimeLaunchInput,
  RuntimeMode,
  RuntimeVerificationInput,
  WorkerRuntime,
} from "./types.js";

const GEMINI_MODEL = "gemini-2.5-pro";

function buildVerificationCommands(input: RuntimeVerificationInput): RuntimeLaunchCommand[] {
  return input.commands.map((command) => ({
    argv: ["zsh", "-lc", command],
    cwd: input.cwd,
  }));
}

export function createGeminiRuntime(): WorkerRuntime {
  return {
    provider: "gemini",
    model: GEMINI_MODEL,
    launchTask(input: RuntimeLaunchInput): RuntimeLaunchCommand {
      return {
        argv: ["gemini", "-m", GEMINI_MODEL, "-p", input.prompt],
        cwd: input.worktreeDir,
      };
    },
    collectResult(input: RuntimeCollectedResult): NormalizedRuntimeResult {
      return {
        provider: "gemini",
        taskId: input.taskId,
        mode: input.mode,
        output: input.output,
      };
    },
    cancelTask(): RuntimeLaunchCommand | null {
      return null;
    },
    runVerification(input: RuntimeVerificationInput): RuntimeLaunchCommand[] {
      return buildVerificationCommands(input);
    },
    supportsMode(mode: RuntimeMode): boolean {
      return mode === "run";
    },
  };
}

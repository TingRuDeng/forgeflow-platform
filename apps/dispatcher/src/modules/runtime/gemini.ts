import type {
  NormalizedRuntimeResult,
  RuntimeCollectedResult,
  RuntimeLaunchCommand,
  RuntimeLaunchInput,
  RuntimeMode,
  RuntimeVerificationInput,
  WorkerRuntime,
} from "./types.js";
import { sanitizeVerificationCommand } from "./types.js";

const GEMINI_MODEL = "gemini-2.5-pro";

export interface GeminiRuntimeOptions {
  // Explicit model override (e.g. from FORGEFLOW_GEMINI_MODEL). Empty/undefined
  // falls back to the default gemini model.
  model?: string;
  // Extra CLI args inserted before `-p <prompt>` (e.g. FORGEFLOW_GEMINI_ARGS).
  extraArgs?: string[];
}

function buildVerificationCommands(input: RuntimeVerificationInput): RuntimeLaunchCommand[] {
  return input.commands.map((command) => ({
    argv: ["zsh", "-lc", sanitizeVerificationCommand(command)],
    cwd: input.cwd,
  }));
}

export function createGeminiRuntime(options: GeminiRuntimeOptions = {}): WorkerRuntime {
  const overrideModel = typeof options.model === "string" ? options.model.trim() : "";
  const model = overrideModel.length > 0 ? overrideModel : GEMINI_MODEL;
  const extraArgs = (options.extraArgs ?? []).map((arg) => String(arg).trim()).filter(Boolean);
  return {
    provider: "gemini",
    model,
    launchTask(input: RuntimeLaunchInput): RuntimeLaunchCommand {
      return {
        argv: ["gemini", "-m", model, ...extraArgs, "-p", input.prompt],
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

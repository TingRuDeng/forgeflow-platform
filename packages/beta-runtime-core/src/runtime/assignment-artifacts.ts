import type { AssignmentLaunchCommand } from "./run-worker-assignment-types.js";
import type { TaskAssignment } from "./types.js";

interface VerificationResult {
  command: string;
  exitCode: number;
  output: string;
  timedOut?: boolean;
}

interface BuildAssignmentArtifactBundleInput {
  assignment: TaskAssignment;
  launch: AssignmentLaunchCommand;
  launchOutput: string;
  launchExitCode: number;
  launchTimedOut: boolean;
  verification: VerificationResult[];
  finalOutput: string;
  generatedAt: string;
}

function commandText(argv: string[]): string {
  return argv.map((item) => /\s/.test(item) ? JSON.stringify(item) : item).join(" ");
}

function verificationStatus(result: VerificationResult): "passed" | "failed" {
  return result.exitCode === 0 && !result.timedOut ? "passed" : "failed";
}

function trajectoryStatus(exitCode: number, timedOut?: boolean): "succeeded" | "failed" {
  return exitCode === 0 && !timedOut ? "succeeded" : "failed";
}

function buildVerificationSteps(verification: VerificationResult[], startSequence: number) {
  return verification.map((result, index) => ({
    sequence: startSequence + index,
    phase: "verification" as const,
    action: result.command,
    observation: result.output,
    status: trajectoryStatus(result.exitCode, result.timedOut),
    command: result.command,
    exitCode: result.exitCode,
  }));
}

export function buildAssignmentArtifactBundle(input: BuildAssignmentArtifactBundleInput) {
  const launchCommand = commandText(input.launch.argv);
  const verificationSteps = buildVerificationSteps(input.verification, 3);
  const allVerificationPassed = input.verification.every((item) => item.exitCode === 0 && !item.timedOut);
  const executionExitCode = input.launchTimedOut ? 124 : input.launchExitCode;
  const executionStatus = trajectoryStatus(executionExitCode, input.launchTimedOut);
  const resultStatus = executionStatus === "succeeded" && allVerificationPassed ? "succeeded" : "failed";

  return {
    schemaVersion: "artifact-bundle/v1" as const,
    summary: input.finalOutput,
    trajectory: {
      schemaVersion: "artifact-trajectory/v1" as const,
      steps: [
        {
          sequence: 1,
          phase: "preflight" as const,
          action: `prepared assignment package for ${input.assignment.taskId}`,
          observation: `provider=${input.launch.provider} profile=${input.launch.executionProfile ?? "trusted-host"} cwd=${input.launch.cwd}`,
          status: "succeeded" as const,
        },
        {
          sequence: 2,
          phase: "action" as const,
          action: `run ${input.launch.provider} worker`,
          observation: input.launchOutput,
          status: executionStatus,
          command: launchCommand,
          cwd: input.launch.cwd,
          exitCode: executionExitCode,
        },
        ...verificationSteps,
        {
          sequence: verificationSteps.length + 3,
          phase: "result" as const,
          action: `write worker result for ${input.assignment.taskId}`,
          observation: resultStatus === "succeeded" ? "worker result is reviewable" : "worker result failed verification",
          status: resultStatus,
        },
      ],
    },
    retainedContent: {
      logs: input.finalOutput,
      testResults: JSON.stringify({ allPassed: allVerificationPassed, commands: input.verification }, null, 2),
    },
    testResults: input.verification.map((result) => ({
      name: result.command,
      status: verificationStatus(result),
    })),
    riskNotes: [],
    nextActions: resultStatus === "succeeded" ? [] : ["检查 worker 输出和 verification 失败原因"],
    createdAt: input.generatedAt,
  };
}

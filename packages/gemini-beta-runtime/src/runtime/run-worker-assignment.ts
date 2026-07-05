#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  buildGeminiLaunchCommand as buildCoreGeminiLaunchCommand,
  runWorkerAssignmentCli,
  type AssignmentLaunchCommand,
  type AssignmentLaunchInput,
} from "@tingrudeng/beta-runtime-core";

export function buildGeminiLaunchCommand(input: AssignmentLaunchInput): AssignmentLaunchCommand {
  return buildCoreGeminiLaunchCommand(input);
}

async function main(): Promise<void> {
  await runWorkerAssignmentCli({
    usageCommand: "node dist/runtime/run-worker-assignment.js",
    buildLaunchCommand: buildGeminiLaunchCommand,
    execTimeoutMs: Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || undefined,
    verificationTimeoutMs: Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || undefined,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

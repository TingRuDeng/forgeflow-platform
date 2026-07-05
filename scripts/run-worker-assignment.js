#!/usr/bin/env node
import { formatLocalTimestamp } from "./lib/time.js";
import { importDispatcherWorkerRuntimeFactories, importWorkerAssignmentRuntime, } from "./lib/runtime-bootstrap.js";
const CODEX_MODEL = process.env.FORGEFLOW_CODEX_MODEL?.trim() || "";
const GEMINI_MODEL = "gemini-2.5-pro";
async function main() {
    const runtimeCore = await importWorkerAssignmentRuntime();
    const runtimeFactories = await importDispatcherWorkerRuntimeFactories();
    await runtimeCore.runWorkerAssignmentCli({
        usageCommand: "node scripts/run-worker-assignment.js",
        buildLaunchCommand: (input) => runtimeCore.buildDispatcherRuntimeLaunchCommand(input, {
            ...runtimeFactories,
            codexModel: CODEX_MODEL,
            geminiModel: GEMINI_MODEL,
        }),
        execTimeoutMs: Number(process.env.FORGEFLOW_EXEC_TIMEOUT_MS) || undefined,
        verificationTimeoutMs: Number(process.env.FORGEFLOW_VERIFICATION_TIMEOUT_MS) || undefined,
        generatedAt: formatLocalTimestamp,
    });
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

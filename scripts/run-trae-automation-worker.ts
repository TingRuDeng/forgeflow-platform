#!/usr/bin/env node

import {
  createAutomationGatewayClient,
  createDispatcherClient,
  createTraeAutomationWorkerRuntime,
  waitForAutomationGatewayReady,
  parseArgs,
} from "./lib/trae-automation-worker.js";

function printHelp(): void {
  console.log(`
Usage:
  node scripts/run-trae-automation-worker.js \\
    --repo-dir /abs/path/to/repo \\
    [--dispatcher-url http://127.0.0.1:8787] \\
    [--automation-url http://127.0.0.1:8790] \\
    [--worker-id trae-auto-gateway] \\
    [--poll-interval-ms 5000] \\
    [--once]
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.repoDir) {
    throw new Error("--repo-dir is required");
  }

  const dispatcherClient = createDispatcherClient(args.dispatcherUrl);
  const automationClient = createAutomationGatewayClient(args.automationUrl);
  const runtime = createTraeAutomationWorkerRuntime({
    dispatcherClient,
    automationClient,
    workerId: args.workerId,
    repoDir: args.repoDir,
    pollIntervalMs: args.pollIntervalMs,
    logger: console,
  });

  const readiness = await runtime.register();
  await waitForAutomationGatewayReady({
    automationClient,
    repoDir: args.repoDir,
    initialReadiness: readiness,
    retryIntervalMs: Math.min(Math.max(args.pollIntervalMs, 250), 5000),
    logger: console,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

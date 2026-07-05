#!/usr/bin/env node

import { runProviderWorkerCli } from "@tingrudeng/beta-runtime-core";

runProviderWorkerCli(process.argv.slice(2), {
  pool: "gemini",
  binFlag: "--gemini-bin",
  binEnv: "FORGEFLOW_GEMINI_BIN",
  exampleWorkerId: "gemini-mac-mini",
  exampleLabels: "mac,gemini",
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

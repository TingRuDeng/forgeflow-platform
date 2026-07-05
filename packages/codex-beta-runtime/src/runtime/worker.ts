#!/usr/bin/env node

import { runProviderWorkerCli } from "@tingrudeng/beta-runtime-core";

runProviderWorkerCli(process.argv.slice(2), {
  pool: "codex",
  binFlag: "--codex-bin",
  binEnv: "FORGEFLOW_CODEX_BIN",
  exampleWorkerId: "codex-mac-mini",
  exampleLabels: "mac,codex",
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

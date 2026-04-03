#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import { pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const dispatcherCliDistPath = path.join(
  repoRoot,
  "apps",
  "dispatcher",
  "dist",
  "modules",
  "server",
  "run-dispatcher-server.js",
);

await import("./lib/dispatcher-state.js");
const { applyPersistenceBackend, main, parseArgs, printHelp } = await import(
  pathToFileURL(dispatcherCliDistPath).href
);

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { applyPersistenceBackend, main, parseArgs, printHelp };

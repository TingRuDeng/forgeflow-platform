#!/usr/bin/env node
// @ts-nocheck

import path from "node:path";
import { fileURLToPath } from "node:url";

import { startDispatcherServer } from "./dispatcher-server.js";

const __filename = fileURLToPath(import.meta.url);

export function parseArgs(argv) {
  const args = {
    host: "127.0.0.1",
    port: 8787,
    stateDir: ".forgeflow-dispatcher",
    persistenceBackend: "sqlite",
    authMode: "legacy",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--host" && next) {
      args.host = next;
      index += 1;
      continue;
    }
    if (arg === "--port" && next) {
      args.port = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--state-dir" && next) {
      args.stateDir = next;
      index += 1;
      continue;
    }
    if (arg === "--persistence-backend" && next) {
      if (next !== "json" && next !== "sqlite") {
        throw new Error(`invalid persistence-backend: ${next}. Must be "json" or "sqlite"`);
      }
      args.persistenceBackend = next;
      index += 1;
      continue;
    }
    if (arg === "--auth-mode" && next) {
      if (next !== "token" && next !== "open" && next !== "legacy") {
        throw new Error(`invalid auth-mode: ${next}. Must be "token", "open", or "legacy"`);
      }
      args.authMode = next;
      index += 1;
      continue;
    }
    if (arg === "--help") {
      args.help = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

export function printHelp() {
  console.log(`
Usage:
  node scripts/run-dispatcher-server.js \\
    [--host 0.0.0.0] \\
    [--port 8787] \\
    [--state-dir .forgeflow-dispatcher] \\
    [--persistence-backend json|sqlite] \\
    [--auth-mode token|open|legacy]
`);
}

export function applyPersistenceBackend(args) {
  process.env.RUNTIME_STATE_BACKEND = args.persistenceBackend;
}

export function applyAuthMode(args) {
  process.env.DISPATCHER_AUTH_MODE = args.authMode;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  applyPersistenceBackend(args);
  applyAuthMode(args);
  const instance = await startDispatcherServer(args);
  console.log(JSON.stringify({
    status: "listening",
    host: instance.host,
    port: instance.port,
    baseUrl: instance.baseUrl,
    stateDir: args.stateDir,
    persistenceBackend: args.persistenceBackend,
    authMode: args.authMode,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

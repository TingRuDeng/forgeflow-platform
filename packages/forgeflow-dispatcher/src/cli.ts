import path from "node:path";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };
import {
  buildDefaultConfig,
  loadConfig,
  saveConfig,
  type DispatcherAuthMode,
  type DispatcherRuntimeConfig,
  type PersistenceBackend,
} from "./config.ts";
import { backupRuntimeState, restoreRuntimeState } from "./backup.ts";
import { runDoctor, getStatus } from "./doctor.ts";
import { startDispatcher } from "./dispatcher.ts";

const __filename = fileURLToPath(import.meta.url);

type Command = "init" | "start" | "doctor" | "status" | "backup" | "restore" | "version";
type ParsedArgs = {
  command: Command;
  options: Record<string, string | boolean>;
};

function parseCliArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error("command is required");
  }
  if (!["init", "start", "doctor", "status", "backup", "restore", "version"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg || !arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return {
    command: command as Command,
    options,
  };
}

function printHelp() {
  console.log(`
Usage:
  forgeflow-dispatcher init [--host 127.0.0.1] [--port 8787] [--state-dir ~/.forgeflow-dispatcher/state] [--persistence-backend sqlite|json] [--auth-mode token|legacy|open] [--token <token>]
  forgeflow-dispatcher start [--host <host>] [--port <port>] [--state-dir <dir>] [--persistence-backend sqlite|json] [--auth-mode token|legacy|open] [--token <token>]
  forgeflow-dispatcher doctor
  forgeflow-dispatcher status
  forgeflow-dispatcher backup [--backup-dir <dir>]
  forgeflow-dispatcher restore --backup-dir <dir>
  forgeflow-dispatcher version
`);
}

function resolveConfig(options: Record<string, string | boolean>): DispatcherRuntimeConfig {
  const config = loadConfig();
  const next: DispatcherRuntimeConfig = { ...config };

  if (typeof options.host === "string") {
    next.host = options.host;
  }
  if (typeof options.port === "string") {
    next.port = Number(options.port);
  }
  if (typeof options.stateDir === "string") {
    next.stateDir = options.stateDir;
  }
  if (typeof options.persistenceBackend === "string") {
    next.persistenceBackend = options.persistenceBackend as PersistenceBackend;
  }
  if (typeof options.authMode === "string") {
    next.authMode = options.authMode as DispatcherAuthMode;
  }
  if (typeof options.token === "string") {
    next.apiToken = options.token;
  }

  return next;
}

async function runInit(options: Record<string, string | boolean>) {
  const next = {
    ...buildDefaultConfig(),
    ...resolveConfig(options),
  };
  const configPath = saveConfig(next);
  console.log(JSON.stringify({
    status: "saved",
    configPath,
    host: next.host,
    port: next.port,
    stateDir: next.stateDir,
    persistenceBackend: next.persistenceBackend,
    authMode: next.authMode,
    tokenConfigured: Boolean(next.apiToken),
  }, null, 2));
}

async function runBackup(options: Record<string, string | boolean>) {
  const config = resolveConfig(options);
  const backupDir = typeof options.backupDir === "string"
    ? options.backupDir
    : path.join(config.stateDir, "backups", new Date().toISOString().replace(/[:]/g, "-"));
  const result = backupRuntimeState({
    stateDir: config.stateDir,
    backupDir,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runRestore(options: Record<string, string | boolean>) {
  const config = resolveConfig(options);
  if (typeof options.backupDir !== "string") {
    throw new Error("--backup-dir is required for restore");
  }
  const result = restoreRuntimeState({
    backupDir: options.backupDir,
    stateDir: config.stateDir,
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function runCli(argv: string[]) {
  const parsed = parseCliArgs(argv);
  if (parsed.options.help === true) {
    printHelp();
    return;
  }

  if (parsed.command === "version") {
    console.log(packageJson.version);
    return;
  }

  if (parsed.command === "init") {
    await runInit(parsed.options);
    return;
  }

  if (parsed.command === "doctor") {
    console.log(JSON.stringify(await runDoctor(resolveConfig(parsed.options)), null, 2));
    return;
  }

  if (parsed.command === "status") {
    console.log(JSON.stringify(await getStatus(resolveConfig(parsed.options)), null, 2));
    return;
  }

  if (parsed.command === "backup") {
    await runBackup(parsed.options);
    return;
  }

  if (parsed.command === "restore") {
    await runRestore(parsed.options);
    return;
  }

  if (parsed.command === "start") {
    await startDispatcher(resolveConfig(parsed.options));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

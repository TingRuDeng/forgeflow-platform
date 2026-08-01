#!/usr/bin/env node
import fs from "node:fs";

import {
  CONSOLE_CONFIG_FILENAME,
  loadConsoleConfigFile,
  saveConsoleConfigFile,
  secureConsoleConfigPermissions,
} from "../config-file.mjs";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
ForgeFlow Console Config Tool

Usage:
  forgeflow-console-config --token-stdin             Read and save dispatcher token from stdin
  forgeflow-console-config --url <dispatcher-url>    Save dispatcher URL
  forgeflow-console-config --show                    Show current config
  forgeflow-console-config --help                    Show this help

Config file priority:
  1. ./${CONSOLE_CONFIG_FILENAME} (project local)
  2. ~/${CONSOLE_CONFIG_FILENAME} (home directory)

Examples:
  # Save token without exposing it in process arguments
  printf '%s' "$FORGEFLOW_CONSOLE_API_TOKEN" | forgeflow-console-config --token-stdin

  # Save dispatcher URL
  forgeflow-console-config --url http://127.0.0.1:8787

  # Show current config
  forgeflow-console-config --show
`);
  process.exit(0);
}

if (args.includes("--show")) {
  const config = loadConsoleConfigFile();
  console.log("Current config:");
  console.log(`  dispatcherToken: ${config.dispatcherToken ? "(set)" : "(not set)"}`);
  console.log(`  dispatcherUrl:  ${config.dispatcherUrl || "(not set)"}`);
  process.exit(0);
}

if (args.includes("--token")) {
  console.error("--token is not supported because process arguments may be exposed; pipe the token through --token-stdin");
  process.exit(1);
}

const tokenFromStdin = args.includes("--token-stdin");
const urlIdx = args.indexOf("--url");

secureConsoleConfigPermissions();
const config = loadConsoleConfigFile();

if (tokenFromStdin) {
  const token = fs.readFileSync(0, "utf8").trim();
  if (!token) {
    console.error("--token-stdin requires a non-empty token on stdin");
    process.exit(1);
  }
  config.dispatcherToken = token;
  console.log("Token set.");
}

if (urlIdx !== -1 && args[urlIdx + 1]) {
  config.dispatcherUrl = args[urlIdx + 1];
  console.log("Dispatcher URL set.");
}

if (!tokenFromStdin && urlIdx === -1) {
  console.log("No changes. Use --help for usage.");
  process.exit(1);
}

const configPath = saveConsoleConfigFile(config);
console.log(`Config saved to ${configPath}`);

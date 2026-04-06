#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_FILENAME = ".forgeflow-dispatcher.json";

function getConfigPath() {
  return path.join(os.homedir(), CONFIG_FILENAME);
}

function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Config saved to ${configPath}`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
ForgeFlow Dispatcher Config Tool

Usage:
  forgeflow-dispatcher-config --token <token>        Set dispatcher token (for auth)
  forgeflow-dispatcher-config --mode <mode>          Set auth mode: legacy|token|open
  forgeflow-dispatcher-config --port <port>          Set port
  forgeflow-dispatcher-config --show                 Show current config
  forgeflow-dispatcher-config --help                 Show this help

Auth Modes:
  legacy  - No auth (default, insecure)
  token   - Requires DISPATCHER_API_TOKEN
  open    - No auth (explicit, for dev)

Config file: ~/${CONFIG_FILENAME}

Examples:
  # Enable token auth
  forgeflow-dispatcher-config --mode token --token my-secret-token

  # Show current config
  forgeflow-dispatcher-config --show
`);
  process.exit(0);
}

if (args.includes("--show")) {
  const config = loadConfig();
  console.log("Current config:");
  console.log(`  authMode:      ${config.authMode || "(not set, defaults to legacy)"}`);
  console.log(`  apiToken:      ${config.apiToken ? "(set)" : "(not set)"}`);
  console.log(`  port:          ${config.port || "(not set)"}`);
  process.exit(0);
}

const tokenIdx = args.indexOf("--token");
const modeIdx = args.indexOf("--mode");
const portIdx = args.indexOf("--port");

const config = loadConfig();

if (tokenIdx !== -1 && args[tokenIdx + 1]) {
  config.apiToken = args[tokenIdx + 1];
  console.log("Token set.");
}

if (modeIdx !== -1 && args[modeIdx + 1]) {
  const mode = args[modeIdx + 1].toLowerCase();
  if (!["legacy", "token", "open"].includes(mode)) {
    console.error("Invalid mode. Use: legacy, token, or open");
    process.exit(1);
  }
  config.authMode = mode;
  console.log(`Auth mode set to: ${mode}`);
}

if (portIdx !== -1 && args[portIdx + 1]) {
  config.port = parseInt(args[portIdx + 1], 10);
  console.log(`Port set to: ${config.port}`);
}

if (tokenIdx === -1 && modeIdx === -1 && portIdx === -1) {
  console.log("No changes. Use --help for usage.");
  process.exit(1);
}

saveConfig(config);

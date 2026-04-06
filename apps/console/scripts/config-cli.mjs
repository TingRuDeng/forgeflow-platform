#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_FILENAME = ".forgeflow-console.json";

function getConfigPath() {
  const projectConfig = path.join(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(projectConfig)) {
    return projectConfig;
  }
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
ForgeFlow Console Config Tool

Usage:
  forgeflow-console-config --token <token>           Save dispatcher token
  forgeflow-console-config --url <dispatcher-url>    Save dispatcher URL
  forgeflow-console-config --show                    Show current config
  forgeflow-console-config --help                    Show this help

Config file priority:
  1. ./${CONFIG_FILENAME} (project local)
  2. ~/${CONFIG_FILENAME} (home directory)

Examples:
  # Save token
  forgeflow-console-config --token my-secret-token

  # Save dispatcher URL
  forgeflow-console-config --url http://127.0.0.1:8787

  # Show current config
  forgeflow-console-config --show
`);
  process.exit(0);
}

if (args.includes("--show")) {
  const config = loadConfig();
  console.log("Current config:");
  console.log(`  dispatcherToken: ${config.dispatcherToken ? "(set)" : "(not set)"}`);
  console.log(`  dispatcherUrl:  ${config.dispatcherUrl || "(not set)"}`);
  process.exit(0);
}

const tokenIdx = args.indexOf("--token");
const urlIdx = args.indexOf("--url");

const config = loadConfig();

if (tokenIdx !== -1 && args[tokenIdx + 1]) {
  config.dispatcherToken = args[tokenIdx + 1];
  console.log("Token set.");
}

if (urlIdx !== -1 && args[urlIdx + 1]) {
  config.dispatcherUrl = args[urlIdx + 1];
  console.log("Dispatcher URL set.");
}

if (tokenIdx === -1 && urlIdx === -1) {
  console.log("No changes. Use --help for usage.");
  process.exit(1);
}

saveConfig(config);

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const packageDir = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(packageDir, "..", "..");

function resolvePnpmCommand(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /\.(?:c?js|mjs)$/.test(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath, ...args] };
  }
  if (npmExecPath) {
    return { command: npmExecPath, args };
  }
  return { command: "pnpm", args };
}

function runPnpm(args, options = {}) {
  const invocation = resolvePnpmCommand(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function forwardedVitestArgs() {
  const args = process.argv.slice(2);
  return args[0] === "--" ? args.slice(1) : args;
}

// 本地测试先构建 dist，再让兼容 wrapper 跳过每个 Vitest worker 内的重复构建。
runPnpm(["--filter", "@forgeflow/dispatcher", "build"], { cwd: repoRoot });

runPnpm(["exec", "vitest", "run", "--config", "vitest.config.ts", ...forwardedVitestArgs()], {
  cwd: packageDir,
  env: {
    ...process.env,
    FORGEFLOW_DISPATCHER_DIST_PREBUILT: "1",
  },
});

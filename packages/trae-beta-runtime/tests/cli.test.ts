import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { isCliEntrypoint, parseCliArgs, runCli } from "../src/cli.js";

import type { ManagedProcessStatus, StopManagedProcessResult } from "../src/process-control.js";
import type { SpawnedForgeFlowCommand as SpawnedGatewayCommand } from "../src/start-gateway.js";
import type { SpawnedForgeFlowCommand as SpawnedLaunchCommand } from "../src/start-launch.js";
import type { SpawnedForgeFlowCommand as SpawnedWorkerCommand } from "../src/start-worker.js";
import type { TraeBetaConfig, TraeBetaDoctorResult } from "../src/types.js";

const packageVersion = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

const exampleConfig: TraeBetaConfig = {
  version: 2,
  projectPath: "/tmp/project",
  dispatcherUrl: "http://127.0.0.1:8787",
  automationUrl: "http://127.0.0.1:8790",
  workerId: "trae-remote",
  traeBin: "/Applications/Trae CN.app",
  remoteDebuggingPort: 9222,
};

function createSpawnedCommandMock(
  overrides: Partial<SpawnedLaunchCommand & SpawnedGatewayCommand & SpawnedWorkerCommand> = {},
): SpawnedWorkerCommand {
  return {
    command: "node",
    args: [],
    cwd: "/tmp/forgeflow",
    scriptPath: "/tmp/forgeflow/scripts/mock.mjs",
    child: { pid: 1234 } as never,
    ready: Promise.resolve(),
    ...overrides,
  };
}

function createDoctorResult(overrides: Partial<TraeBetaDoctorResult> = {}): TraeBetaDoctorResult {
  return {
    ok: true,
    configPath: "/tmp/config.json",
    config: exampleConfig,
    checks: [],
    ...overrides,
  };
}

function createProcessStatus(
  kind: "launch" | "gateway" | "worker",
  overrides: Partial<ManagedProcessStatus> = {},
): ManagedProcessStatus {
  return {
    kind,
    scriptName: kind === "gateway" ? "run-trae-automation-gateway.js" : kind === "launch" ? "run-trae-automation-launch.js" : "dist/runtime/worker.js",
    running: false,
    matches: [],
    ...overrides,
  };
}

function createStopResult(
  kind: "launch" | "gateway" | "worker",
  overrides: Partial<StopManagedProcessResult> = {},
): StopManagedProcessResult {
  return {
    kind,
    scriptName: kind === "gateway" ? "run-trae-automation-gateway.js" : kind === "launch" ? "run-trae-automation-launch.js" : "dist/runtime/worker.js",
    stoppedPids: [],
    skippedPids: [],
    ...overrides,
  };
}

describe("@tingrudeng/trae-beta-runtime cli", () => {
  it("parses start worker flags", () => {
    const parsed = parseCliArgs([
      "start",
      "worker",
      "--poll-interval-ms",
      "5000",
      "--once",
      "--worker-id",
      "trae-remote",
    ]);

    expect(parsed).toEqual({
      command: "start",
      subcommand: "worker",
      options: {
        pollIntervalMs: 5000,
        once: true,
        workerId: "trae-remote",
      },
    });
  });

  it("parses stop worker flags", () => {
    const parsed = parseCliArgs(["stop", "worker"]);

    expect(parsed).toEqual({
      command: "stop",
      subcommand: "worker",
      options: {},
    });
  });

  it("parses version as a top-level command", () => {
    const parsed = parseCliArgs(["version"]);

    expect(parsed).toEqual({
      command: "version",
      options: {},
    });
  });

  it("parses --json flag", () => {
    const parsed = parseCliArgs(["status", "--json"]);

    expect(parsed).toEqual({
      command: "status",
      options: {
        json: true,
      },
    });
  });

  it("runs init and prints human-readable output by default", async () => {
    const log = vi.fn();
    const initConfig = vi.fn(() => ({
      created: true,
      configPath: "/tmp/config.json",
      config: exampleConfig,
    }));

    await runCli(["init", "--worker-id", "trae-remote"], {
      readConfig: vi.fn(() => null),
      initConfig,
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(initConfig).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "trae-remote",
    }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Created config at /tmp/config.json"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("projectPath: /tmp/project"));
  });

  it("runs init and prints JSON output with --json flag", async () => {
    const log = vi.fn();
    const initConfig = vi.fn(() => ({
      created: true,
      configPath: "/tmp/config.json",
      config: exampleConfig,
    }));

    await runCli(["init", "--worker-id", "trae-remote", "--json"], {
      readConfig: vi.fn(() => null),
      initConfig,
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(initConfig).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "trae-remote",
    }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("\"created\": true"));
  });

  it("uses config defaults when starting the worker with human-readable output", async () => {
    const log = vi.fn();
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));

    await runCli(["start", "worker", "--once"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startWorkerCmd).toHaveBeenCalledWith({
      repoDir: "/tmp/project",
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
      pollIntervalMs: undefined,
      once: true,
      force: false,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Started worker:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("PID: 1234"));
  });

  it("forwards --debug when starting the worker", async () => {
    const log = vi.fn();
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));

    await runCli(["start", "worker", "--once", "--debug"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startWorkerCmd).toHaveBeenCalledWith(expect.objectContaining({
      debug: true,
    }));
  });

  it("uses config defaults when starting the worker with JSON output", async () => {
    const log = vi.fn();
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));

    await runCli(["start", "worker", "--once", "--json"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startWorkerCmd).toHaveBeenCalledWith({
      repoDir: "/tmp/project",
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
      pollIntervalMs: undefined,
      once: true,
      force: false,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("\"pid\": 1234"));
  });

  it("formats and prints doctor output", async () => {
    const log = vi.fn();
    const result = createDoctorResult();
    const doctor = vi.fn(() => result);
    const formatDoctor = vi.fn(() => "ok: yes");

    await runCli(["doctor"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor,
      formatDoctor,
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(doctor).toHaveBeenCalledWith({
      configPath: undefined,
      config: exampleConfig,
    });
    expect(formatDoctor).toHaveBeenCalledWith(result);
    expect(log).toHaveBeenCalledWith("ok: yes");
  });

  it("reports local process status with human-readable output by default", async () => {
    const log = vi.fn();
    const listProcesses = vi.fn((kind: "launch" | "gateway" | "worker") => createProcessStatus(kind, {
      running: kind === "gateway",
      matches: kind === "gateway"
        ? [{ pid: 3001, command: "/usr/local/bin/node /tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790" }]
        : [],
    }));

    await runCli(["status"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses,
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(listProcesses).toHaveBeenNthCalledWith(1, "gateway");
    expect(listProcesses).toHaveBeenNthCalledWith(2, "worker");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Config: not found"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Gateway:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Status: running"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("PID 3001:"));
  });

  it("reports local process status with JSON output when --json is passed", async () => {
    const log = vi.fn();
    const listProcesses = vi.fn((kind: "launch" | "gateway" | "worker") => createProcessStatus(kind, {
      running: kind === "gateway",
      matches: kind === "gateway"
        ? [{ pid: 3001, command: "/usr/local/bin/node /tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js --host 127.0.0.1 --port 8790" }]
        : [],
    }));

    await runCli(["status", "--json"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses,
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(listProcesses).toHaveBeenNthCalledWith(1, "gateway");
    expect(listProcesses).toHaveBeenNthCalledWith(2, "worker");
    const loggedOutput = log.mock.calls[0][0];
    expect(loggedOutput).not.toContain("\n  ");
    expect(loggedOutput).toContain("\"configPresent\":false");
    expect(loggedOutput).toContain("\"pid\":3001");
  });

  it("prints package upgrade guidance for update", async () => {
    const log = vi.fn();
    const updateCmd = vi.fn(async () => ({
      packageName: "@tingrudeng/trae-beta-runtime",
      previousVersion: "0.1.0-beta.2",
      installedVersion: "0.1.0-beta.3",
      performedCommand: "npm install -g @tingrudeng/trae-beta-runtime@latest",
      stdout: "updated",
      stderr: "",
      message: "Updated the global ForgeFlow Trae beta runtime package. Restart long-running gateway/worker processes to use the new version.",
    }));

    await runCli(["update"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd,
      log,
    });

    expect(updateCmd).toHaveBeenCalledWith({
      defaultBranch: "latest",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Package: @tingrudeng/trae-beta-runtime"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Previous version: 0.1.0-beta.2"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Installed version: 0.1.0-beta.3"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("updated"));
  });

  it("runs package self-update for update with JSON output when --json is passed", async () => {
    const log = vi.fn();
    const updateCmd = vi.fn(async () => ({
      packageName: "@tingrudeng/trae-beta-runtime",
      previousVersion: "0.1.0-beta.2",
      installedVersion: "0.1.0-beta.3",
      performedCommand: "npm install -g @tingrudeng/trae-beta-runtime@latest",
      stdout: "updated",
      stderr: "",
      message: "Updated the global ForgeFlow Trae beta runtime package. Restart long-running gateway/worker processes to use the new version.",
    }));

    await runCli(["update", "--json"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd,
      log,
    });

    expect(updateCmd).toHaveBeenCalledWith({
      defaultBranch: "latest",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("\"performedCommand\": \"npm install -g @tingrudeng/trae-beta-runtime@latest\""));
  });

  it("prints the package version for version command and --version flag", async () => {
    const log = vi.fn();
    const deps = {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    };

    await runCli(["version"], deps);
    await runCli(["--version"], deps);

    expect(log).toHaveBeenNthCalledWith(1, packageVersion);
    expect(log).toHaveBeenNthCalledWith(2, packageVersion);
  });

  it("uses config defaults when starting launch and allows cli overrides with human-readable output", async () => {
    const log = vi.fn();
    const startLaunchCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js",
      args: ["/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js"],
    }));

    await runCli(["start", "launch", "--timeout-ms", "30000"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd,
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startLaunchCmd).toHaveBeenCalledWith({
      traeBin: "/Applications/Trae CN.app",
      projectPath: "/tmp/project",
      remoteDebuggingPort: 9222,
      timeoutMs: 30000,
      detached: undefined,
      logFile: undefined,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Started launch:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("run-trae-automation-launch.js"));
  });

  it("starts launch with detached and log-file flags", async () => {
    const log = vi.fn();
    const startLaunchCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js",
    }));

    await runCli(["start", "launch", "--detach", "--log-file", "/tmp/launch.log"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd,
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startLaunchCmd).toHaveBeenCalledWith({
      traeBin: "/Applications/Trae CN.app",
      projectPath: "/tmp/project",
      remoteDebuggingPort: 9222,
      timeoutMs: undefined,
      detached: true,
      logFile: "/tmp/launch.log",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Started launch:"));
  });

  it("starts gateway with cli host and port overrides with human-readable output", async () => {
    const log = vi.fn();
    const startGatewayCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js",
    }));

    await runCli(["start", "gateway", "--host", "0.0.0.0", "--port", "9999"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd,
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startGatewayCmd).toHaveBeenCalledWith({
      host: "0.0.0.0",
      port: 9999,
      force: false,
      detached: undefined,
      logFile: undefined,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Started gateway:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("run-trae-automation-gateway.js"));
  });

  it("starts gateway with detached and log-file flags", async () => {
    const log = vi.fn();
    const startGatewayCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js",
    }));

    await runCli(["start", "gateway", "--detach", "--log-file", "/tmp/gateway.log"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd,
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startGatewayCmd).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 8790,
      force: false,
      detached: true,
      logFile: "/tmp/gateway.log",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Started gateway:"));
  });

  it("uses automationUrl from config when starting gateway without overrides", async () => {
    const log = vi.fn();
    const startGatewayCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js",
    }));

    await runCli(["start", "gateway"], {
      readConfig: vi.fn(() => ({
        ...exampleConfig,
        automationUrl: "http://0.0.0.0:9911",
      })),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd,
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startGatewayCmd).toHaveBeenCalledWith({
      host: "0.0.0.0",
      port: 9911,
      force: false,
    });
  });

  it("stops only the requested managed process kind with human-readable output", async () => {
    const log = vi.fn();
    const stopProcesses = vi.fn(() => createStopResult("gateway", {
      stoppedPids: [3001],
    }));

    await runCli(["stop", "gateway"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses,
      stopLaunchCmd: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(stopProcesses).toHaveBeenCalledWith("gateway");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gateway: stopped 1 process(es)"));
  });

  it("stops only the requested managed process kind with JSON output when --json is passed", async () => {
    const log = vi.fn();
    const stopProcesses = vi.fn(() => createStopResult("gateway", {
      stoppedPids: [3001],
    }));

    await runCli(["stop", "gateway", "--json"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses,
      stopLaunchCmd: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(stopProcesses).toHaveBeenCalledWith("gateway");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("\"gateway\":"));
  });

  it("starts worker with detached and log-file flags", async () => {
    const log = vi.fn();
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));

    await runCli(["start", "worker", "--detach", "--log-file", "/tmp/worker.log"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(startWorkerCmd).toHaveBeenCalledWith({
      repoDir: "/tmp/project",
      dispatcherUrl: "http://127.0.0.1:8787",
      automationUrl: "http://127.0.0.1:8790",
      workerId: "trae-remote",
      traeBin: "/Applications/Trae CN.app",
      remoteDebuggingPort: 9222,
      pollIntervalMs: undefined,
      force: false,
      detached: true,
      logFile: "/tmp/worker.log",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Started worker:"));
  });

  it("treats a symlinked npm bin path as the CLI entrypoint", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trae-beta-cli-"));
    const realCliPath = path.join(tempDir, "cli.js");
    const symlinkCliPath = path.join(tempDir, "forgeflow-trae-beta");

    fs.writeFileSync(realCliPath, "#!/usr/bin/env node\n");
    fs.symlinkSync(realCliPath, symlinkCliPath);

    expect(isCliEntrypoint(pathToFileURL(fs.realpathSync(realCliPath)).href, symlinkCliPath)).toBe(true);
  });

  it("parses --help as help command", () => {
    const parsed = parseCliArgs(["--help"]);

    expect(parsed).toEqual({
      command: "help",
      options: {},
    });
  });

  it("parses -h as help command", () => {
    const parsed = parseCliArgs(["-h"]);

    expect(parsed).toEqual({
      command: "help",
      options: {},
    });
  });

  it("parses help as help command", () => {
    const parsed = parseCliArgs(["help"]);

    expect(parsed).toEqual({
      command: "help",
      options: {},
    });
  });

  it("parses start --help with help option", () => {
    const parsed = parseCliArgs(["start", "--help"]);

    expect(parsed).toEqual({
      command: "start",
      options: { help: true },
    });
  });

  it("parses start -h with help option", () => {
    const parsed = parseCliArgs(["start", "-h"]);

    expect(parsed).toEqual({
      command: "start",
      options: { help: true },
    });
  });

  it("parses -d as alias for --detach", () => {
    const parsed = parseCliArgs(["start", "worker", "-d"]);

    expect(parsed).toEqual({
      command: "start",
      subcommand: "worker",
      options: {
        detach: true,
      },
    });
  });

  it("parses -d with --log-file-dir for start all", () => {
    const parsed = parseCliArgs(["start", "all", "-d", "--log-file-dir", "/tmp/custom-logs"]);

    expect(parsed).toEqual({
      command: "start",
      subcommand: "all",
      options: {
        detach: true,
        logFileDir: "/tmp/custom-logs",
      },
    });
  });

  it("parses -d for restart all", () => {
    const parsed = parseCliArgs(["restart", "all", "-d", "--log-file-dir", "/tmp/restart-logs"]);

    expect(parsed).toEqual({
      command: "restart",
      subcommand: "all",
      options: {
        detach: true,
        logFileDir: "/tmp/restart-logs",
      },
    });
  });

  it("creates log-file-dir before starting services for start all", async () => {
    const log = vi.fn();
    const mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const waitForRemoteDebuggingReady = vi.fn(async () => undefined);
    const waitForAutomationReady = vi.fn(async () => undefined);
    const waitForDispatcherHealth = vi.fn(async () => undefined);
    const startLaunchCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js",
    }));
    const startGatewayCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js",
    }));
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));

    await runCli(["start", "all", "--log-file-dir", "/tmp/test-logs"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd,
      startGatewayCmd,
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      waitForRemoteDebuggingReady,
      waitForAutomationReady,
      waitForDispatcherHealth,
      log,
    });

    expect(mkdirSyncSpy).toHaveBeenCalledWith("/tmp/test-logs", { recursive: true });
    expect(startLaunchCmd).toHaveBeenCalledWith(expect.objectContaining({
      logFile: "/tmp/test-logs/launch.log",
    }));
    expect(startGatewayCmd).toHaveBeenCalledWith(expect.objectContaining({
      logFile: "/tmp/test-logs/gateway.log",
    }));
    expect(startWorkerCmd).toHaveBeenCalledWith(expect.objectContaining({
      logFile: "/tmp/test-logs/worker.log",
    }));
    expect(waitForRemoteDebuggingReady).toHaveBeenCalledWith({ remoteDebuggingPort: 9222 });
    expect(waitForAutomationReady).toHaveBeenCalledWith({ automationUrl: "http://127.0.0.1:8790" });
    expect(waitForDispatcherHealth).toHaveBeenCalledWith({ dispatcherUrl: "http://127.0.0.1:8787" });

    mkdirSyncSpy.mockRestore();
  });

  it("creates default log-file-dir before starting services for start all when omitted", async () => {
    const log = vi.fn();
    const mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const waitForRemoteDebuggingReady = vi.fn(async () => undefined);
    const waitForAutomationReady = vi.fn(async () => undefined);
    const waitForDispatcherHealth = vi.fn(async () => undefined);
    const startLaunchCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js",
    }));
    const startGatewayCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js",
    }));
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));

    await runCli(["start", "all"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd,
      startGatewayCmd,
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      waitForRemoteDebuggingReady,
      waitForAutomationReady,
      waitForDispatcherHealth,
      log,
    });

    expect(mkdirSyncSpy).toHaveBeenCalledWith("/tmp/forgeflow-trae-beta-logs", { recursive: true });
    mkdirSyncSpy.mockRestore();
  });

  it("creates log-file-dir before starting services for restart all", async () => {
    const log = vi.fn();
    const mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const waitForRemoteDebuggingReady = vi.fn(async () => undefined);
    const waitForAutomationReady = vi.fn(async () => undefined);
    const waitForDispatcherHealth = vi.fn(async () => undefined);
    const startLaunchCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-launch.js",
    }));
    const startGatewayCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/run-trae-automation-gateway.js",
    }));
    const startWorkerCmd = vi.fn(() => createSpawnedCommandMock({
      scriptPath: "/tmp/forgeflow/packages/trae-beta-runtime/dist/runtime/worker.js",
    }));
    const stopProcesses = vi.fn(() => createStopResult("worker"));
    const stopLaunchCmd = vi.fn(() => createStopResult("launch"));

    await runCli(["restart", "all", "--log-file-dir", "/tmp/restart-logs"], {
      readConfig: vi.fn(() => exampleConfig),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd,
      startGatewayCmd,
      startWorkerCmd,
      listProcesses: vi.fn(),
      stopProcesses,
      stopLaunchCmd,
      updateCmd: vi.fn(),
      waitForRemoteDebuggingReady,
      waitForAutomationReady,
      waitForDispatcherHealth,
      log,
    });

    expect(mkdirSyncSpy).toHaveBeenCalledWith("/tmp/restart-logs", { recursive: true });
    expect(startLaunchCmd).toHaveBeenCalledWith(expect.objectContaining({
      logFile: "/tmp/restart-logs/launch.log",
    }));
    expect(startGatewayCmd).toHaveBeenCalledWith(expect.objectContaining({
      logFile: "/tmp/restart-logs/gateway.log",
    }));
    expect(startWorkerCmd).toHaveBeenCalledWith(expect.objectContaining({
      logFile: "/tmp/restart-logs/worker.log",
    }));
    expect(waitForRemoteDebuggingReady).toHaveBeenCalledWith({ remoteDebuggingPort: 9222 });
    expect(waitForAutomationReady).toHaveBeenCalledWith({ automationUrl: "http://127.0.0.1:8790" });
    expect(waitForDispatcherHealth).toHaveBeenCalledWith({ dispatcherUrl: "http://127.0.0.1:8787" });

    mkdirSyncSpy.mockRestore();
  });

  it("parses stop --help with help option", () => {
    const parsed = parseCliArgs(["stop", "--help"]);

    expect(parsed).toEqual({
      command: "stop",
      options: { help: true },
    });
  });

  it("runs help and prints main help text", async () => {
    const log = vi.fn();

    await runCli(["help"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("forgeflow-trae-beta - ForgeFlow Trae Beta Runtime CLI"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage: forgeflow-trae-beta <command> [options]"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Commands:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("init"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("doctor"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("start"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("status"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stop"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("update"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("version"));
  });

  it("runs --help and prints main help text", async () => {
    const log = vi.fn();

    await runCli(["--help"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("forgeflow-trae-beta - ForgeFlow Trae Beta Runtime CLI"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Examples:"));
  });

  it("runs -h and prints main help text", async () => {
    const log = vi.fn();

    await runCli(["-h"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("forgeflow-trae-beta - ForgeFlow Trae Beta Runtime CLI"));
  });

  it("runs start --help and prints start help text", async () => {
    const log = vi.fn();

    await runCli(["start", "--help"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("forgeflow-trae-beta start - Start a runtime component"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Subcommands:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("launch"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gateway"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("worker"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--detach"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--log-file"));
  });

  it("runs stop --help and prints stop help text", async () => {
    const log = vi.fn();

    await runCli(["stop", "--help"], {
      readConfig: vi.fn(() => null),
      initConfig: vi.fn(),
      doctor: vi.fn(),
      formatDoctor: vi.fn(),
      startLaunchCmd: vi.fn(),
      startGatewayCmd: vi.fn(),
      startWorkerCmd: vi.fn(),
      listProcesses: vi.fn(),
      stopProcesses: vi.fn(),
      updateCmd: vi.fn(),
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("forgeflow-trae-beta stop - Stop a runtime component"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Subcommands:"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gateway"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("worker"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--json"));
  });
});

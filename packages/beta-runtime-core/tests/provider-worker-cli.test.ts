import { describe, expect, it, vi } from "vitest";

import {
  formatProviderWorkerCliHelp,
  parseProviderWorkerCliArgs,
  runProviderWorkerCli,
  type ProviderWorkerCliConfig,
} from "../src/runtime/provider-worker-cli.js";

const codexConfig: ProviderWorkerCliConfig = {
  pool: "codex",
  binFlag: "--codex-bin",
  binEnv: "FORGEFLOW_CODEX_BIN",
  exampleWorkerId: "codex-mac-mini",
  exampleLabels: "mac,codex",
};

const geminiConfig: ProviderWorkerCliConfig = {
  pool: "gemini",
  binFlag: "--gemini-bin",
  binEnv: "FORGEFLOW_GEMINI_BIN",
  exampleWorkerId: "gemini-mac-mini",
  exampleLabels: "mac,gemini",
};

describe("provider worker cli", () => {
  it("parses shared worker options and provider binary flag", () => {
    const parsed = parseProviderWorkerCliArgs([
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--worker-id",
      "codex-1",
      "--pool",
      "codex",
      "--repo-dir",
      "/repo",
      "--hostname",
      "host-1",
      "--labels",
      "mac,codex",
      "--codex-bin",
      "/usr/local/bin/codex",
      "--execution-policy-id",
      "sha256:test-policy",
      "--poll-interval-ms",
      "7000",
      "--dry-run-execution",
      "--once",
    ], codexConfig);

    expect(parsed).toEqual({
      dispatcherUrl: "http://127.0.0.1:8787",
      workerId: "codex-1",
      pool: "codex",
      repoDir: "/repo",
      hostname: "host-1",
      labels: ["mac", "codex"],
      providerBin: "/usr/local/bin/codex",
      executionPolicyId: "sha256:test-policy",
      pollIntervalMs: 7000,
      dryRunExecution: true,
      once: true,
    });
  });

  it("prints provider-specific help without duplicating help templates", () => {
    expect(formatProviderWorkerCliHelp(geminiConfig)).toContain("--worker-id gemini-mac-mini");
    expect(formatProviderWorkerCliHelp(geminiConfig)).toContain("[--gemini-bin gemini]");
    expect(formatProviderWorkerCliHelp(geminiConfig)).toContain("[--labels mac,gemini]");
  });

  it("rejects a worker pool that does not match the provider package", async () => {
    await expect(runProviderWorkerCli([
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--worker-id",
      "wrong-1",
      "--pool",
      "codex",
      "--repo-dir",
      "/repo",
    ], geminiConfig)).rejects.toThrow("--pool must be gemini");
  });

  it("sets provider binary env and delegates daemon startup to shared core", async () => {
    const env: Record<string, string | undefined> = {};
    const writes: string[] = [];
    const daemonCalls: unknown[] = [];

    await runProviderWorkerCli([
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--worker-id",
      "gemini-1",
      "--pool",
      "gemini",
      "--repo-dir",
      "/repo",
      "--gemini-bin",
      "/opt/gemini",
      "--once",
    ], geminiConfig, {
      env,
      writeStdout: (value) => writes.push(value),
      async runWorkerDaemon(input) {
        daemonCalls.push(input);
        return { status: "idle", workerId: input.workerId };
      },
    });

    expect(env.FORGEFLOW_GEMINI_BIN).toBe("/opt/gemini");
    expect(daemonCalls).toEqual([
      expect.objectContaining({
        dispatcherUrl: "http://127.0.0.1:8787",
        workerId: "gemini-1",
        pool: "gemini",
        repoDir: "/repo",
        once: true,
      }),
    ]);
    expect(writes.join("")).toContain("\"status\": \"idle\"");
  });

  it("fails before daemon registration when isolated execution is unavailable", async () => {
    const runWorkerDaemon = vi.fn(async () => ({
      status: "idle" as const,
      workerId: "codex-1",
    }));

    await expect(runProviderWorkerCli([
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--worker-id",
      "codex-1",
      "--pool",
      "codex",
      "--repo-dir",
      "/repo",
    ], codexConfig, {
      env: {
        FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
        FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
      },
      executionProfileProbe: () => ({
        status: 1,
        stderr: "docker daemon unavailable",
      }),
      runWorkerDaemon,
    })).rejects.toThrow("isolated execution profile blocked");

    expect(runWorkerDaemon).not.toHaveBeenCalled();
  });

  it("rejects a stale managed-process execution policy id", async () => {
    const runWorkerDaemon = vi.fn(async () => ({
      status: "idle" as const,
      workerId: "codex-1",
    }));

    await expect(runProviderWorkerCli([
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--worker-id",
      "codex-1",
      "--pool",
      "codex",
      "--repo-dir",
      "/repo",
      "--execution-policy-id",
      "sha256:stale",
    ], codexConfig, {
      env: {
        FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
        FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
      },
      executionProfileProbe: () => ({ status: 0 }),
      runWorkerDaemon,
    })).rejects.toThrow("execution policy id does not match");

    expect(runWorkerDaemon).not.toHaveBeenCalled();
  });
});

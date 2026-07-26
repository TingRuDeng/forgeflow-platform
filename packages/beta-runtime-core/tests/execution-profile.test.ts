import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyExecutionProfile,
  assertExecutionProfileReady,
  executionProfilePolicyId,
  resolveExecutionProfile,
  type ExecutionProfileProbe,
} from "../src/runtime/execution-profile.js";
import { buildWorkerEnv } from "../src/runtime/worker-env.js";

function isolatedEnv(overrides: Record<string, string> = {}) {
  return {
    FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
    FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
    ...overrides,
  };
}

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-profile-worktree-"));
  tempRoots.push(workspaceDir);
  return workspaceDir;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("provider-neutral execution profiles", () => {
  it("keeps trusted-host as the backward-compatible default", () => {
    expect(resolveExecutionProfile({})).toEqual({ name: "trusted-host" });
  });

  it("normalizes an isolated container profile with bounded defaults", () => {
    expect(resolveExecutionProfile(isolatedEnv())).toMatchObject({
      name: "isolated-container",
      runtime: "docker",
      image: "forgeflow-worker:test",
      network: "bridge",
      cpus: 2,
      memory: "4g",
      pidsLimit: 256,
      workspaceDir: "/workspace",
      homeDir: "/home/forgeflow",
      tempDir: "/tmp",
    });
  });

  it("builds a stable non-secret policy id only for isolated workers", () => {
    expect(executionProfilePolicyId({})).toBe("");
    expect(executionProfilePolicyId(isolatedEnv())).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(executionProfilePolicyId(isolatedEnv())).toBe(
      executionProfilePolicyId(isolatedEnv()),
    );
  });

  it("fails closed for an incomplete or invalid isolated profile", () => {
    expect(() => resolveExecutionProfile({
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
    })).toThrow("FORGEFLOW_EXECUTION_CONTAINER_IMAGE is required");
    expect(() => resolveExecutionProfile(isolatedEnv({
      FORGEFLOW_EXECUTION_NETWORK: "host",
    }))).toThrow("FORGEFLOW_EXECUTION_NETWORK must be bridge or none");
    expect(() => resolveExecutionProfile(isolatedEnv({
      FORGEFLOW_EXECUTION_CPUS: "0",
    }))).toThrow("FORGEFLOW_EXECUTION_CPUS must be a positive number");
  });

  it("wraps provider execution with container isolation and provider-only secrets", () => {
    const workspaceDir = makeWorkspace();
    const env = isolatedEnv({
      OPENAI_API_KEY: "openai-secret",
      GEMINI_API_KEY: "gemini-secret",
    });
    const profile = resolveExecutionProfile(env);
    const command = applyExecutionProfile({
      argv: ["codex", "exec", "Do the work"],
      cwd: workspaceDir,
    }, profile, {
      workspaceDir,
      provider: "codex",
      envSource: env,
    });

    expect(command.executionProfile).toBe("isolated-container");
    expect(command.argv.slice(0, 4)).toEqual(["docker", "run", "--rm", "--init"]);
    expect(command.argv).toEqual(expect.arrayContaining([
      "--read-only",
      "--cap-drop",
      "ALL",
      "--network",
      "bridge",
      "--cpus",
      "2",
      "--memory",
      "4g",
      "--pids-limit",
      "256",
      "OPENAI_API_KEY",
    ]));
    expect(command.argv).not.toContain("GEMINI_API_KEY");
    expect(command.argv).not.toContain("openai-secret");
    expect(command.argv).not.toContain("gemini-secret");
    expect(command.argv.slice(command.argv.indexOf("forgeflow-worker:test") + 1)).toEqual([
      "codex",
      "exec",
      "Do the work",
    ]);
  });

  it("probes the container runtime and exact image before execution", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const probe: ExecutionProfileProbe = (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    };
    const profile = resolveExecutionProfile(isolatedEnv());

    assertExecutionProfileReady(profile, probe);

    expect(calls).toEqual([
      {
        command: "docker",
        args: ["version", "--format", "{{.Server.Version}}"],
      },
      {
        command: "docker",
        args: ["image", "inspect", "forgeflow-worker:test"],
      },
    ]);
  });

  it("mounts external worktree git metadata read-only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-profile-git-"));
    tempRoots.push(root);
    const workspaceDir = path.join(root, "worktree");
    const commonDir = path.join(root, "repo", ".git");
    const gitDir = path.join(commonDir, "worktrees", "task-1");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, ".git"), `gitdir: ${gitDir}\n`);
    fs.writeFileSync(path.join(gitDir, "commondir"), "../..\n");

    const command = applyExecutionProfile({
      argv: ["codex", "exec", "Do the work"],
      cwd: workspaceDir,
    }, resolveExecutionProfile(isolatedEnv()), {
      workspaceDir,
      provider: "codex",
    });

    expect(command.argv).toContain(
      `type=bind,source=${fs.realpathSync(commonDir)},target=${commonDir},readonly`,
    );
    expect(command.argv).toEqual(expect.arrayContaining([
      "--env",
      "GIT_OPTIONAL_LOCKS=0",
    ]));
  });

  it("maps relative worktree git metadata to its container-visible target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-profile-relative-git-"));
    tempRoots.push(root);
    const workspaceDir = path.join(root, "worktrees", "task-1");
    const commonDir = path.join(root, "repo", ".git");
    const gitDir = path.join(commonDir, "worktrees", "task-1");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, ".git"),
      `gitdir: ${path.relative(workspaceDir, gitDir)}\n`,
    );
    fs.writeFileSync(path.join(gitDir, "commondir"), "../..\n");

    const command = applyExecutionProfile({
      argv: ["codex", "exec", "Do the work"],
      cwd: workspaceDir,
    }, resolveExecutionProfile(isolatedEnv()), {
      workspaceDir,
      provider: "codex",
    });

    expect(command.argv).toContain(
      `type=bind,source=${fs.realpathSync(commonDir)},target=/repo/.git,readonly`,
    );
  });

  it("rejects a symlink as the container worktree root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-profile-symlink-"));
    tempRoots.push(root);
    const targetDir = path.join(root, "target");
    const symlinkDir = path.join(root, "workspace");
    fs.mkdirSync(targetDir);
    fs.symlinkSync(targetDir, symlinkDir, "dir");

    expect(() => applyExecutionProfile({
      argv: ["codex", "exec", "Do the work"],
      cwd: symlinkDir,
    }, resolveExecutionProfile(isolatedEnv()), {
      workspaceDir: symlinkDir,
      provider: "codex",
    })).toThrow("worktree must be a real directory");
  });

  it("does not fall back to host execution when the runtime probe fails", () => {
    const probe = vi.fn<ExecutionProfileProbe>(() => ({
      status: 1,
      stderr: "daemon unavailable",
    }));

    expect(() => assertExecutionProfileReady(
      resolveExecutionProfile(isolatedEnv()),
      probe,
    )).toThrow("isolated execution profile blocked: container runtime unavailable");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("passes execution policy vars but not control-plane tokens to the assignment process", () => {
    const env = buildWorkerEnv({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "provider-key",
      DISPATCHER_API_TOKEN: "operator-token",
      GITHUB_TOKEN: "github-token",
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
      FORGEFLOW_EXECUTION_NETWORK: "none",
      FORGEFLOW_EXECUTION_MEMORY: "2g",
    }, "codex");

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "provider-key",
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
      FORGEFLOW_EXECUTION_NETWORK: "none",
      FORGEFLOW_EXECUTION_MEMORY: "2g",
    });
    expect(env.DISPATCHER_API_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("exposes at most the selected provider secret", () => {
    const source = {
      OPENAI_API_KEY: "openai-key",
      GEMINI_API_KEY: "gemini-key",
    };

    expect(buildWorkerEnv(source, "codex")).toEqual({
      OPENAI_API_KEY: "openai-key",
    });
    expect(buildWorkerEnv(source, "gemini")).toEqual({
      GEMINI_API_KEY: "gemini-key",
    });
    expect(buildWorkerEnv(source)).toEqual({});
  });

  it("cannot drop isolated policy through a legacy custom env allowlist", () => {
    const env = buildWorkerEnv({
      PATH: "/usr/bin",
      FORGEFLOW_WORKER_ENV_ALLOWLIST: "PATH",
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_RUNTIME: "/usr/local/bin/docker",
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      FORGEFLOW_EXECUTION_PROFILE: "isolated-container",
      FORGEFLOW_EXECUTION_CONTAINER_RUNTIME: "/usr/local/bin/docker",
      FORGEFLOW_EXECUTION_CONTAINER_IMAGE: "forgeflow-worker:test",
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  applyDispatchTargetWorker,
  buildSingleTaskDispatchInput,
  loadDispatchInput,
  runDispatch,
} from "../src/dispatch.js";
import { createJsonHttpClient } from "../src/http.js";

describe("dispatch", () => {
  it("loads dispatch input from a file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-dispatch-"));
    const filePath = path.join(dir, "dispatch.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        repo: "/repo",
        defaultBranch: "main",
        tasks: [],
        packages: [],
      }),
    );

    await expect(loadDispatchInput(filePath)).resolves.toMatchObject({
      repo: "/repo",
      defaultBranch: "main",
    });
  });

  it("posts the raw dispatch payload to the dispatcher", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          dispatchId: "dispatch-1",
          taskIds: ["dispatch-1:task-1"],
          assignments: [],
        }),
    });

    const result = await runDispatch({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      readStdin: async () =>
        JSON.stringify({
          repo: "/repo",
          defaultBranch: "main",
          tasks: [],
          packages: [],
        }),
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result).toMatchObject({
      dispatchId: "dispatch-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/dispatches",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("injects targetWorkerId into every task and package when requested", () => {
    const payload = applyDispatchTargetWorker(
      {
        repo: "/repo",
        defaultBranch: "main",
        tasks: [
          {
            title: "task-1",
            pool: "trae",
          },
        ],
        packages: [
          {
            assignmentId: "assignment-1",
          },
        ],
      },
      "trae-remote-forgeflow",
    );

    expect(payload.tasks).toEqual([
      expect.objectContaining({
        title: "task-1",
        targetWorkerId: "trae-remote-forgeflow",
      }),
    ]);
    expect(payload.packages).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-1",
        targetWorkerId: "trae-remote-forgeflow",
      }),
    ]);
  });

  it("requires the targeted worker to already be online when requested", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          workers: [
            { id: "trae-remote-forgeflow", pool: "trae", status: "idle" },
            { id: "trae-local-forgeflow", pool: "trae", status: "offline" },
          ],
        }),
      });

    await expect(runDispatch({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      payload: {
        repo: "/repo",
        defaultBranch: "main",
        tasks: [
          {
            id: "task-1",
            pool: "trae",
            targetWorkerId: "trae-local-forgeflow",
          },
        ],
        packages: [],
      },
      requireExistingWorker: true,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    })).rejects.toThrow('target worker "trae-local-forgeflow" is not online');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/dashboard/snapshot",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("requires an online worker in the task pool when no target worker is pinned", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          workers: [
            { id: "codex-worker-1", pool: "codex", status: "idle" },
            { id: "trae-offline", pool: "trae", status: "offline" },
          ],
        }),
      });

    await expect(runDispatch({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      payload: {
        repo: "/repo",
        defaultBranch: "main",
        tasks: [
          {
            id: "task-1",
            pool: "trae",
          },
        ],
        packages: [],
      },
      requireExistingWorker: true,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    })).rejects.toThrow('no online worker available for pool "trae"');
  });

  it("posts the dispatch when requireExistingWorker finds a matching online worker", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          workers: [
            { id: "trae-remote-forgeflow", pool: "trae", status: "idle" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            dispatchId: "dispatch-1",
            taskIds: ["dispatch-1:task-1"],
            assignments: [],
          }),
      });

    const result = await runDispatch({
      dispatcherUrl: "http://127.0.0.1:8787",
      input: "-",
      payload: {
        repo: "/repo",
        defaultBranch: "main",
        tasks: [
          {
            id: "task-1",
            pool: "trae",
            targetWorkerId: "trae-remote-forgeflow",
          },
        ],
        packages: [],
      },
      requireExistingWorker: true,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
    });

    expect(result).toMatchObject({
      dispatchId: "dispatch-1",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/api/dispatches",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("verifies every returned assignment against the intended target worker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          dispatchId: "dispatch-verify-all",
          taskIds: ["dispatch-verify-all:task-1", "dispatch-verify-all:task-2"],
          assignments: [
            { taskId: "dispatch-verify-all:task-1", workerId: "trae-remote-forgeflow" },
            { taskId: "dispatch-verify-all:task-2", workerId: "wrong-worker" },
          ],
        }),
    });

    await expect(
      runDispatch({
        dispatcherUrl: "http://127.0.0.1:8787",
        input: "-",
        payload: {
          repo: "/repo",
          defaultBranch: "main",
          tasks: [
            { id: "task-1", pool: "trae" },
            { id: "task-2", pool: "trae" },
          ],
          packages: [],
        },
        targetWorkerId: "trae-remote-forgeflow",
        fetchImpl: fetchImpl as typeof globalThis.fetch,
      }),
    ).rejects.toThrow('dispatch verification failed: expected worker "trae-remote-forgeflow" but dispatcher assigned worker "wrong-worker"');
  });

  it("lets explicit targetWorkerId override older snake_case values", () => {
    const payload = applyDispatchTargetWorker(
      {
        repo: "/repo",
        defaultBranch: "main",
        tasks: [
          {
            title: "task-1",
            target_worker_id: "old-worker",
          },
        ],
        packages: [
          {
            assignmentId: "assignment-1",
            target_worker_id: "old-worker",
          },
        ],
      },
      "trae-local-forgeflow",
    );

    expect(payload.tasks).toEqual([
      expect.objectContaining({
        title: "task-1",
        targetWorkerId: "trae-local-forgeflow",
        target_worker_id: "trae-local-forgeflow",
      }),
    ]);
    expect(payload.packages).toEqual([
      expect.objectContaining({
        assignmentId: "assignment-1",
        targetWorkerId: "trae-local-forgeflow",
        target_worker_id: "trae-local-forgeflow",
      }),
    ]);
  });

  it("builds a single-task dispatch payload from CLI-style options", () => {
    const payload = buildSingleTaskDispatchInput({
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      taskId: "task-1",
      title: "Add targeted dispatch docs",
      pool: "trae",
      branchName: "ai/trae/task-1-docs",
      allowedPaths: "docs/**,README.md",
      acceptance: "pnpm typecheck,git diff --check",
      requestedBy: "codex-control",
      targetWorkerId: "trae-remote-forgeflow",
      workerPrompt: "你是 trae-worker。",
      contextMarkdown: "# Context\n\nUpdate docs only.",
    });

    expect(payload).toMatchObject({
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      requestedBy: "codex-control",
      tasks: [
        {
          id: "task-1",
          title: "Add targeted dispatch docs",
          pool: "trae",
          branchName: "ai/trae/task-1-docs",
          allowedPaths: ["docs/**", "README.md"],
          acceptance: ["pnpm typecheck", "git diff --check"],
          targetWorkerId: "trae-remote-forgeflow",
        },
      ],
      packages: [
        {
          taskId: "task-1",
          assignment: {
            taskId: "task-1",
            pool: "trae",
            branchName: "ai/trae/task-1-docs",
            allowedPaths: ["docs/**", "README.md"],
            repo: "TingRuDeng/ForgeFlow",
            defaultBranch: "main",
            targetWorkerId: "trae-remote-forgeflow",
          },
          workerPrompt: "你是 trae-worker。",
          contextMarkdown: "# Context\n\nUpdate docs only.",
        },
      ],
    });
  });

  it("reads worker prompt from file when workerPromptFile is provided", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-prompt-"));
    const promptFile = path.join(dir, "worker-prompt.md");
    fs.writeFileSync(promptFile, "Custom worker prompt from file.\n");

    const payload = buildSingleTaskDispatchInput({
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      taskId: "task-1",
      title: "Test task",
      pool: "trae",
      branchName: "ai/trae/task-1",
      workerPromptFile: promptFile,
    });

    expect(payload.packages[0].workerPrompt).toBe("Custom worker prompt from file.");
  });

  it("reads context markdown from file when contextMarkdownFile is provided", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-context-"));
    const contextFile = path.join(dir, "context.md");
    fs.writeFileSync(contextFile, "# Task Context\n\nDetails here.\n");

    const payload = buildSingleTaskDispatchInput({
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      taskId: "task-1",
      title: "Test task",
      pool: "trae",
      branchName: "ai/trae/task-1",
      contextMarkdownFile: contextFile,
    });

    expect(payload.packages[0].contextMarkdown).toBe("# Task Context\n\nDetails here.");
  });

  it("prefers file content over inline values when both are provided", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-both-"));
    const promptFile = path.join(dir, "worker-prompt.md");
    const contextFile = path.join(dir, "context.md");
    fs.writeFileSync(promptFile, "Prompt from file.\n");
    fs.writeFileSync(contextFile, "Context from file.\n");

    const payload = buildSingleTaskDispatchInput({
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      taskId: "task-1",
      title: "Test task",
      pool: "trae",
      branchName: "ai/trae/task-1",
      workerPrompt: "Inline prompt (ignored)",
      contextMarkdown: "Inline context (ignored)",
      workerPromptFile: promptFile,
      contextMarkdownFile: contextFile,
    });

    expect(payload.packages[0].workerPrompt).toBe("Prompt from file.");
    expect(payload.packages[0].contextMarkdown).toBe("Context from file.");
  });

  it("falls back to inline values when file does not exist", () => {
    const payload = buildSingleTaskDispatchInput({
      repo: "TingRuDeng/ForgeFlow",
      defaultBranch: "main",
      taskId: "task-1",
      title: "Test task",
      pool: "trae",
      branchName: "ai/trae/task-1",
      workerPrompt: "Inline prompt used",
      contextMarkdown: "Inline context used",
      workerPromptFile: "/nonexistent/prompt.md",
      contextMarkdownFile: "/nonexistent/context.md",
    });

    expect(payload.packages[0].workerPrompt).toBe("Inline prompt used");
    expect(payload.packages[0].contextMarkdown).toBe("Inline context used");
  });

  it("falls back to curl when fetch fails for local dispatcher URL", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn().mockResolvedValue({
      dispatchId: "dispatch-curl-fallback",
      taskIds: ["dispatch-curl-fallback:task-1"],
      assignments: [],
    });

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    const result = await client.request("/api/dispatches", {
      method: "POST",
      body: { repo: "/repo", defaultBranch: "main", tasks: [], packages: [] },
    });

    expect(result).toMatchObject({ dispatchId: "dispatch-curl-fallback" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(curlImpl).toHaveBeenCalledTimes(1);
    expect(curlImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/dispatches",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws error when curl fallback returns 4xx JSON", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn().mockRejectedValue(new Error("task not found"));

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    await expect(
      client.request("/api/dispatches/dispatch-1%3Atask-1", { method: "GET" }),
    ).rejects.toThrow("task not found");
  });

  it("throws error when curl fallback returns 5xx JSON", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn().mockRejectedValue(new Error("internal server error"));

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    await expect(
      client.request("/api/dispatches", { method: "POST", body: {} }),
    ).rejects.toThrow("internal server error");
  });

  it("throws error when curl fallback returns non-JSON 4xx", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn().mockRejectedValue(new Error("HTTP 404"));

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    await expect(
      client.request("/api/dispatches/dispatch-1%3Atask-1", { method: "GET" }),
    ).rejects.toThrow("HTTP 404");
  });

  it("does not fall back to curl for non-local dispatcher URLs", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn();

    const client = createJsonHttpClient("http://dispatcher.example.com:8787", { fetchImpl, curlImpl });
    await expect(
      client.request("/api/dispatches", { method: "POST", body: {} }),
    ).rejects.toThrow("fetch failed");

    expect(curlImpl).not.toHaveBeenCalled();
  });

  it("does not fall back to curl when fetch succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ dispatchId: "dispatch-1" }),
    });
    const curlImpl = vi.fn();

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    const result = await client.request("/api/dispatches", {
      method: "POST",
      body: { repo: "/repo" },
    });

    expect(result).toMatchObject({ dispatchId: "dispatch-1" });
    expect(curlImpl).not.toHaveBeenCalled();
  });

  it("throws curl error when curl fallback fails for local URL", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn().mockRejectedValue(new Error("curl connection refused"));

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    await expect(
      client.request("/api/dispatches", { method: "POST", body: {} }),
    ).rejects.toThrow("curl connection refused");

    expect(curlImpl).toHaveBeenCalledTimes(1);
  });

  it("passes body with special characters to curl without shell interpretation", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const curlImpl = vi.fn().mockResolvedValue({ ok: true });

    const client = createJsonHttpClient("http://127.0.0.1:8787", { fetchImpl, curlImpl });
    const bodyWithSpecialChars = {
      message: "hello 'world' with \"quotes\" and $var `backticks`",
      nested: { arr: [1, 2, 3] },
      spaces: "  multiple   spaces  ",
    };

    await client.request("/api/dispatches", {
      method: "POST",
      body: bodyWithSpecialChars,
    });

    expect(curlImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(bodyWithSpecialChars),
      }),
    );
  });
});

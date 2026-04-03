import { describe, expect, it, vi } from "vitest";

import { createGitHubServer } from "../src/server.js";

describe("mcp github server", () => {
  it("delegates branch and pull request operations", async () => {
    const createBranch = vi.fn().mockResolvedValue({ ref: "refs/heads/ai/task-1" });
    const openPullRequest = vi.fn().mockResolvedValue({ number: 12, url: "https://example/pr/12" });
    const getPullRequestStatus = vi.fn().mockResolvedValue({ mergeable: true, checksPassed: true });
    const server = createGitHubServer({
      createBranch,
      openPullRequest,
      getPullRequestStatus,
    });

    const branch = await server.callTool("create_branch", {
      repo: "org/repo-a",
      branch: "ai/task-1",
      from: "main",
    });
    const pr = await server.callTool("open_pull_request", {
      repo: "org/repo-a",
      title: "feat: auth api",
      head: "ai/task-1",
      base: "main",
      body: "test body",
    });
    const status = await server.callTool("get_pull_request_status", {
      repo: "org/repo-a",
      number: 12,
    });

    expect(createBranch).toHaveBeenCalledWith({
      repo: "org/repo-a",
      branch: "ai/task-1",
      from: "main",
    });
    expect(openPullRequest).toHaveBeenCalledWith({
      repo: "org/repo-a",
      title: "feat: auth api",
      head: "ai/task-1",
      base: "main",
      body: "test body",
    });
    expect(getPullRequestStatus).toHaveBeenCalledWith({
      repo: "org/repo-a",
      number: 12,
    });
    expect(branch).toEqual({ ref: "refs/heads/ai/task-1" });
    expect(pr).toEqual({ number: 12, url: "https://example/pr/12" });
    expect(status).toEqual({ mergeable: true, checksPassed: true });
  });
});

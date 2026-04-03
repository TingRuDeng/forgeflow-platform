import { describe, expect, it, vi } from "vitest";

import { createRepoPolicyServer } from "../src/server.js";

describe("mcp repo policy server", () => {
  it("delegates path validation and command lookup", async () => {
    const validatePaths = vi.fn().mockResolvedValue({
      allowed: false,
      violations: ["infra/**"],
    });
    const getRepoCommands = vi.fn().mockResolvedValue({
      lint: "pnpm lint",
      test: "pnpm test",
    });
    const server = createRepoPolicyServer({
      validatePaths,
      getRepoCommands,
    });

    const validation = await server.callTool("validate_paths", {
      repo: "org/repo-a",
      allowedPaths: ["apps/api/**"],
      changedPaths: ["infra/prod.tf"],
    });
    const commands = await server.callTool("get_repo_commands", {
      repo: "org/repo-a",
    });

    expect(validatePaths).toHaveBeenCalledWith({
      repo: "org/repo-a",
      allowedPaths: ["apps/api/**"],
      changedPaths: ["infra/prod.tf"],
    });
    expect(getRepoCommands).toHaveBeenCalledWith({
      repo: "org/repo-a",
    });
    expect(validation).toEqual({
      allowed: false,
      violations: ["infra/**"],
    });
    expect(commands).toEqual({
      lint: "pnpm lint",
      test: "pnpm test",
    });
  });
});

import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli.js";

describe("codex beta runtime cli", () => {
  it("parses start worker options", () => {
    const parsed = parseCliArgs([
      "start",
      "worker",
      "--repo-dir",
      "/tmp/repo",
      "--dispatcher-url",
      "http://127.0.0.1:8787",
      "--worker-id",
      "codex-test",
      "--poll-interval-ms",
      "7000",
      "--detach",
    ]);

    expect(parsed.command).toBe("start");
    expect(parsed.subcommand).toBe("worker");
    expect(parsed.options.repoDir).toBe("/tmp/repo");
    expect(parsed.options.dispatcherUrl).toBe("http://127.0.0.1:8787");
    expect(parsed.options.workerId).toBe("codex-test");
    expect(parsed.options.pollIntervalMs).toBe(7000);
    expect(parsed.options.detach).toBe(true);
  });

  it("rejects non-worker subcommand", () => {
    expect(() => parseCliArgs(["start", "gateway"]))
      .toThrow("start subcommand must be worker");
  });
});

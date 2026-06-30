import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runArtifactGet } from "../src/artifact.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-cli-artifact-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function writeLocalArtifact(stateDir: string, bundleId: string): void {
  const artifactDir = path.join(stateDir, "artifacts", Buffer.from(bundleId).toString("base64url"));
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "diff.patch"), "diff body", "utf8");
  fs.writeFileSync(path.join(artifactDir, "manifest.json"), `${JSON.stringify({
    schemaVersion: "artifact-store/v1",
    bundleId,
    taskId: "task-1",
    attemptId: "attempt-1",
    createdAt: "2026-06-12T09:00:00.000Z",
    files: [
      {
        kind: "diff",
        fileName: "diff.patch",
        ref: `artifact://${bundleId}/diff.patch`,
        sizeBytes: 9,
      },
    ],
  }, null, 2)}\n`, "utf8");
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("artifact-get", () => {
  it("requests artifact file content from dispatcher", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      bundleId: "bundle-1",
      fileName: "diff.patch",
      content: "diff body",
    }), { status: 200 }));

    const result = await runArtifactGet({
      dispatcherUrl: "http://127.0.0.1:8787",
      bundleId: "bundle-1",
      fileName: "diff.patch",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/artifacts/bundle-1/files/diff.patch",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({ content: "diff body" });
  });

  it("reads artifact file content from local state-dir", async () => {
    const stateDir = makeTempDir();
    writeLocalArtifact(stateDir, "bundle-1");

    const result = await runArtifactGet({
      stateDir,
      bundleId: "bundle-1",
      fileName: "diff.patch",
    });

    expect(result).toEqual({
      bundleId: "bundle-1",
      fileName: "diff.patch",
      content: "diff body",
    });
  });
});

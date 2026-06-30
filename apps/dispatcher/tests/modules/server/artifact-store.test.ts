import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ArtifactBundle } from "@forgeflow/result-contracts";

import {
  listArtifactStoreManifests,
  persistArtifactBundleFiles,
  readArtifactStoreFile,
} from "../../../src/modules/server/artifact-store.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forgeflow-artifact-store-"));
  tempRoots.push(tempDir);
  return tempDir;
}

function createBundle(bundleId: string, createdAt: string): ArtifactBundle {
  return {
    bundleId,
    taskId: "task-1",
    attemptId: "attempt-1",
    schemaVersion: "artifact-bundle/v1",
    summary: "完成实现并通过测试",
    changedFiles: [],
    refs: {
      structuredReport: "artifact://attempt-1/result.json",
    },
    retainedContent: {
      diff: "diff --git a/src/a.ts b/src/a.ts",
      logs: "pnpm test passed",
      testResults: "1 passed",
    },
    riskNotes: [],
    nextActions: [],
    createdAt,
  };
}

afterEach(() => {
  for (const tempDir of tempRoots.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("artifact store", () => {
  it("persists retained artifact content as indexed files", () => {
    const stateDir = makeTempDir();
    const stored = persistArtifactBundleFiles(stateDir, createBundle("bundle-1", "2026-06-12T09:00:00.000Z"));

    expect(stored.bundle.refs).toMatchObject({
      diff: "artifact://bundle-1/diff.patch",
      logs: "artifact://bundle-1/session.log",
      testResults: "artifact://bundle-1/test-results.txt",
    });
    expect(stored.manifest.files.map((file) => file.fileName)).toEqual([
      "diff.patch",
      "session.log",
      "test-results.txt",
    ]);
    expect(readArtifactStoreFile(stateDir, "bundle-1", "diff.patch")).toBe("diff --git a/src/a.ts b/src/a.ts");
  });

  it("rejects artifact file path traversal", () => {
    const stateDir = makeTempDir();
    persistArtifactBundleFiles(stateDir, createBundle("bundle-1", "2026-06-12T09:00:00.000Z"));

    expect(() => readArtifactStoreFile(stateDir, "bundle-1", "../runtime-state.json")).toThrow(/invalid artifact file/);
  });

  it("retains only the newest bundles when maxBundles is set", () => {
    const stateDir = makeTempDir();
    persistArtifactBundleFiles(stateDir, createBundle("bundle-old", "2026-06-12T09:00:00.000Z"), {
      maxBundles: 2,
    });
    persistArtifactBundleFiles(stateDir, createBundle("bundle-mid", "2026-06-12T10:00:00.000Z"), {
      maxBundles: 2,
    });
    persistArtifactBundleFiles(stateDir, createBundle("bundle-new", "2026-06-12T11:00:00.000Z"), {
      maxBundles: 2,
    });

    expect(listArtifactStoreManifests(stateDir).map((manifest) => manifest.bundleId)).toEqual([
      "bundle-mid",
      "bundle-new",
    ]);
    expect(() => readArtifactStoreFile(stateDir, "bundle-old", "diff.patch")).toThrow(/artifact bundle not found/);
  });
});

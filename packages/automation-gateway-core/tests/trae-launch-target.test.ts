import { describe, expect, it, vi } from "vitest";

import { resolveMacAppBundleExecutable } from "../src/trae-launch-target.js";

describe("Trae launch target helpers", () => {
  it("keeps non-macOS commands unchanged", () => {
    expect(resolveMacAppBundleExecutable("/Applications/Trae.app", {
      fsImpl: createFsStub({ existing: ["/Applications/Trae.app"] }),
      platform: "linux",
    })).toBe("/Applications/Trae.app");
  });

  it("uses the direct macOS bundle executable when it exists", () => {
    const fsImpl = createFsStub({
      existing: [
        "/Applications/Trae CN.app",
        "/Applications/Trae CN.app/Contents/MacOS/Trae CN",
      ],
    });

    expect(resolveMacAppBundleExecutable("/Applications/Trae CN.app", {
      fsImpl,
      platform: "darwin",
    })).toBe("/Applications/Trae CN.app/Contents/MacOS/Trae CN");
  });

  it("falls back to the first file in Contents/MacOS", () => {
    const fsImpl = createFsStub({
      entries: ["README", "TraeExecutable"],
      existing: [
        "/Applications/Trae.app",
        "/Applications/Trae.app/Contents/MacOS",
      ],
      files: ["/Applications/Trae.app/Contents/MacOS/TraeExecutable"],
    });

    expect(resolveMacAppBundleExecutable("/Applications/Trae.app", {
      fsImpl,
      platform: "darwin",
    })).toBe("/Applications/Trae.app/Contents/MacOS/TraeExecutable");
  });

  it("keeps scanning when an entry cannot be inspected", () => {
    const fsImpl = createFsStub({
      entries: ["broken", "TraeExecutable"],
      existing: [
        "/Applications/Trae.app",
        "/Applications/Trae.app/Contents/MacOS",
      ],
      files: ["/Applications/Trae.app/Contents/MacOS/TraeExecutable"],
      statErrors: ["/Applications/Trae.app/Contents/MacOS/broken"],
    });

    expect(resolveMacAppBundleExecutable("/Applications/Trae.app", {
      fsImpl,
      platform: "darwin",
    })).toBe("/Applications/Trae.app/Contents/MacOS/TraeExecutable");
  });
});

function createFsStub(options: {
  entries?: string[];
  existing: string[];
  files?: string[];
  statErrors?: string[];
}) {
  const existing = new Set(options.existing);
  const files = new Set(options.files || []);
  const statErrors = new Set(options.statErrors || []);
  return {
    existsSync: vi.fn((input: string) => existing.has(input)),
    readdirSync: vi.fn(() => options.entries || []),
    statSync: vi.fn((input: string) => {
      if (statErrors.has(input)) {
        throw new Error(`stat failed: ${input}`);
      }
      return { isFile: () => files.has(input) };
    }),
  };
}

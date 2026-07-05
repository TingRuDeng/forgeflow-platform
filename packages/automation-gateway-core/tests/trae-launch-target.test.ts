import { describe, expect, it, vi } from "vitest";

import {
  hasRemoteDebuggingPortArg,
  parseLaunchArgs,
  resolveMacAppBundleExecutable,
  resolveTraeLaunchTarget,
} from "../src/trae-launch-target.js";

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

  it("parses launch args and detects remote debugging ports", () => {
    expect(parseLaunchArgs(" --foo  bar  ")).toEqual(["--foo", "bar"]);
    expect(parseLaunchArgs([" --foo ", "", "bar"])).toEqual(["--foo", "bar"]);
    expect(hasRemoteDebuggingPortArg(["--foo", "--remote-debugging-port=9555"])).toBe(true);
    expect(hasRemoteDebuggingPortArg(["--foo"])).toBe(false);
  });

  it("builds a launch target with env defaults and project path", () => {
    const fsImpl = createFsStub({
      existing: [
        "/repo",
        "/Applications/Trae.app",
        "/Applications/Trae.app/Contents/MacOS/Trae",
      ],
    });

    expect(resolveTraeLaunchTarget({
      defaultRemoteDebuggingPort: 9222,
      env: {
        TRAE_ARGS: "--user-data-dir=/tmp/trae",
        TRAE_BIN: "/Applications/Trae.app",
        TRAE_PROJECT_PATH: "/repo",
        TRAE_REMOTE_DEBUGGING_PORT: "9333",
      },
      fsImpl,
      platform: "darwin",
    })).toEqual({
      args: ["--user-data-dir=/tmp/trae", "--remote-debugging-port=9333", "/repo"],
      bundlePath: "/Applications/Trae.app",
      command: "/Applications/Trae.app/Contents/MacOS/Trae",
      projectPath: "/repo",
      remoteDebuggingPort: 9333,
    });
  });

  it("preserves an explicit remote debugging port arg and rejects missing projects", () => {
    const fsImpl = createFsStub({ existing: ["/repo"] });
    const target = resolveTraeLaunchTarget({
      defaultRemoteDebuggingPort: 9222,
      fsImpl,
      platform: "linux",
      projectPath: "/repo",
      remoteDebuggingPort: 9333,
      traeArgs: ["--remote-debugging-port=9444"],
      traeBin: "/usr/local/bin/trae",
    });

    expect(target.args).toEqual(["--remote-debugging-port=9444", "/repo"]);
    expect(target.remoteDebuggingPort).toBe(9333);
    expect(() => resolveTraeLaunchTarget({
      fsImpl,
      projectPath: "/missing",
      traeBin: "/usr/local/bin/trae",
    })).toThrow("project path does not exist: /missing");
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

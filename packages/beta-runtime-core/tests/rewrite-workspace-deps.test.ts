import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

// 发布辅助脚本是 npm lifecycle 直接运行的 mjs 文件，测试只校验其公开函数行为。
// @ts-expect-error 本地 mjs 脚本没有 TypeScript 声明。
import { rewriteWorkspaceDependencies } from "../../../scripts/rewrite-workspace-deps.mjs";

function createWorkspacePackage(rootDir: string, packageDir: string, pkg: object): string {
  const dir = path.join(rootDir, "packages", packageDir);
  fs.mkdirSync(dir, { recursive: true });
  const packageJsonPath = path.join(dir, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
  return packageJsonPath;
}

describe("rewrite-workspace-deps publish preparation", () => {
  it("rewrites workspace dependencies to concrete workspace package versions", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beta-runtime-publish-"));
    fs.writeFileSync(path.join(tempRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    createWorkspacePackage(tempRoot, "beta-runtime-core", {
      name: "@tingrudeng/beta-runtime-core",
      version: "0.1.0-beta.1",
    });
    const packageJsonPath = createWorkspacePackage(tempRoot, "codex-beta-runtime", {
      name: "@tingrudeng/codex-beta-runtime",
      version: "0.1.0-beta.2",
      dependencies: {
        "@tingrudeng/beta-runtime-core": "workspace:*",
      },
    });

    rewriteWorkspaceDependencies(packageJsonPath, { workspaceRoot: tempRoot });

    const updatedPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    expect(updatedPkg.dependencies?.["@tingrudeng/beta-runtime-core"]).toBe("0.1.0-beta.1");
  });

  it("fails closed when a workspace dependency version cannot be resolved", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beta-runtime-publish-"));
    fs.writeFileSync(path.join(tempRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const packageJsonPath = createWorkspacePackage(tempRoot, "gemini-beta-runtime", {
      name: "@tingrudeng/gemini-beta-runtime",
      version: "0.1.0-beta.2",
      dependencies: {
        "@tingrudeng/beta-runtime-core": "workspace:*",
      },
    });

    expect(() => rewriteWorkspaceDependencies(packageJsonPath, { workspaceRoot: tempRoot }))
      .toThrow("无法解析 workspace 依赖版本：@tingrudeng/beta-runtime-core");
  });
});

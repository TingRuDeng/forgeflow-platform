import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The publish helper lives in a plain .mjs script because npm runs it directly.
// Type coverage for the script itself is not needed in this test file.
// @ts-expect-error local publish script has no TypeScript declaration
import { rewriteWorkspaceDependencies } from "../scripts/remove-workspace-deps.mjs";

describe("remove-workspace-deps publish preparation", () => {
  it("rewrites workspace dependencies using the default repo workspace root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trae-publish-default-root-"));
    const packageDir = path.join(tempRoot, "packages", "trae-beta-runtime");
    const depDir = path.join(tempRoot, "packages", "automation-gateway-core");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(depDir, { recursive: true });

    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
      name: "@tingrudeng/trae-beta-runtime",
      version: "0.1.0-beta.59",
      dependencies: {
        "@tingrudeng/automation-gateway-core": "workspace:*",
      },
    }, null, 2));
    fs.writeFileSync(path.join(depDir, "package.json"), JSON.stringify({
      name: "@tingrudeng/automation-gateway-core",
      version: "0.1.0-beta.3",
    }, null, 2));

    const packageJsonPath = path.join(packageDir, "package.json");
    rewriteWorkspaceDependencies(packageJsonPath);

    const updatedPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    expect(updatedPkg.dependencies?.["@tingrudeng/automation-gateway-core"]).toBe("0.1.0-beta.3");
  });

  it("rewrites workspace dependencies to concrete workspace package versions", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trae-publish-"));
    const packageDir = path.join(tempRoot, "packages", "trae-beta-runtime");
    const depDir = path.join(tempRoot, "packages", "automation-gateway-core");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(depDir, { recursive: true });

    const packageJsonPath = path.join(packageDir, "package.json");
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: "@tingrudeng/trae-beta-runtime",
      version: "0.1.0-beta.57",
      dependencies: {
        "@tingrudeng/automation-gateway-core": "workspace:*",
        minimist: "^1.2.8",
      },
    }, null, 2));

    fs.writeFileSync(path.join(depDir, "package.json"), JSON.stringify({
      name: "@tingrudeng/automation-gateway-core",
      version: "0.1.0-beta.3",
    }, null, 2));

    rewriteWorkspaceDependencies(packageJsonPath, { workspaceRoot: tempRoot });

    const updatedPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    expect(updatedPkg.dependencies).toEqual({
      "@tingrudeng/automation-gateway-core": "0.1.0-beta.3",
      minimist: "^1.2.8",
    });
  });

  it("fails closed when a workspace dependency version cannot be resolved", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trae-publish-"));
    const packageDir = path.join(tempRoot, "packages", "trae-beta-runtime");
    fs.mkdirSync(packageDir, { recursive: true });

    const packageJsonPath = path.join(packageDir, "package.json");
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: "@tingrudeng/trae-beta-runtime",
      version: "0.1.0-beta.57",
      dependencies: {
        "@tingrudeng/automation-gateway-core": "workspace:*",
      },
    }, null, 2));

    expect(() => rewriteWorkspaceDependencies(packageJsonPath, { workspaceRoot: tempRoot }))
      .toThrow("Unable to resolve workspace dependency version for @tingrudeng/automation-gateway-core");
  });
});

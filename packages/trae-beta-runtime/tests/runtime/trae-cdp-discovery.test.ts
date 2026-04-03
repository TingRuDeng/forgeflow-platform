import { describe, expect, it } from "vitest";

describe("runtime/trae-cdp-discovery", () => {
  it("falls back to the single workbench page when title hints do not match", async () => {
    const { selectTraeTarget } = await import("../../src/runtime/trae-cdp-discovery.js");
    const pickTarget = selectTraeTarget as any;

    const targets = [
      {
        id: "page-1",
        type: "page",
        title: "clients.test.ts — ForgeFlow",
        url: "vscode-file://vscode-app/Applications/Trae%20CN.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html",
      },
      {
        id: "worker-1",
        type: "worker",
        title: "",
        url: "",
      },
    ] as any[];

    const target = pickTarget(targets, {
      titleContains: ["dispatch-108-redrive-32b0df09"],
    });

    expect(target).toMatchObject({
      id: "page-1",
      title: "clients.test.ts — ForgeFlow",
    });
  });

  it("still throws when there are multiple page targets and no hint matches", async () => {
    const { selectTraeTarget } = await import("../../src/runtime/trae-cdp-discovery.js");
    const pickTarget = selectTraeTarget as any;

    const targets = [
      {
        id: "page-1",
        type: "page",
        title: "clients.test.ts — ForgeFlow",
        url: "vscode-file://vscode-app/Applications/Trae%20CN.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html",
      },
      {
        id: "page-2",
        type: "page",
        title: "README.md — ForgeFlow",
        url: "vscode-file://vscode-app/Applications/Trae%20CN.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html",
      },
    ] as any[];

    expect(() => pickTarget(targets, {
      titleContains: ["dispatch-108-redrive-32b0df09"],
    })).toThrowError(/CDP_TARGET_NOT_FOUND|No matching Trae page target was found/);
  });
});

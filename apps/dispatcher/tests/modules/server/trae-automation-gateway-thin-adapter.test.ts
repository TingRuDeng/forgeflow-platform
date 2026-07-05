import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const scriptGatewayPath = path.join(repoRoot, "scripts/lib/trae-automation-gateway.ts");
const packagedGatewayPath = path.join(repoRoot, "packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts");
const coreGatewayPath = path.join(repoRoot, "packages/automation-gateway-core/src/gateway-handler.ts");
const coreHttpServerPath = path.join(repoRoot, "packages/automation-gateway-core/src/gateway-http-server.ts");

describe("trae automation gateway thin adapters", () => {
  it("keeps route and session handler logic in automation-gateway-core", () => {
    const scriptSource = fs.readFileSync(scriptGatewayPath, "utf8");
    const packagedSource = fs.readFileSync(packagedGatewayPath, "utf8");
    const coreSource = fs.readFileSync(coreGatewayPath, "utf8");

    expect(scriptSource).toContain("handleAutomationGatewayRequest");
    expect(packagedSource).toContain("handleAutomationGatewayRequest");
    expect(coreSource).toContain("pathname === \"/v1/chat\"");
    expect(scriptSource).not.toContain("pathname === \"/v1/chat\"");
    expect(packagedSource).not.toContain("pathname === \"/v1/chat\"");
    expect(scriptSource).not.toContain("request fingerprint mismatch");
    expect(packagedSource).not.toContain("request fingerprint mismatch");
  });

  it("keeps HTTP JSON IO and server wiring in automation-gateway-core", () => {
    const scriptSource = fs.readFileSync(scriptGatewayPath, "utf8");
    const packagedSource = fs.readFileSync(packagedGatewayPath, "utf8");
    const coreHttpSource = fs.readFileSync(coreHttpServerPath, "utf8");

    expect(coreHttpSource).toContain("startAutomationGatewayHttpServer");
    expect(coreHttpSource).toContain("readJsonBody");
    expect(coreHttpSource).toContain("writeError");
    expect(scriptSource).toContain("startAutomationGatewayHttpServer");
    expect(packagedSource).toContain("startAutomationGatewayHttpServer");
    expect(scriptSource).not.toContain("function readJsonBody");
    expect(packagedSource).not.toContain("function readJsonBody");
    expect(scriptSource).not.toContain("function writeJson");
    expect(packagedSource).not.toContain("function writeJson");
    expect(scriptSource).not.toContain("http.createServer");
    expect(packagedSource).not.toContain("http.createServer");
  });
});

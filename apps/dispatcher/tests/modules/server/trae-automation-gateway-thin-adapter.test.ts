import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../",
);
const scriptGatewayPath = path.join(repoRoot, "scripts/lib/trae-automation-gateway.ts");
const packagedGatewayPath = path.join(repoRoot, "packages/trae-beta-runtime/src/runtime/trae-automation-gateway.ts");
const scriptSessionStorePath = path.join(repoRoot, "scripts/lib/trae-automation-session-store.ts");
const packagedSessionStorePath = path.join(repoRoot, "packages/trae-beta-runtime/src/runtime/trae-automation-session-store.ts");
const coreGatewayPath = path.join(repoRoot, "packages/automation-gateway-core/src/gateway-handler.ts");
const coreHttpServerPath = path.join(repoRoot, "packages/automation-gateway-core/src/gateway-http-server.ts");
const coreDebugLogPath = path.join(repoRoot, "packages/automation-gateway-core/src/debug-log.ts");
const coreDriverFactoryPath = path.join(repoRoot, "packages/automation-gateway-core/src/driver-factory.ts");
const coreSessionStorePath = path.join(repoRoot, "packages/automation-gateway-core/src/session-store.ts");
const coreSessionStoreTypesPath = path.join(repoRoot, "packages/automation-gateway-core/src/session-store-types.ts");

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

  it("keeps gateway debug logger wiring in automation-gateway-core", () => {
    const scriptSource = fs.readFileSync(scriptGatewayPath, "utf8");
    const packagedSource = fs.readFileSync(packagedGatewayPath, "utf8");
    const coreDebugSource = fs.readFileSync(coreDebugLogPath, "utf8");

    expect(coreDebugSource).toContain("createAutomationGatewayDebugLogger");
    expect(coreDebugSource).toContain("isAutomationGatewayDebugEnabled");
    expect(coreDebugSource).toContain("[trae-gateway][debug]");
    expect(scriptSource).toContain("createAutomationGatewayDebugLogger");
    expect(packagedSource).toContain("createAutomationGatewayDebugLogger");
    expect(scriptSource).toContain("isAutomationGatewayDebugEnabled");
    expect(packagedSource).toContain("isAutomationGatewayDebugEnabled");
    expect(scriptSource).not.toContain("function createDebugLogger");
    expect(packagedSource).not.toContain("function createDebugLogger");
    expect(scriptSource).not.toContain("function isDebugEnabled");
    expect(packagedSource).not.toContain("function isDebugEnabled");
  });

  it("keeps gateway driver creation rules in automation-gateway-core", () => {
    const scriptSource = fs.readFileSync(scriptGatewayPath, "utf8");
    const packagedSource = fs.readFileSync(packagedGatewayPath, "utf8");
    const coreDriverSource = fs.readFileSync(coreDriverFactoryPath, "utf8");

    expect(coreDriverSource).toContain("resolveAutomationGatewayDriver");
    expect(coreDriverSource).toContain("createDriver");
    expect(coreDriverSource).toContain("debugEnabled");
    expect(scriptSource).toContain("resolveAutomationGatewayDriver");
    expect(packagedSource).toContain("resolveAutomationGatewayDriver");
    expect(scriptSource).not.toContain("const driverDebug");
    expect(packagedSource).not.toContain("const driverDebug");
    expect(scriptSource).not.toContain("debug: driverDebug");
    expect(packagedSource).not.toContain("debug: driverDebug");
  });

  it("keeps persistent session-store logic in automation-gateway-core", () => {
    const scriptSource = fs.readFileSync(scriptSessionStorePath, "utf8");
    const packagedSource = fs.readFileSync(packagedSessionStorePath, "utf8");
    const coreSource = fs.readFileSync(coreSessionStorePath, "utf8");
    const coreTypesSource = fs.readFileSync(coreSessionStoreTypesPath, "utf8");

    expect(coreSource).toContain("createPersistentAutomationSessionStore");
    expect(coreSource).toContain("parseSessionRecord");
    expect(coreTypesSource).toContain("Gateway restarted during execution");
    expect(scriptSource).toContain("createPersistentAutomationSessionStore");
    expect(packagedSource).toContain("createPersistentAutomationSessionStore");
    expect(scriptSource).not.toContain("JSON.parse");
    expect(packagedSource).not.toContain("JSON.parse");
    expect(scriptSource).not.toContain("fs.writeFileSync");
    expect(packagedSource).not.toContain("fs.writeFileSync");
    expect(scriptSource).not.toContain("parseSessionRecord");
    expect(packagedSource).not.toContain("parseSessionRecord");
  });
});

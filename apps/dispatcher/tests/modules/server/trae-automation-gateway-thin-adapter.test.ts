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
});

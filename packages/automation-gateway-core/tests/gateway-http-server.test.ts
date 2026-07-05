import { afterEach, describe, expect, it } from "vitest";

import {
  startAutomationGatewayHttpServer,
  type AutomationGatewayDriver,
  type StartedAutomationGatewayHttpServer,
} from "../src/index.js";

const startedServers: StartedAutomationGatewayHttpServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.close()));
});

function createDriver(): AutomationGatewayDriver {
  return {
    async getReadiness() {
      return { ready: true };
    },
    async prepareSession() {
      return { ok: true };
    },
    async sendPrompt() {
      return { response: { text: "ok" } };
    },
  };
}

describe("automation gateway HTTP server", () => {
  it("serves gateway requests through the shared request handler", async () => {
    const server = await startAutomationGatewayHttpServer({
      host: "127.0.0.1",
      port: 0,
      handlerOptions: {
        automationDriver: createDriver(),
      },
    });
    startedServers.push(server);

    const response = await fetch(`${server.baseUrl}/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      code: "OK",
      data: { ready: true },
    });
  });

  it("returns normalized JSON parse errors", async () => {
    const server = await startAutomationGatewayHttpServer({
      host: "127.0.0.1",
      port: 0,
      handlerOptions: {
        automationDriver: createDriver(),
      },
    });
    startedServers.push(server);

    const response = await fetch(`${server.baseUrl}/v1/chat`, {
      method: "POST",
      body: "{not-json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "INVALID_JSON",
      message: "Request body is not valid JSON",
    });
  });
});

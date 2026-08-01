import http, {
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createDispatcherClient } from "../../src/runtime/clients.js";

async function startHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    }),
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

describe("Trae dispatcher client loopback HTTP", () => {
  it("retries heartbeat over a real socket with one stable payload", async () => {
    const bodies: string[] = [];
    const server = await startHttpServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        bodies.push(body);
        if (bodies.length === 1) {
          sendJson(response, 503, { error: "temporarily unavailable" });
          return;
        }
        sendJson(response, 200, { status: "ok" });
      });
    });

    try {
      const client = createDispatcherClient(server.baseUrl);
      await expect(client.heartbeat("trae-http")).resolves.toEqual({ status: "ok" });

      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(JSON.parse(bodies[0]!)).toEqual({ worker_id: "trae-http" });
    } finally {
      await server.close();
    }
  });

  it("does not retry a permanent heartbeat response over a real socket", async () => {
    let requestCount = 0;
    const server = await startHttpServer((_request, response) => {
      requestCount += 1;
      sendJson(response, 409, { error: "worker is not registered" });
    });

    try {
      const client = createDispatcherClient(server.baseUrl);
      await expect(client.heartbeat("trae-http")).rejects.toMatchObject({ status: 409 });
      expect(requestCount).toBe(1);
    } finally {
      await server.close();
    }
  });
});

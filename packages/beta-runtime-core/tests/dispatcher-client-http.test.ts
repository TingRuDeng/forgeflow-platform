import http, {
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createDispatcherClient } from "../src/runtime/dispatcher-client.js";

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

describe("dispatcher client loopback HTTP", () => {
  it("retries a transient heartbeat response over a real socket", async () => {
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
      await expect(client.heartbeat("worker-http", {
        at: "2026-08-01T00:00:00.000Z",
      })).resolves.toEqual({ status: "ok" });

      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(JSON.parse(bodies[0]!)).toEqual({
        at: "2026-08-01T00:00:00.000Z",
      });
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
      await expect(client.heartbeat("worker-http", {
        at: "2026-08-01T00:00:00.000Z",
      })).rejects.toMatchObject({ status: 409 });

      expect(requestCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("cancels a real heartbeat retry wait without another request", async () => {
    let requestCount = 0;
    let resolveFirstRequest!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const server = await startHttpServer((_request, response) => {
      requestCount += 1;
      sendJson(response, 503, { error: "temporarily unavailable" });
      resolveFirstRequest();
    });
    const controller = new AbortController();

    try {
      const client = createDispatcherClient(server.baseUrl);
      const pending = client.heartbeat("worker-http", {
        at: "2026-08-01T00:00:00.000Z",
      }, { signal: controller.signal });
      await firstRequest;
      await new Promise((resolve) => setTimeout(resolve, 25));
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(requestCount).toBe(1);
    } finally {
      await server.close();
    }
  });
});

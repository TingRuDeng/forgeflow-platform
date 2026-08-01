import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http, {
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);
const workerScriptPath = path.join(repoRoot, "scripts/run-trae-mcp-worker-server.js");

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

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stdin.end();
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function callHeartbeat(
  baseUrl: string,
  workerId: string,
  environmentOverrides: Record<string, string> = {},
): Promise<Record<string, any>> {
  const child = spawn(process.execPath, [
    workerScriptPath,
    "--dispatcher-url",
    baseUrl,
    "--worker-id",
    workerId,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...environmentOverrides,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdoutBuffer = "";
  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  const response = new Promise<Record<string, any>>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error(`Trae MCP heartbeat response timed out: ${stderrBuffer}`));
    }, 8_000);
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(
          `Trae MCP worker exited before responding: code=${code} signal=${signal} ${stderrBuffer}`,
        ));
      }
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          let parsed: Record<string, any>;
          try {
            parsed = JSON.parse(line) as Record<string, any>;
          } catch (error) {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(new Error(
                `Trae MCP worker emitted non-JSON stdout: ${line} (${String(error)})`,
              ));
            }
            return;
          }
          if (parsed.id === 1 && !settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(parsed);
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "heartbeat",
      arguments: { worker_id: workerId },
    },
  })}\n`);

  try {
    return await response;
  } finally {
    await stopChild(child);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

describe("Trae MCP worker loopback HTTP", () => {
  it("rejects a whitespace worker token before sending a request", async () => {
    let requestCount = 0;
    const server = await startHttpServer((_request, response) => {
      requestCount += 1;
      sendJson(response, 200, { status: "ok" });
    });

    try {
      const response = await callHeartbeat(server.baseUrl, "trae-mcp-http", {
        DISPATCHER_WORKER_TOKEN: "   ",
        DISPATCHER_API_TOKEN: "control-token",
      });
      expect(response.result?.isError).toBe(true);
      expect(JSON.parse(response.result.content[0].text).error)
        .toMatch(/DISPATCHER_WORKER_TOKEN.*non-empty/i);
      expect(requestCount).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("retries heartbeat through the production stdio process", async () => {
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
      const response = await callHeartbeat(server.baseUrl, "trae-mcp-http");
      expect(response.result?.isError).not.toBe(true);
      expect(JSON.parse(response.result.content[0].text)).toEqual({ status: "ok" });
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(JSON.parse(bodies[0]!)).toEqual({ worker_id: "trae-mcp-http" });
    } finally {
      await server.close();
    }
  });

  it("does not retry a permanent heartbeat response", async () => {
    let requestCount = 0;
    const server = await startHttpServer((_request, response) => {
      requestCount += 1;
      sendJson(response, 409, { error: "worker is not registered" });
    });

    try {
      const response = await callHeartbeat(server.baseUrl, "trae-mcp-http");
      expect(response.result?.isError).toBe(true);
      expect(JSON.parse(response.result.content[0].text).error).toContain("HTTP 409");
      expect(requestCount).toBe(1);
    } finally {
      await server.close();
    }
  });
});

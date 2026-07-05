import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { ApiError, normalizeApiError } from "./gateway-errors.js";
import { handleAutomationGatewayRequest } from "./gateway-handler.js";
import type {
  AutomationGatewayResponse,
  HandleAutomationGatewayRequestOptions,
} from "./gateway-types.js";

export interface StartedAutomationGatewayHttpServer {
  host: string;
  port: number;
  baseUrl: string;
  server: http.Server;
  close: () => Promise<void>;
}

export interface StartAutomationGatewayHttpServerOptions {
  host: string;
  port: number;
  handlerOptions: HandleAutomationGatewayRequestOptions;
  debugLog?: (event: string, details?: Record<string, unknown>) => void;
}

function writeJson(res: ServerResponse, statusCode: number, payload: AutomationGatewayResponse["json"]): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function writeError(res: ServerResponse, error: unknown): void {
  const normalized = normalizeApiError(error);
  writeJson(res, normalized.statusCode, {
    success: false,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details || {},
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new ApiError("INVALID_JSON", "Request body is not valid JSON", 400));
      }
    });
    req.on("error", (error: Error) => {
      reject(new ApiError("READ_BODY_FAILED", "Failed to read request body", 400, {
        message: error.message,
      }));
    });
  });
}

function getServerPort(server: http.Server, fallbackPort: number): number {
  if (typeof server.address !== "function") {
    return fallbackPort;
  }
  const address = server.address();
  return typeof address === "object" && address ? address.port : fallbackPort;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function startAutomationGatewayHttpServer(
  options: StartAutomationGatewayHttpServerOptions,
): Promise<StartedAutomationGatewayHttpServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || options.host}`);
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      const result = await handleAutomationGatewayRequest({
        method: req.method || "GET",
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
      }, {
        ...options.handlerOptions,
        debugLog: options.handlerOptions.debugLog || options.debugLog,
      });
      writeJson(res, result.status, result.json);
    } catch (error) {
      options.debugLog?.("request.error", {
        method: req.method || "UNKNOWN",
        url: req.url || "/",
        message: error instanceof Error ? error.message : String(error),
      });
      writeError(res, error);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const port = getServerPort(server, options.port);
      resolve({
        host: options.host,
        port,
        baseUrl: `http://${options.host}:${port}`,
        server,
        close: () => closeServer(server),
      });
    });
  });
}

import { TraeAutomationError } from "./trae-automation-errors.js";

const DEFAULT_COMMAND_TIMEOUT_MS = Number(process.env.TRAE_CDP_COMMAND_TIMEOUT_MS || 30000);

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface WebSocketLike {
  readyState: number;
  addEventListener: (event: string, listener: (...args: unknown[]) => void, options?: { once?: boolean }) => void;
  send: (data: string) => void;
  close: () => void;
  CLOSING: number;
  CLOSED: number;
}

export interface CDPSession {
  send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  evaluate: (expression: string, options?: { awaitPromise?: boolean; returnByValue?: boolean; userGesture?: boolean }) => Promise<unknown>;
  close: () => Promise<void>;
}

interface WebSocketConstructor {
  new (url: string): WebSocketLike;
  CLOSING: number;
  CLOSED: number;
}

async function resolveWebSocketImpl(overrideImpl: unknown): Promise<WebSocketConstructor> {
  if (typeof overrideImpl === "function") {
    return overrideImpl as WebSocketConstructor;
  }
  if (typeof globalThis.WebSocket === "function") {
    return globalThis.WebSocket as WebSocketConstructor;
  }

  try {
    const imported = await import("ws");
    if (typeof (imported as unknown as { WebSocket?: unknown }).WebSocket === "function") {
      return (imported as unknown as { WebSocket: WebSocketConstructor }).WebSocket;
    }
    if (typeof (imported as unknown as { default?: unknown }).default === "function") {
      return (imported as unknown as { default: WebSocketConstructor }).default;
    }
  } catch {
    // handled below
  }

  throw new TraeAutomationError(
    "CDP_WEBSOCKET_UNAVAILABLE",
    "This Node runtime does not expose a global WebSocket and the optional 'ws' package is not installed"
  );
}

function rejectPendingRequests(pendingRequests: Map<number, PendingRequest>, error: Error): void {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeoutHandle);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function buildSocketClosedError(webSocketDebuggerUrl: string, closeInfo?: { code: number | null; reason: string }): TraeAutomationError {
  return new TraeAutomationError("CDP_SOCKET_CLOSED", "The CDP socket closed unexpectedly", {
    webSocketDebuggerUrl,
    code: closeInfo?.code ?? null,
    reason: closeInfo?.reason ?? "",
  });
}

async function readMessageData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (data && typeof (data as { text?: () => Promise<string> }).text === "function") {
    return (data as { text: () => Promise<string> }).text();
  }
  return String(data);
}

export interface CreateCDPSessionOptions {
  webSocketDebuggerUrl?: string;
  commandTimeoutMs?: number | string;
  WebSocket?: typeof globalThis.WebSocket;
}

export async function createCDPSession(options: CreateCDPSessionOptions = {}): Promise<CDPSession> {
  const webSocketDebuggerUrl = String(options.webSocketDebuggerUrl || "").trim();
  if (!webSocketDebuggerUrl) {
    throw new TraeAutomationError("CDP_URL_MISSING", "Missing webSocketDebuggerUrl for the CDP session");
  }

  const commandTimeoutMs = Number(options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS);
  const WebSocketImpl = await resolveWebSocketImpl(options.WebSocket);

  const socket = new WebSocketImpl(webSocketDebuggerUrl) as WebSocketLike;
  const pendingRequests = new Map<number, PendingRequest>();
  let nextCommandId = 1;
  let isClosed = false;
  let closeInfo: { code: number | null; reason: string } | null = null;
  let openResolved = false;

  const opened = new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      openResolved = true;
      resolve();
    };

    const handleOpenError = () => {
      if (!openResolved) {
        reject(
          new TraeAutomationError("CDP_SOCKET_OPEN_FAILED", "Failed to open the CDP socket", {
            webSocketDebuggerUrl,
          })
        );
      }
    };

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleOpenError, { once: true });
  });

  socket.addEventListener("close", (event: unknown) => {
    isClosed = true;
    const e = event as { code?: number; reason?: string };
    closeInfo = {
      code: typeof e.code === "number" ? e.code : null,
      reason: e.reason || "",
    };
    rejectPendingRequests(pendingRequests, buildSocketClosedError(webSocketDebuggerUrl, closeInfo));
  });

  socket.addEventListener("message", (event: unknown) => {
    Promise.resolve(readMessageData((event as { data: unknown }).data))
      .then((text) => {
        const message = JSON.parse(text) as { id?: number; error?: unknown; result?: unknown };
        if (!message || typeof message !== "object" || typeof message.id !== "number") {
          return;
        }
        const pending = pendingRequests.get(message.id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeoutHandle);
        pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(
            new TraeAutomationError("CDP_COMMAND_FAILED", "The browser rejected a CDP command", {
              method: pending.method,
              responseError: message.error,
            })
          );
          return;
        }
        pending.resolve(message.result);
      })
      .catch((error) => {
        rejectPendingRequests(
          pendingRequests,
          new TraeAutomationError("CDP_MESSAGE_PARSE_FAILED", "Failed to parse a CDP message", {
            message: (error as Error)?.message || String(error),
          })
        );
      });
  });

  async function send(method: string, params: Record<string, unknown> = {}, timeoutMs: number = commandTimeoutMs): Promise<unknown> {
    await opened;
    if (isClosed || socket.readyState >= WebSocketImpl.CLOSING) {
      throw buildSocketClosedError(webSocketDebuggerUrl, closeInfo ?? undefined);
    }

    const id = nextCommandId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        pendingRequests.delete(id);
        reject(
          new TraeAutomationError("CDP_COMMAND_TIMEOUT", "Timed out waiting for a CDP command response", {
            method,
            timeoutMs,
          })
        );
      }, timeoutMs);

      pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutHandle,
      });

      try {
        socket.send(payload);
      } catch (error) {
        clearTimeout(timeoutHandle);
        pendingRequests.delete(id);
        reject(
          new TraeAutomationError("CDP_COMMAND_SEND_FAILED", "Failed to send a CDP command", {
            method,
            message: (error as Error)?.message || String(error),
          })
        );
      }
    });
  }

  async function evaluate(expression: string, options: { awaitPromise?: boolean; returnByValue?: boolean; userGesture?: boolean } = {}): Promise<unknown> {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: options.awaitPromise !== false,
      returnByValue: options.returnByValue !== false,
      userGesture: options.userGesture !== false,
    }) as { exceptionDetails?: unknown; result?: { value?: unknown } } | undefined;

    if (result && result.exceptionDetails) {
      throw new TraeAutomationError("CDP_EVALUATION_FAILED", "The browser rejected a Runtime.evaluate expression", {
        exceptionDetails: result.exceptionDetails,
      });
    }

    if (!result || !result.result) {
      return undefined;
    }

    if (options.returnByValue === false) {
      return result.result;
    }

    return result.result.value;
  }

  async function close(): Promise<void> {
    if (isClosed || socket.readyState === WebSocketImpl.CLOSED) {
      return;
    }

    const closed = new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
    });

    socket.close();
    await closed;
  }

  await opened;
  await send("Runtime.enable");
  await send("Page.enable");
  try {
    await send("Page.bringToFront");
  } catch {
    // Some targets refuse focus if the window is already active.
  }

  return {
    send,
    evaluate,
    close,
  };
}

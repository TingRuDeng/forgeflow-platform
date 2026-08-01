import { describe, expect, it } from "vitest";

import {
  getDispatcherAuthHeader,
  normalizeOptionalDispatcherToken,
  resolveDispatcherAuthToken,
} from "../src/runtime/dispatcher-auth.js";

describe("dispatcher auth token normalization", () => {
  it("prefers a worker-scoped token and builds its bearer header", () => {
    const environment = {
      DISPATCHER_WORKER_TOKEN: "worker-token",
      DISPATCHER_API_TOKEN: "control-token",
    };

    expect(resolveDispatcherAuthToken(environment)).toBe("worker-token");
    expect(getDispatcherAuthHeader(environment)).toEqual({
      Authorization: "Bearer worker-token",
    });
  });

  it("returns no auth header when neither token is defined", () => {
    expect(resolveDispatcherAuthToken({})).toBeUndefined();
    expect(getDispatcherAuthHeader({})).toEqual({});
    expect(normalizeOptionalDispatcherToken(undefined, "token")).toBeUndefined();
  });

  it.each([
    ["DISPATCHER_WORKER_TOKEN", ""],
    ["DISPATCHER_WORKER_TOKEN", "   "],
    ["DISPATCHER_WORKER_TOKEN", " worker-token"],
    ["DISPATCHER_API_TOKEN", ""],
    ["DISPATCHER_API_TOKEN", "control-token "],
  ] as const)("rejects an invalid %s value", (name, value) => {
    expect(() => resolveDispatcherAuthToken({ [name]: value })).toThrow(
      new RegExp(`${name}.*non-empty string without surrounding whitespace`, "i"),
    );
  });

  it("does not fall back to the control token when a worker token is invalid", () => {
    expect(() => resolveDispatcherAuthToken({
      DISPATCHER_WORKER_TOKEN: "   ",
      DISPATCHER_API_TOKEN: "control-token",
    })).toThrow(/DISPATCHER_WORKER_TOKEN/i);
  });

  it("rejects an invalid control token even when the worker token is valid", () => {
    expect(() => resolveDispatcherAuthToken({
      DISPATCHER_WORKER_TOKEN: "worker-token",
      DISPATCHER_API_TOKEN: "   ",
    })).toThrow(/DISPATCHER_API_TOKEN/i);
  });
});

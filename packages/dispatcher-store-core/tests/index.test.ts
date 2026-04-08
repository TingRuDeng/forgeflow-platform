import { describe, expect, it } from "vitest";

import { normalizeShadowMode, projectionTableCount } from "../src/index.js";

describe("dispatcher-store-core", () => {
  it("normalizes unsupported shadow modes to disabled", () => {
    expect(normalizeShadowMode(undefined)).toBe("disabled");
    expect(normalizeShadowMode("weird")).toBe("disabled");
    expect(normalizeShadowMode("shadow-write")).toBe("shadow-write");
  });

  it("returns projection counts by table name", () => {
    expect(projectionTableCount({
      tables: [],
      counts: {
        tasks: 2,
      },
    }, "tasks")).toBe(2);
    expect(projectionTableCount({
      tables: [],
      counts: {},
    }, "missing")).toBe(0);
  });
});

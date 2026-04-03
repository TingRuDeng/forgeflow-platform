import { describe, expect, it } from "vitest";

const cliModuleUrl = new URL(
  "../../../../../scripts/run-dispatcher-server.js",
  import.meta.url,
).href;

async function loadCliModule() {
  // The CLI entrypoint is an ESM script file outside the TS project surface.
  // Dynamic import keeps the test focused on runtime wiring.
  return import(cliModuleUrl);
}

describe("run-dispatcher-server.js CLI", () => {
  it("defaults to sqlite persistence backend when no argument provided", async () => {
    const { parseArgs } = await loadCliModule();
    const args = parseArgs([]);
    expect(args.persistenceBackend).toBe("sqlite");
  });

  it("uses json persistence backend when --persistence-backend json is provided", async () => {
    const { parseArgs } = await loadCliModule();
    const args = parseArgs(["--persistence-backend", "json"]);
    expect(args.persistenceBackend).toBe("json");
  });

  it("uses sqlite persistence backend when --persistence-backend sqlite is explicitly provided", async () => {
    const { parseArgs } = await loadCliModule();
    const args = parseArgs(["--persistence-backend", "sqlite"]);
    expect(args.persistenceBackend).toBe("sqlite");
  });

  it("throws error for invalid persistence-backend value", async () => {
    const { parseArgs } = await loadCliModule();
    expect(() => {
      parseArgs(["--persistence-backend", "invalid"]);
    }).toThrow("invalid persistence-backend");
  });

  it("accepts all other standard arguments", async () => {
    const { parseArgs } = await loadCliModule();
    const args = parseArgs([
      "--host", "0.0.0.0",
      "--port", "3000",
      "--state-dir", "/tmp/test-state",
      "--persistence-backend", "json"
    ]);
    expect(args.host).toBe("0.0.0.0");
    expect(args.port).toBe(3000);
    expect(args.stateDir).toBe("/tmp/test-state");
    expect(args.persistenceBackend).toBe("json");
  });

  it("writes RUNTIME_STATE_BACKEND=json when json fallback is requested", async () => {
    const { applyPersistenceBackend, parseArgs } = await loadCliModule();
    const previous = process.env.RUNTIME_STATE_BACKEND;
    const args = parseArgs(["--persistence-backend", "json"]);
    applyPersistenceBackend(args);

    expect(process.env.RUNTIME_STATE_BACKEND).toBe("json");

    if (previous === undefined) {
      delete process.env.RUNTIME_STATE_BACKEND;
    } else {
      process.env.RUNTIME_STATE_BACKEND = previous;
    }
  });

  it("writes RUNTIME_STATE_BACKEND=sqlite by default", async () => {
    const { applyPersistenceBackend, parseArgs } = await loadCliModule();
    const previous = process.env.RUNTIME_STATE_BACKEND;
    const args = parseArgs([]);
    applyPersistenceBackend(args);

    expect(process.env.RUNTIME_STATE_BACKEND).toBe("sqlite");

    if (previous === undefined) {
      delete process.env.RUNTIME_STATE_BACKEND;
    } else {
      process.env.RUNTIME_STATE_BACKEND = previous;
    }
  });
});

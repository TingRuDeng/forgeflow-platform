import { defineConfig } from "vitest/config";

const DISPATCHER_INTEGRATION_TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  test: {
    testTimeout: DISPATCHER_INTEGRATION_TEST_TIMEOUT_MS,
  },
});

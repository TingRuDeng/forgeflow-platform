import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@tingrudeng/trae-beta-runtime cli build inputs", () => {
  it("keeps a node shebang on the CLI source entrypoint", () => {
    const cliPath = path.resolve(__dirname, "../src/cli.ts");
    const cliSource = fs.readFileSync(cliPath, "utf8");

    expect(cliSource.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});

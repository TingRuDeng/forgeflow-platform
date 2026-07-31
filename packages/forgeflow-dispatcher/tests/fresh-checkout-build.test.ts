import fs from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const betaRuntimeCorePackage = "@tingrudeng/beta-runtime-core";
const buildCorePrefix = `pnpm --filter ${betaRuntimeCorePackage} build && `;

describe("fresh checkout build contract", () => {
  it("declares beta-runtime-core as an explicit build-time dependency", () => {
    expect(packageJson.devDependencies?.[betaRuntimeCorePackage]).toBe("workspace:*");
  });

  it.each(["build", "typecheck", "test"])(
    "builds beta-runtime-core before %s",
    (scriptName) => {
      expect(packageJson.scripts?.[scriptName]?.startsWith(buildCorePrefix)).toBe(true);
    },
  );
});

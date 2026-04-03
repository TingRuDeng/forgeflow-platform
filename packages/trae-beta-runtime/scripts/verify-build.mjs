import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../dist/cli.js");

if (!fs.existsSync(cliPath)) {
  throw new Error(`Missing built CLI artifact: ${cliPath}`);
}

const cliSource = fs.readFileSync(cliPath, "utf8");

if (!cliSource.startsWith("#!/usr/bin/env node\n")) {
  throw new Error(`Built CLI artifact is missing the node shebang: ${cliPath}`);
}

console.log(`verified shebang: ${cliPath}`);

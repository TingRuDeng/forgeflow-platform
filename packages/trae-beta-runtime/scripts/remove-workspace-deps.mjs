import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, "..", "package.json");

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

let changed = false;

const deps = pkg.dependencies || {};
for (const [name, version] of Object.entries(deps)) {
  if (version === "workspace:*") {
    console.log(`Removing workspace:* dependency: ${name}`);
    delete deps[name];
    changed = true;
  }
}

if (changed) {
  pkg.dependencies = deps;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Updated package.json - workspace:* dependencies removed");
} else {
  console.log("No workspace:* dependencies found");
}

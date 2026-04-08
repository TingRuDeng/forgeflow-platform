import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, "..", "package.json");
const workspaceRoot = path.join(__dirname, "..", "..");

function findWorkspacePackageVersion(packageName, rootDir) {
  const packagesDir = path.join(rootDir, "packages");
  if (!fs.existsSync(packagesDir)) {
    return null;
  }

  for (const entry of fs.readdirSync(packagesDir)) {
    const candidatePath = path.join(packagesDir, entry, "package.json");
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    const candidatePkg = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    if (candidatePkg.name === packageName) {
      return candidatePkg.version || null;
    }
  }

  return null;
}

export function rewriteWorkspaceDependencies(targetPackageJsonPath, options = {}) {
  const rootDir = options.workspaceRoot || workspaceRoot;
  const pkg = JSON.parse(fs.readFileSync(targetPackageJsonPath, "utf8"));

  let changed = false;
  const deps = pkg.dependencies || {};

  for (const [name, version] of Object.entries(deps)) {
    if (version !== "workspace:*") {
      continue;
    }

    const resolvedVersion = findWorkspacePackageVersion(name, rootDir);
    if (!resolvedVersion) {
      throw new Error(`Unable to resolve workspace dependency version for ${name}`);
    }

    console.log(`Replacing workspace:* dependency: ${name} -> ${resolvedVersion}`);
    deps[name] = resolvedVersion;
    changed = true;
  }

  if (changed) {
    pkg.dependencies = deps;
    fs.writeFileSync(targetPackageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log("Updated package.json - workspace:* dependencies replaced with published versions");
  } else {
    console.log("No workspace:* dependencies found");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  rewriteWorkspaceDependencies(packageJsonPath);
}

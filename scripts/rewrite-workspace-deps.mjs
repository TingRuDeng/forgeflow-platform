import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWorkspaceRoot(startDir) {
  let currentDir = path.resolve(startDir);

  while (true) {
    const packagesDir = path.join(currentDir, "packages");
    const workspaceFile = path.join(currentDir, "pnpm-workspace.yaml");
    if (fs.existsSync(packagesDir) && fs.existsSync(workspaceFile)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`无法从 ${startDir} 解析 workspace 根目录`);
    }
    currentDir = parentDir;
  }
}

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
  const rootDir = options.workspaceRoot || resolveWorkspaceRoot(__dirname);
  const pkg = JSON.parse(fs.readFileSync(targetPackageJsonPath, "utf8"));

  let changed = false;
  const deps = pkg.dependencies || {};

  for (const [name, version] of Object.entries(deps)) {
    if (version !== "workspace:*") {
      continue;
    }

    const resolvedVersion = findWorkspacePackageVersion(name, rootDir);
    if (!resolvedVersion) {
      throw new Error(`无法解析 workspace 依赖版本：${name}`);
    }

    console.log(`替换 workspace:* 依赖：${name} -> ${resolvedVersion}`);
    deps[name] = resolvedVersion;
    changed = true;
  }

  if (changed) {
    pkg.dependencies = deps;
    fs.writeFileSync(targetPackageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log("已更新 package.json：workspace:* 依赖已替换为发布版本");
  } else {
    console.log("未发现 workspace:* 依赖");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const targetPackageJsonPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(process.cwd(), "package.json");
  rewriteWorkspaceDependencies(targetPackageJsonPath);
}

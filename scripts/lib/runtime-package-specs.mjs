import fs from "node:fs";
import path from "node:path";

export const RUNTIME_PACKAGES = [
  {
    dir: "packages/automation-gateway-core",
    name: "@tingrudeng/automation-gateway-core",
    role: "trae-support-core",
    dependencies: [],
  },
  {
    dir: "packages/beta-runtime-core",
    name: "@tingrudeng/beta-runtime-core",
    role: "codex-gemini-support-core",
    dependencies: [],
  },
  {
    bin: "forgeflow-codex-beta",
    dir: "packages/codex-beta-runtime",
    name: "@tingrudeng/codex-beta-runtime",
    role: "codex-remote-runtime",
    dependencies: ["@tingrudeng/beta-runtime-core"],
    rewriteScript: "node ../../scripts/rewrite-workspace-deps.mjs package.json",
  },
  {
    bin: "forgeflow-gemini-beta",
    dir: "packages/gemini-beta-runtime",
    name: "@tingrudeng/gemini-beta-runtime",
    role: "gemini-remote-runtime",
    dependencies: ["@tingrudeng/beta-runtime-core"],
    rewriteScript: "node ../../scripts/rewrite-workspace-deps.mjs package.json",
  },
  {
    bin: "forgeflow-trae-beta",
    dir: "packages/trae-beta-runtime",
    name: "@tingrudeng/trae-beta-runtime",
    role: "trae-remote-runtime",
    dependencies: ["@tingrudeng/automation-gateway-core"],
  },
];

export const RUNTIME_PACKAGE_GROUPS = {
  codex: [findRuntimePackage("@tingrudeng/beta-runtime-core"), findRuntimePackage("@tingrudeng/codex-beta-runtime")],
  gemini: [findRuntimePackage("@tingrudeng/beta-runtime-core"), findRuntimePackage("@tingrudeng/gemini-beta-runtime")],
  trae: [findRuntimePackage("@tingrudeng/automation-gateway-core"), findRuntimePackage("@tingrudeng/trae-beta-runtime")],
};

export function findRuntimePackage(packageName) {
  const spec = RUNTIME_PACKAGES.find((candidate) => candidate.name === packageName);
  if (!spec) {
    throw new Error(`unknown runtime package: ${packageName}`);
  }
  return spec;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readWorkspaceVersions(rootDir) {
  const versions = {};
  const packagesDir = path.join(rootDir, "packages");
  for (const entry of fs.readdirSync(packagesDir)) {
    const packageJsonPath = path.join(packagesDir, entry, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = readJson(packageJsonPath);
    if (packageJson.name && packageJson.version) {
      versions[packageJson.name] = packageJson.version;
    }
  }
  return versions;
}

export function rewriteWorkspaceDependencies(packageJson, versions) {
  const next = { ...packageJson };
  const dependencies = { ...(packageJson.dependencies || {}) };
  for (const [name, version] of Object.entries(dependencies)) {
    if (version !== "workspace:*") {
      continue;
    }
    if (!versions[name]) {
      throw new Error(`${packageJson.name} cannot resolve workspace dependency ${name}`);
    }
    dependencies[name] = versions[name];
  }
  next.dependencies = dependencies;
  return next;
}

import { execFile as nodeExecFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export interface UpdateOptions {
  defaultBranch?: string;
  installedVersion?: string | null;
  execFile?: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

export interface UpdateResult {
  packageName: string;
  installedVersion: string | null;
  performedCommand: string;
  stdout: string;
  stderr: string;
  message: string;
}

function resolveInstalledVersion(override?: string | null): string | null {
  if (override !== undefined) {
    return override;
  }

  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }

  try {
    const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

async function getGlobalInstalledVersion(
  packageName: string,
  execFile: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
): Promise<string | null> {
  try {
    const result = await execFile("npm", ["list", "-g", packageName, "--json"]);
    const output = JSON.parse(result.stdout) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const dep = output.dependencies?.[packageName];
    return dep?.version ?? null;
  } catch {
    return null;
  }
}

export async function updateLocalCheckout(options: UpdateOptions = {}): Promise<UpdateResult> {
  const packageName = "@tingrudeng/trae-beta-runtime";
  const installedVersion = resolveInstalledVersion(options.installedVersion);
  const distTag = String(options.defaultBranch || "latest").trim() || "latest";
  const packageSpecifier = `${packageName}@${distTag}`;
  const args = ["install", "-g", packageSpecifier];
  const performedCommand = `npm ${args.join(" ")}`;
  const execFile = options.execFile || promisify(nodeExecFile);

  try {
    const result = await execFile("npm", args);
    const actualVersion = await getGlobalInstalledVersion(packageName, execFile);
    return {
      packageName,
      installedVersion: actualVersion ?? installedVersion,
      performedCommand,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
      message: "Updated the global ForgeFlow Trae beta runtime package. Restart long-running gateway/worker processes to use the new version.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to update ${packageName}: ${message}`);
  }
}

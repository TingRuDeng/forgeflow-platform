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
  previousVersion: string | null;
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

function parseInstalledVersionFromNpmList(packageName: string, output: string): string | null {
  try {
    const parsed = JSON.parse(output) as {
      dependencies?: Record<string, { version?: unknown }>;
    };
    const version = parsed.dependencies?.[packageName]?.version;
    return typeof version === "string" && version.trim() ? version : null;
  } catch {
    return null;
  }
}

export async function updateLocalCheckout(options: UpdateOptions = {}): Promise<UpdateResult> {
  const packageName = "@tingrudeng/trae-beta-runtime";
  const previousVersion = resolveInstalledVersion(options.installedVersion);
  const distTag = String(options.defaultBranch || "latest").trim() || "latest";
  const packageSpecifier = `${packageName}@${distTag}`;
  const args = ["install", "-g", packageSpecifier];
  const performedCommand = `npm ${args.join(" ")}`;
  const execFile = options.execFile || promisify(nodeExecFile);

  try {
    const result = await execFile("npm", args);
    const verifyResult = await execFile("npm", ["list", "-g", packageName, "--json", "--depth=0"]);
    const installedVersion = parseInstalledVersionFromNpmList(packageName, String(verifyResult.stdout || ""));

    if (!installedVersion) {
      throw new Error(`updated package but could not verify the installed version via npm list -g ${packageName} --json --depth=0`);
    }

    return {
      packageName,
      previousVersion,
      installedVersion,
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

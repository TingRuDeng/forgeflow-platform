import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export function spawnProcessTree(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
  });
}

export function terminateProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGKILL",
): boolean {
  if (!child.pid) {
    return false;
  }

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return result.status === 0;
  }

  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error: any) {
    if (error?.code === "ESRCH") {
      return false;
    }
    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  }
}

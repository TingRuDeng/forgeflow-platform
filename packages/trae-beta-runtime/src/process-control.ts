import { execFileSync } from "node:child_process";

export type ManagedProcessKind = "launch" | "gateway" | "worker";

export interface ManagedProcessMatch {
  pid: number;
  command: string;
}

export interface ManagedProcessStatus {
  kind: ManagedProcessKind;
  scriptName: string;
  running: boolean;
  matches: ManagedProcessMatch[];
}

export interface StopManagedProcessResult {
  kind: ManagedProcessKind;
  scriptName: string;
  stoppedPids: number[];
  skippedPids: number[];
}

export interface ProcessControlDeps {
  execFileSync: typeof execFileSync;
  kill: typeof process.kill;
}

const SCRIPT_BY_KIND: Record<ManagedProcessKind, string> = {
  launch: "run-trae-automation-launch.js",
  gateway: "run-trae-automation-gateway.js",
  worker: "dist/runtime/worker.js",
};

function getDeps(overrides: Partial<ProcessControlDeps> = {}): ProcessControlDeps {
  return {
    execFileSync,
    kill: process.kill.bind(process),
    ...overrides,
  };
}

function parsePgrepOutput(output: string, scriptName: string): ManagedProcessMatch[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      const pid = Number(match[1]);
      const command = match[2] || "";
      if (!Number.isInteger(pid) || pid <= 0 || !command.includes(scriptName)) {
        return null;
      }
      return {
        pid,
        command,
      };
    })
    .filter((value): value is ManagedProcessMatch => value !== null);
}

function parsePidOnlyOutput(output: string): number[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number(line))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function parsePsOutput(output: string, scriptName: string): ManagedProcessMatch[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      const pid = Number(match[1]);
      const command = match[2] || "";
      if (!Number.isInteger(pid) || pid <= 0 || !command.includes(scriptName)) {
        return null;
      }
      return {
        pid,
        command,
      };
    })
    .filter((value): value is ManagedProcessMatch => value !== null);
}

function resolveMatchesFromPidList(
  deps: ProcessControlDeps,
  pids: number[],
  scriptName: string,
): ManagedProcessMatch[] {
  if (pids.length === 0) {
    return [];
  }

  try {
    const output = String(
      deps.execFileSync("ps", ["-p", pids.join(","), "-o", "pid=,command="], {
        encoding: "utf8",
      }),
    );
    return parsePsOutput(output, scriptName);
  } catch (error) {
    const details = error as NodeJS.ErrnoException & { stdout?: string | Buffer };
    const stdout = details.stdout ? String(details.stdout) : "";
    return stdout ? parsePsOutput(stdout, scriptName) : [];
  }
}

export function listManagedProcesses(
  kind: ManagedProcessKind,
  overrides: Partial<ProcessControlDeps> = {},
): ManagedProcessStatus {
  const deps = getDeps(overrides);
  const scriptName = SCRIPT_BY_KIND[kind];

  try {
    const output = String(
      deps.execFileSync("pgrep", ["-af", scriptName], {
        encoding: "utf8",
      }),
    );
    const matches = parsePgrepOutput(output, scriptName);
    const resolvedMatches = matches.length > 0
      ? matches
      : resolveMatchesFromPidList(deps, parsePidOnlyOutput(output), scriptName);
    return {
      kind,
      scriptName,
      running: resolvedMatches.length > 0,
      matches: resolvedMatches,
    };
  } catch (error) {
    const details = error as NodeJS.ErrnoException & { stdout?: string | Buffer };
    const stdout = details.stdout ? String(details.stdout) : "";
    const matches = stdout ? parsePgrepOutput(stdout, scriptName) : [];
    const resolvedMatches = matches.length > 0
      ? matches
      : resolveMatchesFromPidList(deps, stdout ? parsePidOnlyOutput(stdout) : [], scriptName);
    return {
      kind,
      scriptName,
      running: resolvedMatches.length > 0,
      matches: resolvedMatches,
    };
  }
}

export function stopManagedProcesses(
  kind: ManagedProcessKind,
  overrides: Partial<ProcessControlDeps> = {},
): StopManagedProcessResult {
  const deps = getDeps(overrides);
  const status = listManagedProcesses(kind, overrides);
  const stoppedPids: number[] = [];
  const skippedPids: number[] = [];

  for (const match of status.matches) {
    try {
      deps.kill(match.pid, "SIGTERM");
      stoppedPids.push(match.pid);
    } catch {
      skippedPids.push(match.pid);
    }
  }

  return {
    kind,
    scriptName: status.scriptName,
    stoppedPids,
    skippedPids,
  };
}

export function stopLaunch(
  overrides: Partial<ProcessControlDeps> = {},
): StopManagedProcessResult {
  return stopManagedProcesses("launch", overrides);
}

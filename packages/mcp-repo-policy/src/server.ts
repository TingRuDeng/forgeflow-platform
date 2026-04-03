export interface ValidatePathsInput {
  repo: string;
  allowedPaths: string[];
  changedPaths: string[];
}

export interface RepoInput {
  repo: string;
}

export interface RepoPolicyServerDeps {
  validatePaths(input: ValidatePathsInput): Promise<unknown> | unknown;
  getRepoCommands(input: RepoInput): Promise<unknown> | unknown;
}

export type RepoPolicyToolName = "validate_paths" | "get_repo_commands";

const TOOL_DEFINITIONS = [
  { name: "validate_paths", description: "Validate changed paths against repo policy." },
  { name: "get_repo_commands", description: "Get repo-specific lint, test, and build commands." },
] as const;

export function createRepoPolicyServer(deps: RepoPolicyServerDeps) {
  return {
    listTools(): typeof TOOL_DEFINITIONS {
      return [...TOOL_DEFINITIONS];
    },
    async callTool(name: RepoPolicyToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "validate_paths":
          return deps.validatePaths(args as unknown as ValidatePathsInput);
        case "get_repo_commands":
          return deps.getRepoCommands(args as unknown as RepoInput);
      }
    },
  };
}

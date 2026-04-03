export interface CreateBranchInput {
  repo: string;
  branch: string;
  from: string;
}

export interface OpenPullRequestInput {
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface PullRequestStatusInput {
  repo: string;
  number: number;
}

export interface GitHubServerDeps {
  createBranch(input: CreateBranchInput): Promise<unknown> | unknown;
  openPullRequest(input: OpenPullRequestInput): Promise<unknown> | unknown;
  getPullRequestStatus(input: PullRequestStatusInput): Promise<unknown> | unknown;
}

export type GitHubToolName =
  | "create_branch"
  | "open_pull_request"
  | "get_pull_request_status";

const TOOL_DEFINITIONS = [
  { name: "create_branch", description: "Create a branch in the target repository." },
  { name: "open_pull_request", description: "Open a pull request in the target repository." },
  { name: "get_pull_request_status", description: "Read pull request merge and check status." },
] as const;

export function createGitHubServer(deps: GitHubServerDeps) {
  return {
    listTools(): typeof TOOL_DEFINITIONS {
      return [...TOOL_DEFINITIONS];
    },
    async callTool(name: GitHubToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "create_branch":
          return deps.createBranch(args as unknown as CreateBranchInput);
        case "open_pull_request":
          return deps.openPullRequest(args as unknown as OpenPullRequestInput);
        case "get_pull_request_status":
          return deps.getPullRequestStatus(args as unknown as PullRequestStatusInput);
      }
    },
  };
}

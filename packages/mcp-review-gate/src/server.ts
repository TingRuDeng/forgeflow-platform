export interface SubmitFindingsInput {
  reviewId: string;
  findings: Array<{
    path: string;
    severity: string;
    summary: string;
  }>;
}

export interface MergeReadinessInput {
  repo: string;
  number: number;
}

export interface RenderMarkdownPrInput {
  title: string;
  summary: string[];
  checks: string[];
}

export interface ReviewGateServerDeps {
  submitFindings(input: SubmitFindingsInput): Promise<unknown> | unknown;
  checkMergeReadiness(input: MergeReadinessInput): Promise<unknown> | unknown;
  renderMarkdownPr(input: RenderMarkdownPrInput): Promise<unknown> | unknown;
}

export type ReviewGateToolName =
  | "submit_findings"
  | "check_merge_readiness"
  | "render_markdown_pr";

const TOOL_DEFINITIONS = [
  { name: "submit_findings", description: "Store structured review findings." },
  { name: "check_merge_readiness", description: "Check whether a pull request can merge." },
  { name: "render_markdown_pr", description: "Render PR summary markdown." },
] as const;

export function createReviewGateServer(deps: ReviewGateServerDeps) {
  return {
    listTools(): typeof TOOL_DEFINITIONS {
      return [...TOOL_DEFINITIONS];
    },
    async callTool(name: ReviewGateToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "submit_findings":
          return deps.submitFindings(args as unknown as SubmitFindingsInput);
        case "check_merge_readiness":
          return deps.checkMergeReadiness(args as unknown as MergeReadinessInput);
        case "render_markdown_pr":
          return deps.renderMarkdownPr(args as unknown as RenderMarkdownPrInput);
      }
    },
  };
}

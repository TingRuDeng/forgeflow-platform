import type {
  ReviewDecisionKind,
  ReviewDecisionPayload,
} from "./runtime-glue-types.js";

export interface DispatcherReviewClient {
  submitDecision(taskId: string, payload: ReviewDecisionPayload): Promise<unknown>;
}

export interface StateDirReviewClient {
  submitDecision(taskId: string, payload: ReviewDecisionPayload): unknown;
}

export interface SubmitReviewDecisionInput {
  client?: DispatcherReviewClient;
  dispatcherUrl?: string;
  stateDir?: string;
  taskId: string;
  actor?: string;
  decision: ReviewDecisionKind;
  notes?: string;
  at?: string;
  mergePullRequest?: boolean;
  repo?: string;
  pullRequestNumber?: number;
  githubToken?: string;
  fetchImpl?: typeof globalThis.fetch;
}

export interface ReviewDecisionResult {
  status: string;
  tasks: unknown[];
}

export interface CreateHttpReviewClientOptions {
  dispatcherUrl: string;
  fetchImpl?: typeof globalThis.fetch;
}

function createDispatcherReviewClient(
  dispatcherUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): DispatcherReviewClient {
  const baseUrl = dispatcherUrl.replace(/\/$/, "");

  async function call(pathname: string, body: unknown): Promise<unknown> {
    const url = `${baseUrl}${pathname}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(json.error || text || `review decision failed: ${response.status}`);
    }
    return json;
  }

  return {
    submitDecision(taskId: string, payload: ReviewDecisionPayload) {
      return call(
        `/api/reviews/${encodeURIComponent(taskId)}/decision`,
        payload,
      );
    },
  };
}

function createStateDirReviewClient(
  handleRequest: (input: {
    stateDir: string;
    method: string;
    pathname: string;
    body: unknown;
  }) => { json: unknown },
  stateDir: string,
): StateDirReviewClient {
  return {
    submitDecision(taskId: string, payload: ReviewDecisionPayload) {
      const result = handleRequest({
        stateDir,
        method: "POST",
        pathname: `/api/reviews/${encodeURIComponent(taskId)}/decision`,
        body: payload,
      });
      return result.json;
    },
  };
}

export function createHttpReviewClient(
  options: CreateHttpReviewClientOptions,
): DispatcherReviewClient {
  return createDispatcherReviewClient(options.dispatcherUrl, options.fetchImpl);
}

export function createStateDirReviewClientFactory(
  handleRequest: (input: {
    stateDir: string;
    method: string;
    pathname: string;
    body: unknown;
  }) => { json: unknown },
): (stateDir: string) => StateDirReviewClient {
  return (stateDir: string) => createStateDirReviewClient(handleRequest, stateDir);
}

export async function mergePullRequestGitHub({
  repo,
  pullRequestNumber,
  notes,
  token,
  fetchImpl = globalThis.fetch,
}: {
  repo: string;
  pullRequestNumber: number;
  notes?: string;
  token: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<unknown> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/pulls/${pullRequestNumber}/merge`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "forgeflow-review-decision",
      },
      body: JSON.stringify({
        merge_method: "squash",
        commit_title: notes || undefined,
      }),
    },
  );

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      json.message || text || `pull request merge failed: ${response.status}`,
    );
  }
  return json;
}
export async function submitReviewDecision(
  input: SubmitReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  const client =
    input.client ?? createDispatcherReviewClient(input.dispatcherUrl!);
  const result = (await client.submitDecision(input.taskId, {
    actor: input.actor,
    decision: input.decision,
    notes: input.notes,
    at: input.at,
  })) as ReviewDecisionResult;

  if (
    input.decision === "merge" &&
    input.mergePullRequest &&
    input.repo &&
    input.pullRequestNumber &&
    input.githubToken
  ) {
    await mergePullRequestGitHub({
      repo: input.repo,
      pullRequestNumber: input.pullRequestNumber,
      notes: input.notes,
      token: input.githubToken,
      fetchImpl: input.fetchImpl,
    });
  }

  return result;
}

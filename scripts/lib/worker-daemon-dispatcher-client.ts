import { handleDispatcherHttpRequest } from "./dispatcher-server.js";
import { importDispatcherRuntimeBridge } from "./runtime-bootstrap.js";
import type {
  DispatcherClient,
  PullRequestInfo,
  RunWorkerDaemonCycleSummary,
  WorkerResult,
} from "./worker-daemon-types.js";

interface DispatcherClientBridge {
  createDispatcherHttpClient: (options: { dispatcherUrl: string }) => DispatcherClient;
  createDispatcherStateDirClientFactory: (options: {
    handleRequest: (input: {
      stateDir: string;
      method: string;
      pathname: string;
      body?: unknown;
      internalCall?: boolean;
    }) => Promise<{ status: number; json: unknown }>;
  }) => (stateDir: string) => DispatcherClient;
  runWorkerDaemonCycle: (input: {
    client: DispatcherClient;
    workerId: string;
    pool: string;
    hostname?: string;
    labels?: string[];
    repoDir: string;
    dryRunExecution?: boolean;
    at?: string;
    taskExecutor: {
      executeTask: (task: unknown, assignment: unknown, assigned: unknown) => Promise<{
        result: WorkerResult;
        changedFiles: string[];
        pullRequest: PullRequestInfo | null;
        worktreeDir?: string;
        outputDir?: string;
      }>;
    };
  }) => Promise<RunWorkerDaemonCycleSummary>;
}

export async function bootstrapDispatcherBridge(): Promise<DispatcherClientBridge> {
  return importDispatcherRuntimeBridge<DispatcherClientBridge>();
}

export function createDispatcherClient(dispatcherUrl: string): DispatcherClient {
  let clientPromise: Promise<DispatcherClient> | null = null;
  return createLazyDispatcherClient(() => {
    clientPromise ??= bootstrapDispatcherBridge()
      .then((bridge) => bridge.createDispatcherHttpClient({ dispatcherUrl }));
    return clientPromise;
  });
}

export function createStateDirDispatcherClient(stateDir: string): DispatcherClient {
  let clientPromise: Promise<DispatcherClient> | null = null;
  return createLazyDispatcherClient(() => {
    clientPromise ??= bootstrapDispatcherBridge().then((bridge) => {
      const createClient = bridge.createDispatcherStateDirClientFactory({
        handleRequest: (input) => handleDispatcherHttpRequest({
          stateDir: input.stateDir,
          method: input.method,
          pathname: input.pathname,
          body: input.body,
          clientAddress: "127.0.0.1",
          internalCall: input.internalCall ?? true,
        }),
      });
      return createClient(stateDir);
    });
    return clientPromise;
  });
}

function createLazyDispatcherClient(resolveClient: () => Promise<DispatcherClient>): DispatcherClient {
  return {
    async registerWorker(worker) {
      return (await resolveClient()).registerWorker(worker);
    },
    async heartbeat(workerId, payload) {
      return (await resolveClient()).heartbeat(workerId, payload);
    },
    async getAssignedTask(workerId) {
      return (await resolveClient()).getAssignedTask(workerId);
    },
    async claimTask(workerId, payload = {}) {
      return (await resolveClient()).claimTask(workerId, payload);
    },
    async startTask(workerId, payload) {
      return (await resolveClient()).startTask(workerId, payload);
    },
    async submitResult(workerId, payload) {
      return (await resolveClient()).submitResult(workerId, payload);
    },
    async reportEvent(workerId, payload) {
      return (await resolveClient()).reportEvent?.(workerId, payload);
    },
  };
}

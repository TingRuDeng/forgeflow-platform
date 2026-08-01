export type DispatcherAuthEnvironment = Readonly<Record<string, string | undefined>>;

export function normalizeOptionalDispatcherToken(
  value: unknown,
  source: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${source} must be a non-empty string without surrounding whitespace`);
  }
  return value;
}

export function resolveDispatcherAuthToken(
  environment: DispatcherAuthEnvironment = process.env,
): string | undefined {
  const workerToken = normalizeOptionalDispatcherToken(
    environment.DISPATCHER_WORKER_TOKEN,
    "DISPATCHER_WORKER_TOKEN",
  );
  const controlToken = normalizeOptionalDispatcherToken(
    environment.DISPATCHER_API_TOKEN,
    "DISPATCHER_API_TOKEN",
  );
  return workerToken ?? controlToken;
}

export function getDispatcherAuthHeader(
  environment: DispatcherAuthEnvironment = process.env,
): Record<string, string> {
  const token = resolveDispatcherAuthToken(environment);
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

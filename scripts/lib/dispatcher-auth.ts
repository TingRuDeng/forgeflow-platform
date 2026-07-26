export function getDispatcherAuthHeader(): Record<string, string> {
  const token = process.env.DISPATCHER_WORKER_TOKEN || process.env.DISPATCHER_API_TOKEN;
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export function isDispatcherAuthEnabled(): boolean {
  return !!process.env.DISPATCHER_API_TOKEN;
}

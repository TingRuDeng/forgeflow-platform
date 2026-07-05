export async function parseJsonResponse(res: Response) {
  const text = await res.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function extractResponseError(body: unknown, fallback: string) {
  if (body && typeof body === 'object') {
    const record = body as { message?: unknown; error?: unknown };
    return String(record.message || record.error || fallback);
  }
  return fallback;
}

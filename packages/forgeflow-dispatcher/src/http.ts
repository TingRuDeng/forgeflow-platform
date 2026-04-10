export async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json",
    },
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

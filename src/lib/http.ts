// Backend HTTP client. Every backend exposes POST /run with a JSON body.
// /health returns 200 when the model is loaded and serving.

export async function postRun<T = unknown>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${url}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url}/run returned ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function getHealth(url: string, timeoutMs = 2000): Promise<{ ok: boolean; status?: number; latency_ms: number; error?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

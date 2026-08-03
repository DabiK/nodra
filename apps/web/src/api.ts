export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Données dynamiques (missions, runs, pipelines) : ne jamais servir un 304
    // du cache HTTP — fetch le reçoit alors comme `ok: false` avec un body vide,
    // ce qui ferait échouer silencieusement tous les rafraîchissements live (SSE).
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

import { normalizeEndpoint } from "./config.mjs";

export function createJsonPoster({ endpoint, token }) {
  const baseUrl = normalizeEndpoint(endpoint);

  return async function post(path, body, timeoutMs, authenticated = true) {
    if (authenticated && !token) throw new Error("missing_token");
    const headers = { "content-type": "application/json" };
    if (authenticated) headers.authorization = `Bearer ${token}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  };
}

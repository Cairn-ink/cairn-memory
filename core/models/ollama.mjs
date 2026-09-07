import { fail } from "../validation.mjs";

/** Explicit Ollama destination. No auto-discovery, redirects, pulls or fallback. */
export function createOllamaModel({ endpoint = "http://127.0.0.1:11434", model,
  allowRemote = false, apiKey, maxOutputTokens = 1024 }) {
  let url;
  if (typeof allowRemote !== "boolean") fail("invalid_model_endpoint");
  try { url = new URL(endpoint); } catch { fail("invalid_model_endpoint"); }
  const local = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (!["http:", "https:"].includes(url.protocol)) ||
      (!local && (!allowRemote || url.protocol !== "https:"))) fail("invalid_model_endpoint");
  if (typeof model !== "string" || !model.trim() || model.length > 200 ||
      /[\s\x00-\x1f]/.test(model) || /(?:^|[:/-])cloud(?:$|[:/-])/i.test(model)) fail("invalid_model_name");
  if (apiKey !== undefined && (typeof apiKey !== "string" || !apiKey || /[\r\n]/.test(apiKey))) fail("invalid_model_key");
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 32 || maxOutputTokens > 4096) fail("invalid_model_budget");
  return Object.freeze({
    async generate({ system, prompt, schema, signal }) {
      let response;
      try {
        response = await fetch(new URL("/api/chat", url), {
          method: "POST", signal, redirect: "error",
          headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model, stream: false, format: schema,
            messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
            options: { temperature: 0, num_predict: maxOutputTokens, num_ctx: 8192 } }),
        });
        if (!response.ok || !response.body) throw new Error();
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 262_144) throw new Error();
          chunks.push(chunk);
        }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (result.done !== true || typeof result.message?.content !== "string") throw new Error();
        return JSON.parse(result.message.content);
      } catch {
        // Do not expose provider bodies, request text, credentials or URLs in errors.
        fail(signal?.aborted ? "model_cancelled" : "model_request_failed");
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    },
  });
}

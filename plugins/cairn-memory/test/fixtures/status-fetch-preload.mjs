// Preloaded only by status-credential.test.mjs's synthetic hook subprocesses.
import { appendFile } from "node:fs/promises";

globalThis.fetch = async (url, options) => {
  const token = process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN;
  await appendFile(process.env.CAIRN_STATUS_FIXTURE_REQUESTS, JSON.stringify({
    path: new URL(url).pathname,
    authenticated: Boolean(options.headers.authorization),
    tokenMatches: Boolean(token) && options.headers.authorization === `Bearer ${token}`,
    body: JSON.parse(options.body),
  }) + "\n", { mode: 0o600 });
  options.signal?.throwIfAborted();
  if (process.env.CAIRN_STATUS_FIXTURE_OUTAGE === "true") throw new Error(token);
  if (new URL(url).pathname === "/api/memory/telemetry") return new Response(null, { status: 204 });
  const reply = JSON.parse(process.env.CAIRN_STATUS_FIXTURE_REPLY);
  return Response.json(reply.body, { status: reply.status });
};

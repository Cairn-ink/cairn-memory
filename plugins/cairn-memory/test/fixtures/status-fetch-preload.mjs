// Preloaded only by status-credential.test.mjs's synthetic hook subprocesses.
import { appendFile, open } from "node:fs/promises";

// Keep event time distinct from durable publication time without a wall wait.
if (process.env.CAIRN_STATUS_FIXTURE_SYNC_CLOCK === "true") {
  const NativeDate = Date;
  let now = NativeDate.now();
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const probe = await open(new URL(import.meta.url), "r");
  const prototype = Object.getPrototypeOf(probe), sync = prototype.sync;
  await probe.close();
  prototype.sync = async function () {
    const result = await sync.call(this); now += 1000; return result;
  };
}

globalThis.fetch = async (url, options) => {
  // Pause observations are separate from the authenticated content requests
  // whose credential outcomes this fixture records.
  if (new URL(url).pathname === "/api/memory/pause-state") {
    options.signal?.throwIfAborted();
    return Response.json({ paused: false, generation: 0, enforced: true });
  }
  const token = process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN;
  await appendFile(process.env.CAIRN_STATUS_FIXTURE_REQUESTS, JSON.stringify({
    path: new URL(url).pathname,
    ...(process.env.CAIRN_STATUS_FIXTURE_SYNC_CLOCK === "true" ? { at: new Date().toISOString() } : {}),
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

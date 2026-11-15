// Functional backpressure test: real pipe writes, abort and hard-exit timers.
// Synthetic admission time avoids qualifying near-deadline filesystem latency
// on a shared host. Output-budget signal expiry alone is isolated here.
import { writeFileSync } from 'node:fs';
const mark = (kind, details = {}) => process.send?.({ kind,
  at: Number(process.hrtime.bigint()) / 1e6, ...details });
mark('origin', { at: Number(process.hrtime.bigint()) / 1e6 - performance.now() });
const rawTimeout = AbortSignal.timeout;
AbortSignal.timeout = function (milliseconds) {
  const outputBudget = (new Error().stack?.split('\n')[2] ?? '').includes('/scripts/hook.mjs:');
  return rawTimeout.call(this, outputBudget ? 10000 : milliseconds);
};
const rawSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (callback, milliseconds, ...args) {
  return rawSetTimeout(function (...values) {
    if (callback.name === 'expireRecall') mark('abort-cap');
    return callback(...values);
  }, milliseconds, ...args);
};
const nativeWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (bytes, callback) {
  mark('write-start', { admissionMs: performance.now(), bytes: Buffer.byteLength(bytes) });
  const accepted = nativeWrite(bytes, error => { mark('write-complete', { error: Boolean(error) }); callback(error); });
  mark('write-queued', { queued: process.stdout.writableLength, needDrain: process.stdout.writableNeedDrain });
  return accepted;
};
const memory = { id: '12345678-1234-4234-8234-123456789abc', content: 'S'.repeat(1024 * 1024) + ' synthetic-tail',
  kind: 'fact', scope: 'personal', projectId: null, origin: 'explicit', confidence: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', receipts: [{ client: 'claude-code',
    sessionId: 'synthetic-source', eventId: 'synthetic-event', role: 'user', excerpt: 'Synthetic source.',
    createdAt: '2026-10-01T00:00:00Z' }] };
globalThis.fetch = async (url, options) => {
  options.signal?.throwIfAborted();
  if (url.endsWith('/pause-state')) return Response.json({ paused: false, generation: 0, enforced: true });
  if (!url.endsWith('/recall')) throw new Error('unexpected_synthetic_route');
  mark('fetch');
  const response = Response.json({ memories: [memory] });
  Object.defineProperty(performance, 'now', { value: () => 3449 });
  return response;
};
process.on('exit', code => writeFileSync(process.env.CAIRN_TEST_EXIT_RECORD,
  JSON.stringify({ code, at: Number(process.hrtime.bigint()) / 1e6 }), { mode: 0o600 }));
process.channel?.unref();

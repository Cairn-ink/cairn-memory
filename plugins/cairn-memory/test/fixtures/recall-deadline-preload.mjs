// Synthetic HTTP only. No native fetch/network fallback.
import { setTimeout as delay } from 'node:timers/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const notify = (kind, details = {}) => process.send?.({ kind, ...details });
// Observe entry at creation of the hook's timer, without moving or replacing it.
// hrtime has a common monotonic origin across parent/child processes; IPC receipt
// latency is therefore excluded from application-entry-to-close measurement.
const originalTimeout = globalThis.setTimeout;
let entryObserved = false;
globalThis.setTimeout = function (callback, milliseconds, ...args) {
  if (!entryObserved && milliseconds === 2500 && callback.name === 'expireRecall') {
    entryObserved = true;
    notify('application-entry', { monotonicMs: Number(process.hrtime.bigint()) / 1e6 });
  }
  return originalTimeout(callback, milliseconds, ...args);
};
const originalLink = fsPromises.link;
let contentionObserved = false;
fsPromises.link = async function (source, target) {
  try { return await originalLink(source, target); }
  catch (error) {
    if (!contentionObserved && error.code === 'EEXIST' &&
        String(target).startsWith(`${process.env.CLAUDE_PLUGIN_DATA}/hosted-quota/`) &&
        String(target).endsWith('.json.lock')) {
      contentionObserved = true;
      notify('quota-lock-contended');
    }
    throw error;
  }
};
syncBuiltinESMExports();
const abortSource = signal => signal.reason?.message === 'recall_timeout' ? 'application'
  : signal.reason?.name === 'TimeoutError' ? 'http' : 'other';
// Register the rendezvous before announcing fetch so an early parent ack cannot
// be lost. Keep IPC live only while waiting, and remove listeners on abort too.
function fetchAcknowledgement(signal, attempt) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = error => {
      process.off('message', message); process.off('disconnect', disconnect);
      signal.removeEventListener('abort', abort); process.channel?.unref();
      error ? reject(error) : resolve();
    };
    const message = event => {
      if (event.kind === 'recall-fetch-ack' && event.attempt === attempt) {
        notify('recall-fetch-acknowledged', { attempt }); finish();
      }
    };
    const abort = () => finish(signal.reason);
    const disconnect = () => finish(new Error('synthetic_parent_disconnected'));
    process.on('message', message); process.once('disconnect', disconnect);
    signal.addEventListener('abort', abort, { once: true }); process.channel?.ref();
  });
}
let attempt = 0, firstSignal, firstLegacyPayload;
const memory = { id: '12345678-1234-4234-8234-123456789abc', content: 'Synthetic remembered preference.',
  kind: 'fact', scope: 'personal', projectId: null, origin: 'explicit', confidence: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', receipts: [{ client: 'claude-code',
    sessionId: 'synthetic-source', eventId: 'synthetic-event', role: 'user', excerpt: 'Synthetic source.',
    createdAt: '2026-10-01T00:00:00Z' }] };
globalThis.fetch = async (url, options) => {
  if (url === 'https://synthetic.invalid/api/memory/recall') {
    const number = ++attempt;
    firstSignal ??= options.signal;
    const body = JSON.parse(options.body);
    const { session_id, ...legacy } = body;
    firstLegacyPayload ??= JSON.stringify(legacy);
    const acknowledgement = process.env.CAIRN_TEST_RECALL_ACK === 'true'
      ? fetchAcknowledgement(options.signal, number) : undefined;
    notify('recall-fetch', { attempt: number, sameSignal: options.signal === firstSignal,
      hasSession: Object.hasOwn(body, 'session_id'), sameLegacyPayload: JSON.stringify(legacy) === firstLegacyPayload });
    const mode = process.env.CAIRN_TEST_RECALL_REPLY;
    const milliseconds = mode === 'old-schema' ? number === 1 ? 1300 : 900 : Number(process.env.CAIRN_TEST_RECALL_DELAY);
    try {
      await acknowledgement;
      await delay(milliseconds, undefined, { signal: options.signal });
    }
    catch (error) { notify('recall-aborted', { attempt: number, source: abortSource(options.signal) }); throw error; }
    notify('recall-response', { attempt: number });
    if (mode === 'old-schema' && number === 1 || mode === 'other-400') return Response.json({ error: 'Invalid recall payload.',
      issues: [{ code: 'unrecognized_keys', keys: [mode === 'old-schema' ? 'session_id' : 'other'], path: [] }] }, { status: 400 });
    if (mode === 'empty') return Response.json({ memories: [] });
    if (mode === 'invalid') return Response.json({ memories: [memory], extra: true });
    if (mode === 'unauthorized') return Response.json({ error: 'Synthetic refusal' }, { status: 401 });
    if (mode === 'quota') return Response.json({ error: 'quota_reached' }, { status: 429 });
    return Response.json({ memories: [memory] });
  }
  if (url === 'https://synthetic.invalid/api/memory/telemetry') {
    notify('telemetry-fetch');
    await delay(5000, undefined, { signal: options.signal });
    return new Response(null, { status: 204 });
  }
  throw new Error('unexpected_synthetic_route');
};
notify('preload-ready');
process.channel?.unref();

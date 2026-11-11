// Synthetic, model-free contention sizing. Run through tools/testing/run.mjs
// --script. The optional eight-attempt probe only changes a loader-local copy;
// production retains its bounded retry and the worker's deferred busy retry.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from './workspace.mjs';

const probe = process.argv.includes('--probe-eight');
let attemptLimit;
const hook = registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/core/raw-journal.mjs')) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
  const marker = source.match(/const RAW_EPOCH_ATTEMPTS = (\d+);/);
  assert.ok(marker);
  attemptLimit = probe ? 8 : Number(marker[1]);
  return { ...result, source: probe ? source.replace(marker[0], 'const RAW_EPOCH_ATTEMPTS = 8;') : source };
} });
const { openMemoryStore } = await import('../../core/index.mjs');
const { openRawCaptureCore } = await import('../../core/raw-capture.mjs');
const { localPlainPort, splitRaw, rawRequest, rawNamespace: namespace } = await import('../../core/testing/raw-fixtures.mjs');
hook.deregister();
const workspace = createTestWorkspace(null, { prefix: 'raw-epoch-sizing-' });
const results = [];
try {
  for (const writesPerSecond of [2, 10, 25]) {
    const path = join(workspace.path, `rate-${writesPerSecond}.sqlite`), attempts = new Map();
    const port = localPlainPort(), seal = port.sealRaw;
    port.sealRaw = async value => {
      attempts.set(value.text, (attempts.get(value.text) ?? 0) + 1);
      await delay(12); // A small asynchronous sealing window, no provider.
      return seal(value);
    };
    const cores = Array.from({ length: 4 }, () => openRawCaptureCore({ path }, {
      mode: 'raw-v1', interpretation: 'host', port, readPolicy: () => ({ generation: 'synthetic', reason: null }),
    }));
    const store = openMemoryStore({ path }), memory = store.scope({ ownerId: namespace.ownerId });
    const db = new DatabaseSync(path);
    let running = true, writes = 0, seed = 0xdecafbad;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    const started = performance.now(), captures = [], busy = [];
    const writer = (async () => {
      while (running) {
        await delay(1000 / writesPerSecond);
        if (!running) break;
        const id = 'write-' + ++writes;
        memory.remember({ content: 'Synthetic unrelated Memory ' + id, kind: 'fact', receipt: {
          client: 'synthetic', sessionId: 'memory-writer', eventId: id, role: 'user', excerpt: 'Synthetic evidence',
        } });
      }
    })();
    try {
      await Promise.all(cores.map(async (core, session) => {
        await delay(session * 53);
        for (let i = 0; i < 30; i++) {
          await delay(180 + random() * 100);
          const text = `Synthetic capture session ${session} batch ${i}`;
          const input = rawRequest(splitRaw(text, { id: 'message-' + i, ordinal: i + 1 })[0], {
            sessionId: 'session-' + session, eventId: `capture-${session}-${i}`,
          });
          const at = performance.now(), result = await core.captureRaw(input);
          const n = attempts.get(text);
          assert.ok(n >= 1 && n <= attemptLimit);
          if (!result.ok) { assert.deepEqual(result.error, { code: 'storage_busy', retryable: true }); busy.push([core, input]); }
          else assert.equal(result.value.raw.parts[0].saved, true);
          captures.push({ attempts: n, busy: !result.ok, elapsedMs: performance.now() - at });
        }
      }));
    } finally { running = false; await writer; }
    const elapsedMs = performance.now() - started;
    const histogram = Object.fromEntries(Array.from({ length: attemptLimit }, (_, i) => [i + 1, captures.filter(c => c.attempts === i + 1).length]));
    // No in-call attempt stores a duplicate. Deferred calls use the same event.
    const saved = captures.length - busy.length;
    for (const table of ['raw_events', 'raw_parts', 'raw_capture_events']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, saved);
    // Busy captures may have been followed by a later ordinal in this synthetic
    // session. Leave them deferred; do not invent an out-of-order replay.
    const latencies = captures.map(c => c.elapsedMs).sort((a, b) => a - b);
    results.push({ attemptLimit, sessions: 4, captures: captures.length,
      requestedMemoryWritesPerSecond: writesPerSecond, memoryWrites: writes, elapsedMs,
      actualMemoryWritesPerSecond: writes * 1000 / elapsedMs, actualCapturesPerSecond: captures.length * 1000 / elapsedMs,
      sealDelayMs: 12, attempts: histogram, storageBusy: busy.length, saved,
      p95CaptureMs: latencies[Math.ceil(latencies.length * .95) - 1],
      capturesNeedingMoreThanThree: captures.filter(c => c.attempts > 3).length,
      capturesNeedingMoreThanFour: probe ? captures.filter(c => c.attempts > 4).length : null,
    });
    db.close(); store.close(); for (const core of cores) await core.close();
  }
  console.log(JSON.stringify({ probe, results }, null, 2));
} finally { await workspace.cleanup(); }

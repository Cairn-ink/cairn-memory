// Offline coverage-at-size harness. Run explicitly in a supervised heavy slot.
// Uses APIs present on d4bfba57; no schedule override, test clock or manual refresh.
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { openSync, writeSync, closeSync } from 'node:fs';
import { PassThrough, Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../tools/testing/workspace.mjs';
import { openMemoryCore } from '../core/contract.mjs';
import { createFakeEmbedder } from '../core/context-read-embedder.mjs';
import { cardHost } from '../core/testing/raw-source-fixtures.mjs';
import { createCairnServer } from '../adapters/mcp/server.mjs';

const namespace = { ownerId: 'synthetic-context-coverage', scope: 'personal', projectId: null };
const sets = { combined: ['memory', 'card'], memory: ['memory'], card: ['card'] };
const counter = { id: 'synthetic-coverage-counter', countTokens: text => Math.ceil(text.length / 4) };
const ok = result => { if (!result?.ok) throw Error('synthetic_seed_failed'); return result.value; };
const count = value => Number.isFinite(value) && value >= 0 ? value : null;
const elapsed = start => Math.round(performance.now() - start);

function configuration() {
  const { values } = parseArgs({ options: Object.fromEntries(
    ['docs', 'cards', 'scenario', 'embed-latency-ms', 'poll-ms', 'limit-min', 'out'].map(name => [name, { type: 'string' }])) });
  const integer = (name, fallback, minimum = 0) => {
    const raw = values[name] ?? String(fallback), n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < minimum) throw Error('invalid_option');
    return n;
  };
  const scenario = values.scenario ?? 'combined', limitMin = Number(values['limit-min'] ?? 45);
  if (!['combined', 'memory', 'mixed'].includes(scenario) || !Number.isFinite(limitMin) || limitMin <= 0 ||
      !Number.isSafeInteger(Math.ceil(limitMin * 60000)) || limitMin * 60000 > 2147483647) throw Error('invalid_option');
  const embedLatencyMs = integer('embed-latency-ms', 300), pollMs = integer('poll-ms', 15000, 1);
  if (embedLatencyMs > 2147483647 || pollMs > 2147483647) throw Error('invalid_option');
  return { docs: integer('docs', 2600), cards: integer('cards', 300), scenario, embedLatencyMs, pollMs,
    limitMs: Math.ceil(limitMin * 60000), out: values.out };
}

function pipes() {
  const a = new PassThrough(), b = new PassThrough();
  const server = Duplex.from({ readable: a, writable: b }), client = Duplex.from({ readable: b, writable: a });
  // SDKs own protocol failures. Keep cleanup errors on these synthetic streams
  // from becoming unhandled after the SDK has removed its listeners.
  for (const stream of [server, client]) stream.on('error', () => {});
  return [server, client];
}

async function main() {
  const options = configuration();
  const wanted = options.scenario === 'mixed' ? ['combined', 'memory', 'card'] : [options.scenario];
  const firstReadyMs = Object.fromEntries(wanted.map(view => [view, null]));
  const stop = new AbortController();
  let signalCode = 0;
  const interrupt = () => { signalCode = 130; stop.abort(); }, terminate = () => { signalCode = 143; stop.abort(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  let workspace, seeder, server, client, streams, output, timer, start, seedMs = 0, polls = 0;
  let embedCalls = 0, embedItems = 0, seededDocs = 0, seededCards = 0, allReady = false, failed = false, elapsedMs = 0;
  const emit = value => {
    const line = JSON.stringify(value) + '\n'; process.stdout.write(line);
    if (output !== undefined) writeSync(output, line);
  };
  try {
    if (options.out !== undefined) output = openSync(options.out, 'wx', 0o600);
    workspace = createTestWorkspace(null, { prefix: 'measure-context-coverage-' });
    const path = join(workspace.path, 'synthetic.sqlite'), authority = cardHost(), seedStart = performance.now();
    const model = { contextWindow: 8192, countTokens: counter.countTokens,
      extract: () => ({ items: [] }), classify: () => ({ items: [] }) };
    seeder = openMemoryCore({ path, raw: true, rawSearch: false, privateCards: authority.options, model });
    for (let i = 0; i < options.docs; i++) {
      stop.signal.throwIfAborted();
      ok(await seeder.admit({ namespace, memory: { content: 'Synthetic coverage document ' + i, kind: 'fact' },
        receipts: [{ client: 'synthetic', sessionId: 'coverage', eventId: 'document-' + i, role: 'user',
          excerpt: 'Synthetic coverage receipt ' + i }] })); seededDocs++;
    }
    for (let i = 0; i < options.cards; i++) {
      stop.signal.throwIfAborted();
      const card = ok(await authority.call(seeder, 'createCardDraft', { namespace, actionId: 'draft-' + i, drafting: 'authored',
        input: { title: 'Synthetic coverage card ' + i, body: 'Synthetic coverage card body ' + i,
          authoredInput: { text: 'Synthetic coverage card source ' + i, occurredAt: null } } }));
      ok(await authority.call(seeder, 'confirmCardDraft', { namespace, actionId: 'confirm-' + i, cardId: card.id,
        expectedRevision: card.revision, applicability: 'current' })); seededCards++;
    }
    await seeder.close(); seeder = null; seedMs = elapsed(seedStart);

    // Resolve from the adapter's existing install, including in worktrees with
    // no root node_modules. SDK 2.3.1 ships paired CJS/MJS export targets.
    const require = createRequire(new URL('../adapters/mcp/package.json', import.meta.url));
    const sdk = name => import(pathToFileURL(require.resolve(name).replace(/\.cjs$/, '.mjs')).href);
    const [{ Client }, { StdioServerTransport }] = await Promise.all([
      sdk('@modelcontextprotocol/client'), sdk('@modelcontextprotocol/server/stdio'),
    ]);
    const fake = createFakeEmbedder();
    const embedder = { ...fake, async embed(texts, controls = {}) {
      embedCalls++;
      const signal = AbortSignal.any([stop.signal, controls.signal].filter(Boolean));
      await delay(options.embedLatencyMs, undefined, { signal });
      controls.beforeDispatch?.();
      const vectors = await fake.embed(texts, { ...controls, signal });
      embedItems += vectors.length; return vectors;
    } };
    start = performance.now();
    timer = setTimeout(() => stop.abort(), options.limitMs);
    server = createCairnServer({ path, namespace, raw: true, rawSearch: false, contextRead: 'context-read-v1',
      contextSemantic: true, contextCounter: counter,
      contextEmbedding: { embedder, policy: { family: 'local', maxRequests: 1000000, maxUsd: 1000, estimateUsd: () => 0 } } });
    streams = pipes(); client = new Client({ name: 'synthetic-context-coverage', version: '1' });
    await server.connect(new StdioServerTransport(streams[0], streams[0]));
    await client.connect(new StdioServerTransport(streams[1], streams[1]));
    let nextPollAt = start;
    while (!stop.signal.aborted) {
      const progress = {};
      for (const view of wanted) {
        const remaining = options.limitMs - elapsed(start);
        if (remaining < 1 || stop.signal.aborted) break;
        const response = await client.callTool({ name: 'read_memory_context', arguments: {
          query: 'synthetic coverage', types: sets[view], intent: 'current', semantic: true,
          maxTokens: 512, maxItems: 4, deadlineMs: Math.max(1, Math.min(5000, remaining)),
        } }, { signal: stop.signal, timeout: Math.max(1, Math.min(10000, remaining)) });
        const candidates = response._meta?.['ink.cairn/context-read-diagnostics']?.candidates;
        const ready = !response.isError && candidates?.channels?.semantic?.state === 'ready';
        if (ready && firstReadyMs[view] === null) firstReadyMs[view] = elapsed(start);
        const byType = Object.fromEntries(sets[view].map(type => {
          const counts = candidates?.coverage?.byType?.[type];
          return [type, { eligible: count(counts?.eligible), embedded: count(counts?.embedded) }];
        }));
        const total = key => Object.values(byType).some(row => row[key] === null) ? null
          : Object.values(byType).reduce((sum, row) => sum + row[key], 0);
        progress[view] = { ready, eligible: total('eligible'), embedded: total('embedded'), byType };
      }
      polls++;
      emit({ kind: 'poll', poll: polls, elapsedMs: elapsed(start), scenario: options.scenario,
        docs: seededDocs, cards: seededCards, seedMs, views: progress, embedCalls, embedItems });
      allReady = wanted.every(view => firstReadyMs[view] !== null);
      if (allReady || stop.signal.aborted) break;
      nextPollAt += options.pollMs;
      const waitMs = Math.min(Math.max(0, nextPollAt - performance.now()), Math.max(0, options.limitMs - elapsed(start)));
      await delay(waitMs, undefined, { signal: stop.signal });
    }
  } catch {
    if (!stop.signal.aborted) { failed = true; process.stderr.write('context coverage measurement failed\n'); }
  } finally {
    elapsedMs = start === undefined ? 0 : elapsed(start);
    clearTimeout(timer); stop.abort();
    for (const close of [() => client?.close(), () => server?.close(), () => seeder?.close()]) {
      try { await close(); } catch { failed = true; }
    }
    for (const stream of streams ?? []) stream.destroy();
    try { await workspace?.cleanup(); } catch { failed = true; }
    emit({ kind: 'summary', scenario: options.scenario, docs: seededDocs, cards: seededCards, seedMs, elapsedMs,
      pollMs: options.pollMs, limitMs: options.limitMs, embedLatencyMs: options.embedLatencyMs,
      polls, firstReadyMs, allReady, limitReached: !allReady && !failed && signalCode === 0,
      failed, interrupted: signalCode !== 0, embedCalls, embedItems });
    if (output !== undefined) closeSync(output);
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    process.exitCode = signalCode || (failed ? 1 : 0);
  }
}

await main().catch(() => { process.stderr.write('invalid context coverage configuration or output\n'); process.exitCode = 1; });

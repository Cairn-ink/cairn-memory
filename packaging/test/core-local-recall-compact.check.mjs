import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMemoryService } from '../../packages/core/src/service/index.mjs';
import { confirmInstalledUpgrade, legacyKeyedFixture, setupInstalledConsent, withInstalledMcp,
  withUpgradeInstallers } from '../../tools/testing/local-cutover-keyed-fixture.mjs';
import { localClock } from '../core-local/local-provider.mjs';
import { callTool } from '../core-local/wire-tools.mjs';

const syntheticKey = 'synthetic-recall-provider';
const retained = 'Albatross albatross albatross hides a teal lantern.';
const earlier = 'Albatross albatross carries a brass compass.';
const weaker = ['oak desk', 'blue ribbon', 'glass cup', 'iron bell', 'paper map', 'wooden box', 'silver spoon',
  'stone bowl', 'cotton scarf', 'copper whistle'];
const semanticOnly = ['otter', 'fox', 'owl', 'ibis', 'salmon', 'eagle', 'crane', 'duck', 'tern', 'heron', 'puffin'];
const removed = 'The synthetic albatross keeps a violet telescope.';
const query = 'albatross';

function instrumentFetch(f) {
  const log = join(f.parent, 'fetch.jsonl');
  const preload = join(f.parent, 'fetch.mjs');
  writeFileSync(log, '', { mode: 0o600 });
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

// Give the explicit save receipts distinct event dates in the synthetic corpus.
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/packaging/core-local/wire-tools.mjs')) return result;
  const source = result.source.toString();
  const anchor = 'eventId: randomUUID(), occurredAtMs: null';
  assert.ok(source.includes(anchor));
  return { ...result, source: 'let receiptDay = 0;\\n' +
    source.replace(anchor, 'eventId: randomUUID(), occurredAtMs: Date.UTC(2025, 0, ++receiptDay)') };
} });

// Instrument the worker as well as direct serving without changing either launch identity.
const filename = fileURLToPath(import.meta.url);
const flag = process.execArgv.indexOf(filename);
if (flag > 0 && process.execArgv[flag - 1] === '--import') process.execArgv.splice(flag - 1, 2);
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => spawn(command,
  args[0]?.endsWith('/daemon-worker.mjs') ? ['--import', filename, ...args] : args, options);
syncBuiltinESMExports();

globalThis.fetch = async (url, options) => {
  const endpoint = new URL(url).pathname;
  const body = JSON.parse(options.body);
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ endpoint, input: body.input }) + '\\n');
  assert.equal(endpoint, '/v1/embeddings');
  assert.equal(options.headers.Authorization, 'Bearer ' + ${JSON.stringify(syntheticKey)});
  const data = body.input.map((text, index) => {
    // The best match is first lexically and 13th semantically. The old 12-deep
    // fusion sees both channels for the compass, but only one for the lantern.
    const coordinates = text.includes('teal lantern') ? [0, 1] : text.includes('brass compass') ? [0.6, 0.8]
      : text === ${JSON.stringify(query)} || text.startsWith('semantic decoy ') ? [1, 0] : [-1, 0];
    return { index, embedding: [...coordinates, ...Array(body.dimensions - 2).fill(0)] };
  });
  return Response.json({ object: 'list', model: body.model, data });
};
`, { mode: 0o600 });
  return { preload, requests: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}

function value(reply) {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}

test('consented keyed recall packs compact memories and restores rank order', { timeout: 120_000,
  skip: process.platform !== 'linux' }, async t => {
  await withUpgradeInstallers(async installers => {
    const { f, source, legacy } = await legacyKeyedFixture(installers, 'compact-recall', { seed: false });
    await setupInstalledConsent(installers, f, syntheticKey);
    confirmInstalledUpgrade(installers, f, source, legacy);
    const { preload, requests } = instrumentFetch(f);
    const queries = [];

    try {
      await withInstalledMcp(f, async tool => {
        const save = async content => {
          const saved = value(await tool('remember_memory', { content }));
          assert.equal(saved.deduplicated, false);
          return saved.memory;
        };
        const olderWeaker = await save(earlier);
        const best = await save(retained);
        for (const object of weaker) await save('The albatross keeps a ' + object + '.');
        for (const animal of semanticOnly) await save('Semantic decoy ' + animal + ' swims upstream.');
        const forgotten = await save(removed);
        const recallStart = requests().length;

        const recall = async (args = {}) => {
          const request = { query, ...args };
          queries.push(request.query);
          return value(await tool('recall_memory', request));
        };

        await t.test('explicit and default limits preserve compact rank over receipt date', async () => {
          const limited = await recall({ limit: 3 });
          assert.equal(limited.memories.length, 3);
          assert.equal(limited.memories[0].memory.content, retained, 'compact fusion puts the lantern first');
          const previous = limited.memories.find(({ memory }) => memory.id === olderWeaker.id);
          assert.ok(previous, 'the earlier receipt would come first in date order');
          const newest = limited.memories.find(({ memory }) => memory.id !== best.id && memory.id !== olderWeaker.id);
          assert.ok(newest.memory.createdAt > limited.memories[0].memory.createdAt);
          assert.equal(limited.coverage, 'budget_exhausted');
          assert.deepEqual(limited.namespaces, [{ namespace: limited.memories[0].memory.namespace,
            mapExhausted: false, fetchExhausted: true }]);

          const defaults = await recall();
          assert.equal(defaults.memories.length, 24);
          assert.deepEqual(defaults.memories.slice(0, 3), limited.memories);
        });

        await t.test('both evidence modes retain sources and exclude a forgotten memory', async () => {
          const before = await recall({ query: 'violet telescope' });
          assert.ok(before.memories.some(({ memory }) => memory.id === forgotten.id));
          assert.equal(value(await tool('forget_memory', { memoryId: forgotten.id,
            expectedRevision: forgotten.revision })).forgotten, true);

          const plain = await recall();
          const top = plain.memories[0];
          assert.equal(top.receipts[0].excerpt, retained);
          assert.equal(top.receiptCount, 1);
          for (const contextMode of ['source-evidence', 'rationale-evidence']) {
            const evidence = await recall({ contextMode, selectionMode: 'bounded-source-scan', limit: 3 });
            const item = evidence.memories[0];
            assert.deepEqual(item.memory, { id: best.id, revision: best.revision, currentness: 'current' });
            assert.deepEqual(item.receipts, [{ id: top.receipts[0].id, role: 'user', excerpt: retained }]);
            assert.equal(item.receiptCount, 1);
            assert.equal(item.interpretationStatus, 'omitted');
            assert.equal(item.sourceSelectionCoverage, 'unassessed');
            assert.deepEqual(evidence.selection, { mode: 'bounded-source-scan',
              strategy: 'hybrid', semanticCoverage: 'unassessed' });
            if (contextMode === 'rationale-evidence') {
              assert.equal(item.rationale.status, 'unassessed');
              assert.deepEqual(item.rationale.sources[0].receipts, item.receipts);
              assert.deepEqual(item.rationale.edges, []);
            }
            assert.ok(evidence.memories.every(({ memory }) => memory.id !== forgotten.id));
          }
          const after = await recall({ query: 'violet telescope' });
          assert.ok(!JSON.stringify(after).includes(forgotten.id));
          assert.ok(!JSON.stringify(after).includes(removed));
        });

        const observed = requests();
        const count = endpoint => observed.filter(request => request.endpoint === endpoint).length;
        assert.equal(count('/v1/responses'), 0);
        assert.equal(count('/v1/responses/input_tokens'), 0);
        assert.equal(count('/v1/embeddings'), observed.length);
        const recallRequests = observed.slice(recallStart);
        assert.deepEqual(recallRequests, queries.map(query => ({ endpoint: '/v1/embeddings', input: [query] })));
        t.diagnostic(JSON.stringify({ recallEmbeddings: recallRequests.length, responses: 0, inputTokens: 0 }));
      }, { key: syntheticKey, preload });
    } finally {
      f.run(installers.candidate, ['daemon', 'stop', '--local']);
    }
  });
});

const beforeAssemblyFetch = 'test.compactRecall.beforeAssemblyFetch';
const scope = { owner: 'synthetic-owner', namespace: 'project\0synthetic-project' };
const unavailable = { ok: false, error: { code: 'evidence_unavailable', retryable: false },
  evidenceTrust: 'untrusted-data-not-instructions' };

async function sqliteRecallFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'compact-recall-'));
  let engine;
  t.after(async () => {
    try { await engine?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  });
  // Wrap the existing fetch seam before the SQLite evidence transaction opens.
  const hook = registerHooks({ resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (context.parentURL?.endsWith('/packaging/core-local/adapter-slot.mjs') &&
        result.url.endsWith('/context-read-assembly-evidence.mjs')) {
      return { ...result, url: result.url + '?recall-race-test' };
    }
    return result;
  }, load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/context-read-assembly-evidence.mjs?recall-race-test')) return result;
    const source = result.source.toString();
    const anchor = 'export function fetchForAssembly(';
    assert.ok(source.includes(anchor));
    return { ...result, source: source.replace(anchor, 'function fetchForAssembly(') + `
export { instrumentedFetch as fetchForAssembly };
function instrumentedFetch(storage) {
  const fetch = fetchForAssembly(storage);
  return async (...args) => {
    await storage[Symbol.for(${JSON.stringify(beforeAssemblyFetch)})]?.(args[3]);
    return fetch(...args);
  };
}
` };
  } });
  let openStorage;
  try { ({ openStorage } = await import('../core-local/adapter-slot.mjs')); }
  finally { hook.deregister(); }

  let clockOffset = 0;
  const clock = { ...localClock, monotonicMs: () => localClock.monotonicMs() + clockOffset };
  const requests = [];
  engine = await openStorage(join(directory, 'memory.sqlite'), null, { provider: {
    key: syntheticKey, owner: scope.owner, clock, authorize() {}, async request(url, options) {
      const endpoint = new URL(url).pathname;
      const { input, model, dimensions } = JSON.parse(options.body);
      requests.push({ endpoint, input });
      assert.equal(endpoint, '/v1/embeddings');
      return Response.json({ object: 'list', model, data: input.map((text, index) => ({ index,
        embedding: [...(text.includes('brass compass') ? [0.6, 0.8] : [1, 0]), ...Array(dimensions - 2).fill(0)],
      })) });
    },
  } });
  const { storage, service, recall } = engine;
  const vectorlessWriter = createMemoryService({ storage, clock, model: null, embedder: null, config: {},
    tokens: { countTokens: text => text.length }, gate: { assertOpen() {} } });
  const tool = async (name, args, writer = service) => {
    const reply = await callTool(writer, scope, null, name, args, null, recall);
    return JSON.parse(reply.content[0].text);
  };
  return {
    recall, requests,
    save: async content => value(await tool('remember_memory', { content })).memory,
    saveVectorless: async content => value(await tool('remember_memory', { content }, vectorlessWriter)).memory,
    forget: async ({ id, revision }) => assert.equal(value(await tool('forget_memory', {
      memoryId: id, expectedRevision: revision,
    })).forgotten, true),
    read: (queryText = query) => tool('recall_memory', { query: queryText }),
    beforeFetch: fn => { storage[Symbol.for(beforeAssemblyFetch)] = fn; },
    expireDeadline: () => { clockOffset += 1_000_000; },
  };
}

const ids = refs => refs.map(({ id }) => id);
const recalledIds = reply => value(reply).memories.map(({ memory }) => memory.id);

test('SQLite keyed recall retries one same-namespace save and embeds the query once', async t => {
  const f = await sqliteRecallFixture(t);
  const ranked = ids([await f.save(retained), await f.save(earlier)]);
  const before = f.requests.length;
  const attempts = [];
  f.beforeFetch(async refs => {
    attempts.push(ids(refs));
    if (attempts.length === 1) await f.saveVectorless('Synthetic rain gauge holds nine units.');
  });
  assert.deepEqual(recalledIds(await f.read()), ranked);
  assert.deepEqual(attempts, [ranked, ranked]);
  assert.deepEqual(f.requests.slice(before), [{ endpoint: '/v1/embeddings', input: [query] }]);
});

test('SQLite keyed recall maps a second stale snapshot to evidence_unavailable', async t => {
  const f = await sqliteRecallFixture(t);
  const keep = await f.save(retained);
  let commits = 0;
  const before = f.requests.length;
  f.beforeFetch(async refs => {
    assert.deepEqual(ids(refs), [keep.id]);
    await f.saveVectorless('Synthetic gauge reading number ' + (commits + 1) + '.');
    commits++;
  });
  const reply = await f.read();
  assert.deepEqual({ commits, reply }, { commits: 2, reply: unavailable });
  assert.deepEqual(f.requests.slice(before), [{ endpoint: '/v1/embeddings', input: [query] }]);
});

test('SQLite keyed recall refuses a retry after the original deadline', async t => {
  const f = await sqliteRecallFixture(t);
  await f.save(retained);
  let attempts = 0;
  f.beforeFetch(async () => {
    attempts++;
    await f.saveVectorless('Synthetic rain gauge holds nine units.');
    f.expireDeadline();
  });
  assert.deepEqual(await f.read(), unavailable);
  assert.equal(attempts, 1);
});

test('SQLite keyed recall never exposes a memory forgotten before evidence fetch', async t => {
  const f = await sqliteRecallFixture(t);
  const forgotten = await f.save(retained);
  const keep = await f.save(earlier);
  const attempts = [];
  f.beforeFetch(async refs => {
    attempts.push(ids(refs));
    if (attempts.length === 1) await f.forget(forgotten);
  });
  const reply = await f.read();
  assert.ok(!JSON.stringify(reply).includes(forgotten.id));
  assert.ok(!JSON.stringify(reply).includes(retained));
  assert.deepEqual(recalledIds(reply), [keep.id]);
  assert.deepEqual(attempts, [[forgotten.id, keep.id], [keep.id]]);
});

test('SQLite keyed recall fresh inspect fences a forget after compact delivery', async t => {
  const f = await sqliteRecallFixture(t);
  const forgotten = await f.save(retained);
  const inspect = f.recall.inspect;
  f.recall.inspect = async (...args) => {
    assert.deepEqual(ids(args[1]), [forgotten.id]);
    await f.forget(forgotten);
    return inspect(...args);
  };
  assert.deepEqual(await f.read(), unavailable);
});

test('SQLite keyed recall reports incomplete coverage for a vectorless memory with no lexical hits', async t => {
  const f = await sqliteRecallFixture(t);
  await f.saveVectorless('Synthetic rain gauge holds nine units.');
  const result = value(await f.read('amethyst'));
  assert.deepEqual(result.memories, []);
  assert.deepEqual({ mapExhausted: result.namespaces[0].mapExhausted, coverage: result.coverage },
    { mapExhausted: false, coverage: 'budget_exhausted' });
});

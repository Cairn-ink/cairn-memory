import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { confirmInstalledUpgrade, legacyKeyedFixture, setupInstalledConsent, withInstalledMcp,
  withUpgradeInstallers } from '../../tools/testing/local-cutover-keyed-fixture.mjs';

const syntheticKey = 'synthetic-recall-provider';
const retained = 'Albatross albatross albatross hides a teal lantern.';
const earlier = 'Albatross albatross carries a brass compass.';
const weaker = ['oak desk', 'blue ribbon', 'glass cup', 'iron bell', 'paper map', 'wooden box', 'silver spoon'];
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
          assert.equal(defaults.memories.length, 6);
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
        assert.deepEqual(observed.slice(-queries.length).map(({ input }) => input), queries.map(query => [query]));
        t.diagnostic(JSON.stringify({ recallEmbeddings: queries.length, responses: 0, inputTokens: 0 }));
      }, { key: syntheticKey, preload });
    } finally {
      f.run(installers.candidate, ['daemon', 'stop', '--local']);
    }
  });
});

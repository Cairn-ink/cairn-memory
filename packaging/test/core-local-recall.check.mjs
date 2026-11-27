import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { confirmInstalledUpgrade, legacyKeyedFixture, setupInstalledConsent, withInstalledMcp,
  withUpgradeInstallers } from '../../tools/testing/local-cutover-keyed-fixture.mjs';
import { golden } from './fixtures/local-host-wire-replay.mjs';

const syntheticKey = 'synthetic-recall-provider';
const retained = 'The synthetic albatross hides a teal lantern.';
const other = 'The synthetic albatross carries a brass compass.';
const removed = 'The synthetic albatross keeps a violet telescope.';
const query = 'albatross';
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function instrumentFetch(f) {
  const log = join(f.parent, 'fetch.jsonl');
  const preload = join(f.parent, 'fetch.mjs');
  writeFileSync(log, '', { mode: 0o600 });
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

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
  const vector = [1, ...Array(body.dimensions - 1).fill(0)];
  return Response.json({ object: 'list', model: body.model,
    data: body.input.map((_, index) => ({ index, embedding: vector })) });
};
`, { mode: 0o600 });
  return { preload, requests: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}

function value(reply) {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}

function compareRefusals(f, preload, key) {
  const { command, args } = json(join(f.home, '.claude.json')).mcpServers['cairn-local'];
  const rows = ['recall keyless', 'recall source keyless'].map(label => golden.exchanges[label]);
  const input = rows.map(({ method, params }, id) => JSON.stringify({ jsonrpc: '2.0', id, method, params })).join('\n') + '\n';
  const child = spawnSync(command, ['--import', preload, ...args], {
    cwd: f.parent, env: { ...f.environment, ...(key && { OPENAI_API_KEY: key }) }, input,
    encoding: 'utf8', timeout: 45_000, killSignal: 'SIGKILL',
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const expected = rows.map(({ response }, id) => JSON.stringify({ jsonrpc: '2.0', id, ...response })).join('\n') + '\n';
  assert.equal(child.stdout, expected);
}

test('registered local MCP serves hybrid recall only with active consent and a key',
  { skip: process.platform !== 'linux', timeout: 120_000 }, async t => {
    await withUpgradeInstallers(async installers => {
      const { f, source, legacy } = await legacyKeyedFixture(installers, 'hybrid-recall', { seed: false });
      await setupInstalledConsent(installers, f, syntheticKey);
      confirmInstalledUpgrade(installers, f, source, legacy);
      const { preload, requests } = instrumentFetch(f);

      await t.test('consented keyed recall returns retained current evidence and uses only embeddings', async () => {
        await withInstalledMcp(f, async tool => {
          const keep = value(await tool('remember_memory', { content: retained })).memory;
          value(await tool('remember_memory', { content: other }));
          const forget = value(await tool('remember_memory', { content: removed })).memory;
          const recall = args => tool('recall_memory', { query, ...args });
          const before = requests().length;
          const result = value(await recall({ includeQualification: true }));
          const item = result.memories.find(({ memory }) => memory.id === keep.id);
          assert.equal(item?.memory.content, retained);
          assert.equal(item.receipts[0].excerpt, retained);
          assert.equal(item.qualification ?? null, null);
          assert.equal(result.namespaces[0].namespace.ownerId, 'synthetic-owner');

          const remembered = value(await recall({ query: 'violet telescope' }));
          assert.ok(remembered.memories.some(({ memory }) => memory.id === forget.id));
          assert.equal(value(await tool('forget_memory', { memoryId: forget.id, expectedRevision: forget.revision })).forgotten, true);

          for (const contextMode of ['source-evidence', 'rationale-evidence']) {
            const args = { contextMode, selectionMode: 'bounded-source-scan' };
            const evidence = value(await recall(args));
            const kept = evidence.memories.find(({ memory }) => memory.id === keep.id);
            assert.deepEqual(kept?.memory, { id: keep.id, revision: keep.revision, currentness: 'current' });
            assert.deepEqual(kept.receipts, [{ id: item.receipts[0].id, role: 'user', excerpt: retained }]);
            assert.equal(kept.interpretationStatus, 'omitted');
            assert.equal(kept.sourceSelectionCoverage, 'unassessed');
            assert.equal(evidence.selection.semanticCoverage, 'unassessed');
            if (contextMode === 'rationale-evidence') {
              assert.equal(kept.rationale.status, 'unassessed');
              assert.deepEqual(kept.rationale.sources[0].receipts, kept.receipts);
              assert.deepEqual(kept.rationale.edges, []);
            }
            assert.equal(value(await recall({ ...args, limit: 1 })).memories.length, 1);
            assert.equal(evidence.memories.length, 2);
            assert.doesNotMatch(JSON.stringify(evidence), new RegExp(forget.id + '|violet telescope', 'u'));
          }
          const current = value(await recall({ query: 'violet telescope' }));
          assert.doesNotMatch(JSON.stringify(current), new RegExp(forget.id + '|violet telescope', 'u'));
          const semantic = value(await recall({ query: 'xylander' }));
          assert.ok(semantic.memories.some(({ memory }) => memory.id === keep.id));

          const invalid = JSON.parse(golden.exchanges['recall invalid combination'].response.result.content[0].text);
          const beforeInvalid = requests().length;
          for (const args of [{ query: '\t' }, { contextMode: 'source-evidence', includeQualification: true },
            { selectionMode: 'bounded-source-scan' }]) {
            assert.deepEqual(await recall(args), invalid);
          }
          assert.equal(requests().length, beforeInvalid);
          const recallFetches = requests().slice(before);
          assert.equal(recallFetches.length, 8);
          assert.ok(recallFetches.every(({ endpoint }) => endpoint === '/v1/embeddings'));
          assert.ok(recallFetches.some(({ input }) => input.includes(query)));
        }, { key: syntheticKey, preload });
      });

      const before = requests().length;
      function checkRefusals(key) {
        try { compareRefusals(f, preload, key); }
        finally { f.run(installers.candidate, ['daemon', 'stop', '--local']); }
        assert.equal(requests().length, before);
      }
      await t.test('keyless with consent matches both frozen replies byte for byte', () => checkRefusals(undefined));
      const { cutover } = json(join(f.root, 'installation.json')).migration;
      unlinkSync(join(f.root, '.cutover-' + cutover.id, 'provider-consent.json'));
      await t.test('key without consent matches both frozen replies byte for byte', () => checkRefusals(syntheticKey));
    });
  });

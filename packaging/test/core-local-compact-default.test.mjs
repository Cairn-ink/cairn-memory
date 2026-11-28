import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildCoreLocalCandidate } from '../build-core-local.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { diagnosticsKey, installCandidate } from './fixtures/local-host-wire-replay.mjs';

test('installed local Context Read defaults to dated bodies with bounded items and tokens', async () => {
  const workspace = createTestWorkspace(null);
  let runtime, encoding;
  try {
    const output = join(workspace.path, 'out');
    const built = buildCoreLocalCandidate(output);
    const { root } = installCandidate(join(workspace.path, 'install'), join(output, built.archive.filename), built.package.name);
    const local = join(root, 'packaging', 'core-local');
    const { openStorage } = await import(pathToFileURL(join(local, 'adapter-slot.mjs')));
    const { serveStdio } = await import(pathToFileURL(join(local, 'host.mjs')));
    const require = createRequire(join(local, 'adapter-slot.mjs'));
    encoding = require('./vendor/tiktoken/tiktoken.cjs').get_encoding('o200k_base');
    const countTokens = text => encoding.encode(text, [], []).length;
    const owner = 'test-owner';
    const scope = { owner, namespace: 'personal\0' };
    const database = join(workspace.path, 'store.sqlite');
    let embeddings = 0;
    runtime = await openStorage(database, undefined, {
      model: { model: 'fixture', contextWindow: 4096, countTokens, call() { assert.fail('unexpected model call'); } },
      embedder: { model: 'fixture', dimensions: 2, async embed(texts) {
        embeddings += texts.length;
        return texts.map(() => Float32Array.of(1, 0));
      } },
    });
    const { storage } = runtime;
    assert.equal(storage.capabilities.fingerprintKey, false);
    assert.equal(storage.capabilities.contextRawRead, true);
    let rawCalls = 0;
    function unexpectedRawRead() {
      rawCalls++;
      assert.fail('compact accessed Raw');
    }
    storage.contextRead.raw.search = unexpectedRawRead;
    storage.contextRead.raw.revalidate = unexpectedRawRead;

    async function call(name, args) {
      const frame = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
      let output = '';
      await serveStdio(Readable.from([JSON.stringify(frame) + '\n']), { write(line) { output += line; } },
        { database, owner }, { shared: { runtime, async authorize() {} } });
      const { result, error } = JSON.parse(output);
      assert.equal(error, undefined);
      return result;
    }

    function unpack(result) {
      const text = result.content[0].text;
      assert.equal(result.isError, false, text);
      return { value: JSON.parse(text).value, text };
    }

    const occurredAtMs = Date.UTC(2026, 0, 2, 3, 4);
    const short = Array.from({ length: 66 }, (_, index) => `Telescope observation ${index}.`);
    const long = Array.from({ length: 34 }, (_, index) =>
      `Observatory report ${index}. ` + 'A steady wind blew across the hill during the evening. '.repeat(9).trim());
    await storage.uow.run(owner, { pauseLock: true }, async tx => {
      for (const [index, text] of [...short, ...long].entries()) {
        await storage.memories.insert(tx, scope, {
          text, kind: 'fact', origin: 'explicit', confidence: 1, embedding: null,
          source: { kind: 'mcp', client: null, sessionId: null },
          textHash: 'sha256:' + createHash('sha256').update(text).digest('hex'),
        }, [{ client: 'fixture', sessionId: 'observations', messageId: String(index), role: 'user',
          excerpt: `Observation log ${index}.`, occurredAtMs }], occurredAtMs);
      }
    });

    const search = { types: ['memory'], intent: 'current', semantic: false, deadlineMs: 5000 };
    async function read(query, limits = {}) {
      const result = await call('read_memory_context', { ...search, query, ...limits });
      const { value, text } = unpack(result);
      const { budget } = result._meta[diagnosticsKey];
      const maxItems = limits.maxItems ?? 64, maxTokens = limits.maxTokens ?? 3_000;
      assert.deepEqual(budget, { maxItems, maxTokens, used: countTokens(text) });
      assert.ok(budget.used <= maxTokens);
      assert.ok(value.items.length <= maxItems);
      return value.items;
    }

    const items = await read('telescope');
    assert.equal(items.length, 64);
    assert.equal(new Set(items.map(({ body }) => body)).size, 64);
    for (const item of items) {
      assert.ok(short.includes(item.body));
      assert.deepEqual(item, { date: '2026-01-02T03:04Z', body: item.body });
    }
    assert.equal((await read('telescope', { maxItems: 3 })).length, 3);
    const invalid = await call('read_memory_context', { ...search, query: 'telescope', maxItems: 64 });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /maxItems: .*<=24/u);

    const budgeted = await read('observatory');
    assert.ok(budgeted.length > 1 && budgeted.length < long.length);
    assert.equal((await read('observatory', { maxTokens: 200 })).length, 1);

    const content = 'The sextant is kept in the upper drawer.';
    const { memory } = unpack(await call('remember_memory', { content })).value;
    assert.equal(embeddings, 1);
    assert.deepEqual(await read('sextant'), [{ date: null, body: content }]);
    const { forgotten } = unpack(await call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision })).value;
    assert.equal(forgotten, true);
    assert.deepEqual(await read('sextant'), []);
    assert.equal(rawCalls, 0);
  } finally {
    try { encoding?.free(); }
    finally {
      try { await runtime?.close(); }
      finally { await workspace.cleanup(); }
    }
  }
});

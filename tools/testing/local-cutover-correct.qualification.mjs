import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { golden, withStdio } from '../../packaging/test/fixtures/local-host-wire-replay.mjs';

export async function qualifyExplicitCorrection({ fixture, vector, savedAt, turns, scope, storageOptions }) {
  const [executable] = vector;
  const clock = join(fixture.parent, 'qualification-clock');
  const entryFile = join(fixture.parent, 'qualification-entry.mjs');
  const moduleURL = name => pathToFileURL(join(dirname(executable), name)).href;
  const setTime = time => writeFileSync(clock, String(time), { mode: 0o600 });
  setTime(savedAt);
  // Run the installed MCP handler with a synthetic clock and the same
  // authority check as the daemon. The production launcher refuses preloads.
  writeFileSync(entryFile, `import { readFileSync } from 'node:fs';
Date.now = () => Number(readFileSync(${JSON.stringify(clock)}, 'utf8'));
const options = ${JSON.stringify(storageOptions)};
const { assertActiveAuthority, managedGeneration } = await import(${JSON.stringify(moduleURL('daemon-authority.mjs'))});
await assertActiveAuthority(managedGeneration(), options);
const { serveStdio } = await import(${JSON.stringify(moduleURL('host.mjs'))});
await serveStdio(process.stdin, process.stdout, options);
`, { mode: 0o600 });
  const original = 'The synthetic feldspar marker is red.';
  const corrected = 'The synthetic feldspar marker is blue.';
  const context = { query: 'feldspar', types: ['memory'], intent: 'current' };
  const rawContext = { ...context, query: 'zirconium', representation: 'representation-v2-dated' };
  const checkRaw = (items, fenced) => {
    const result = JSON.stringify(items);
    for (const turn of turns) {
      const inside = Math.abs(Date.parse(turn.time) - savedAt) <= 30 * 60_000;
      assert.equal(result.includes(turn.text), !fenced || !inside, turn.id + ' Raw visibility');
    }
  };
  let id;
  const found = (path, item, itemId, revision, body) => {
    assert.ok(item, path + ' must find the corrected memory');
    assert.deepEqual([itemId(item), revision(item), body(item)], [id, 2, corrected], path);
  };
  await withStdio(entryFile, [], fixture.parent, async (request, notify) => {
    await request('initialize', golden.exchanges.initialize.params);
    notify('notifications/initialized');
    const call = async (name, arguments_) => {
      const reply = await request('tools/call', { name, arguments: arguments_ });
      assert.ok(reply.result, JSON.stringify(reply));
      const { text } = reply.result.content[0];
      assert.ok(text.startsWith('{'), name + ' ' + text);
      const envelope = JSON.parse(text);
      assert.equal(envelope.ok, true, name + ' ' + JSON.stringify(envelope));
      return envelope.value;
    };
    const { memory: saved } = await call('remember_memory', { content: original });
    id = saved.id;
    assert.equal(saved.revision, 1);
    const before = await call('inspect_memory', { memoryId: id });
    assert.equal(Date.parse(before.memory.createdAt), savedAt);
    assert.equal(before.receipts.length, 1);
    assert.equal(before.receipts[0].client, 'cairn-local-mcp');
    assert.equal(before.receipts[0].sessionId, 'explicit-tool');
    checkRaw((await call('read_memory_context', rawContext)).items, false);

    const correctedAt = savedAt + 60 * 60_000;
    setTime(correctedAt);
    const { memory: edit } = await call('correct_memory', {
      memoryId: id, expectedRevision: 1, content: corrected,
    });
    assert.deepEqual([edit.id, edit.revision, edit.content, Date.parse(edit.updatedAt)],
      [id, 2, corrected, correctedAt]);

    const { items: candidates } = await call('find_memory_candidates', context);
    const entry = candidates.find(({ ref }) => ref.memoryId === id);
    assert.equal(entry?.ref.revision, 2);
    const { items: evidence } = await call('fetch_memory_candidate_evidence', {
      refs: [entry.ref], intent: 'current',
    });
    found('MCP find evidence', evidence.find(({ ref }) => ref.memoryId === id),
      item => item.ref.memoryId, item => item.ref.revision, item => item.content);
    const { items: assembled } = await call('read_memory_context', { ...context, representation: 'representation-v2-dated' });
    found('MCP Context Read', assembled.find(({ ref }) => ref.id === id),
      item => item.ref.id, item => item.ref.rev, item => item.body);
    const inspected = await call('inspect_memory', { memoryId: id });
    found('MCP inspect', inspected.memory, item => item.id, item => item.revision, item => item.content);
    checkRaw((await call('read_memory_context', rawContext)).items, true);
  });

  // Exercise the installed facade's direct read and lexical recall. The
  // published keyless MCP surface has no direct read tool and refuses recall.
  const { openStorage } = await import(pathToFileURL(join(dirname(executable), 'adapter-slot.mjs')));
  const runtime = await openStorage(storageOptions.database);
  try {
    const { service } = runtime;
    const checkMemory = (name, item) => found(name, item, row => row.id, row => row.revision, row => row.text);
    const read = await service.read(scope, { type: 'memory', id });
    assert.equal(read.status, 'found');
    checkMemory('read', read.item);
    const recall = await service.recall(scope, context.query, { mode: 'search' });
    checkMemory('recall', recall.items.find(row => row.id === id));
    const find = await service.find(scope, context.query, { kinds: ['memory'] });
    checkMemory('find', find.memories.find(row => row.id === id));
    checkRaw((await service.listRawMessages(scope)).items, true);
  } finally { await runtime.close(); }
  console.log('Installed explicit correction: read, recall, find, Context Read and inspect found revision 2. Raw at ±29 minutes stayed withheld and Raw at ±31 minutes remained visible.');
}

// This synthetic host imports only the installed archive's public API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

const [installed, path] = process.argv.slice(2);
const NativeWorker = workerThreads.Worker;
let workerCount = 0, observedWorker;
workerThreads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert.equal(fileURLToPath(url), join(installed, 'core/topic-overview-worker.mjs'));
    assert.deepEqual(options.env, {}); assert.deepEqual(options.execArgv, []);
    assert.equal(options.resourceLimits.maxOldGenerationSizeMb, 64);
    workerCount++; observedWorker = fileURLToPath(url);
    super(url, options);
  }
};
syncBuiltinESMExports();
const importedCore = join(installed, 'core/index.mjs');
const { openMemoryCore, openMemoryReader } = await import(pathToFileURL(importedCore));
const namespace = { ownerId: 'installed-overview-owner', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const core = openMemoryCore({ path });
let reader;
try {
  const source = ok(core.admit({ namespace, memory: { content: 'INSTALLED_PRIVATE_BODY synthetic evidence.', kind: 'fact' },
    receipts: [{ client: 'synthetic-installed', sessionId: 'overview', eventId: 'source', role: 'user', excerpt: 'Synthetic evidence.' }] }));
  const placed = ok(core.applyPlacement({ namespace, expectedIndexRevision: source.indexRevision,
    expectedMemoryRevisions: [{ memoryId: source.memory.id, revision: source.memory.revision }],
    proposal: { items: [{ memoryId: source.memory.id, parentIds: [], newL1: {
      title: 'Installed topic', parentL2Ids: [], newL2Title: 'Installed root',
    } }] } }));
  core.close();
  const before = readFileSync(path);
  reader = openMemoryReader({ path, ownerId: namespace.ownerId });
  assert.equal(workerCount, 0, 'constructor must be lazy');
  let cursor, items = [], final;
  do {
    const page = ok(await reader.readTopicOverview({ namespace, workLimit: 16, memberLimit: 1,
      nodeLimit: 1, ...(cursor ? { cursor } : {}) }));
    if (!page.coverage.countsComplete) { assert.deepEqual(page.items, []); assert.equal(page.totals, null); }
    items.push(...page.items); cursor = page.nextCursor; final = page;
  } while (cursor);
  assert.equal(workerCount, 1); assert.equal(items.length, 2); assert.equal(final.totals.unique.total, 1);
  for (const item of items) {
    assert.equal(item.descendantCounts.total, 1);
    assert.deepEqual(item.memberRefs, [{ memoryId: source.memory.id, revision: placed.memories[0].revision }]);
    assert.equal(item.lastMemberAddedAt, null);
  }
  assert.doesNotMatch(JSON.stringify(items), /INSTALLED_PRIVATE_BODY/);
  assert.deepEqual(readFileSync(path), before);
  await reader.close();
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'store_closed');
  console.log(JSON.stringify({ importedCore, observedWorker, workerCount, items: items.length,
    uniqueMemories: final.totals.unique.total, databaseUnchanged: true }));
} finally {
  await reader?.close(); core.close(); workerThreads.Worker = NativeWorker; syncBuiltinESMExports();
}

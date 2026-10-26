import { collectPreviews as collectMembers, previews } from '../testing/topic-member-previews-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { memberFixture, overview, namespace, expected, ok, kinds, sorted } from '../testing/topic-members-fixture.mjs';

import { buildMemberWorld, ledgerMembers } from '../testing/topic-members-world.mjs';

for (const count of [1112, 3336]) test(`P1/E1M-02 exact ${count}-Memory/four-namespace/71-MOC public ledger enumeration`, async t => {
  // Freeze only the Worker's monotonic clock, so origin lifetime cannot become a throughput assertion.
  // Modify the existing Worker launch arguments through the native constructor binding.
  const threads = await import('node:worker_threads'), { syncBuiltinESMExports } = await import('node:module');
  const NativeWorker = threads.default.Worker;
  threads.default.Worker = class extends NativeWorker {
    constructor(url, options) { super(url, { ...options, execArgv: ['--import', new URL('../testing/topic-members-clock.mjs', import.meta.url).href] }); }
  };
  syncBuiltinESMExports();
  t.after(() => { threads.default.Worker = NativeWorker; syncBuiltinESMExports(); });
  const { f, spaces } = buildMemberWorld(t, count, { mode: 'WAL' }), reader = f.reader();
  const counts = [], nodes = [];
  for (const ns of spaces) {
    const result = await overview(reader, ns); counts.push(result.totals.unique.total); nodes.push(...result.items);
    const namespaceUnion = new Set();
    const selections = [...result.items.map(expected), { type: 'unfiled' }];
    for (const selection of selections) {
      const wanted = ledgerMembers(f, ns, selection);
      for (const limit of [1, 7, 100]) {
        const actual = await collectMembers(reader, { namespace: ns, selection, accessRevision: 'scale-grant', previews,
          limit, expectedSnapshot: JSON.parse(JSON.stringify(result.snapshot)) });
        assert.deepEqual(actual.items.map(({ preview, ...ref }) => ref), wanted);
        for (const row of actual.items) assert.deepEqual(row.preview, { status: 'available',
          text: f.ledger.find(r => r.id === row.id).content, truncated: false });
        assert.equal(new Set(actual.items.map(row => row.id)).size, actual.items.length);
        const node = result.items.find(node => node.id === selection.mocId);
        const countByKind = selection.type === 'unfiled' ? result.totals.unfiled : node.level === 'L1' ? node.directCounts : node.descendantCounts;
        assert.equal(actual.items.length, countByKind.total);
        for (const kind of kinds) assert.equal(actual.items.filter(row => row.kind === kind).length, countByKind.byKind[kind]);
        if (limit === 100 && (selection.type === 'unfiled' || selection.level === 'L1')) actual.items.forEach(row => namespaceUnion.add(row.id));
      }
    }
    assert.deepEqual([...namespaceUnion].sort(), f.ledger.filter(row => row.namespace === ns).map(row => row.id).sort());
  }
  const overviewIds = nodes.map(node => node.id).sort(), ledgerIds = [...f.mocs.keys()].sort();
  assert.deepEqual(overviewIds, ledgerIds); assert.equal(nodes.length, 71);
  assert.equal(nodes.filter(node => node.level === 'L1').length, 60); assert.equal(nodes.filter(node => node.level === 'L2').length, 11);
  assert.equal(f.ledger.length, count); assert.equal(counts.reduce((a, b) => a + b, 0), count);
  assert.equal(new Set(f.ledger.map(row => JSON.stringify(row.namespace))).size, spaces.length); assert.equal(spaces.length, 4);
  t.diagnostic(JSON.stringify({ ledgerMemories: f.ledger.length, overviewUnique: counts.reduce((a,b)=>a+b,0), ledgerMocs: ledgerIds.length,
    overviewMocs: overviewIds.length, namespaces: spaces.length, missing: ledgerIds.filter(id => !overviewIds.includes(id)), unexpected: overviewIds.filter(id => !ledgerIds.includes(id)) }));
});

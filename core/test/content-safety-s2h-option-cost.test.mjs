import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { assertCostGateCases, assertCostGateCell, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
const pins = JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-option-counts.json', import.meta.url), 'utf8'));
const authority = { authorize({ input, ...binding }) { return { ...binding, accessGeneration: 1 }; }, isCurrent: grant => grant };
for (const base of [18, 23, 33]) test(`R2 optional MOC sources v${base}: same-engine ceiling, slope and exact safety pins`, async t => {
  const sizes = [];
  for (const n of [12, 24]) {
    const cells = [];
    for (const safety of unmigratedCostOnly ? [false] : [false, true]) {
      const f = safetyFixture(t, base); if (safety) await f.migrate(); const db = f.connect(); let calls = 0;
      const core = openMemoryCore({ path: f.path, model: { countTokens: () => 1 }, contextRead: { version: 'context-read-v1', authority, sources: ['moc-v1'],
        counter: { id: 'synthetic', countTokens() { calls++; return 1; } } } });
      t.after(() => { core.close(); db.close(); });
      for (let i = 0; i < n; i++) {
        const memory = ok(core.admit({ namespace: ns, memory: { content: 'probecommon synthetic memory ' + String(i).padStart(5, '0'), kind: 'fact' }, receipts: [receipt('moc-option-' + i)] })).memory;
        const map = ok(core.map({ namespace: ns }));
        ok(core.applyPlacement({ namespace: ns, expectedIndexRevision: map.indexRevision,
          expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
          proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: 'needle synthetic topic ' + i, parentL2Ids: [] } }] } }));
      }
      const p = { readSet: [ns], types: ['memory'], intent: 'current' };
      ok(await core.refreshContextIndex({ ...p, budget: { maxItems: 1024, maxMs: 5000 } }, {}));
      assertCostGateCell(db, base, safety, 0, ns.ownerId, { testName: t.name, n });
      const records = [];
      for (const method of ['findCandidates', 'contextRead']) {
        const row = await measureContentRead(method, 'moc-v1', () => core[method]({ ...p, query: 'needle', semantic: false, sources: ['moc-v1'], deadlineMs: 5000,
          ...(method === 'findCandidates' ? { limit: 12 } : { budget: { maxTokens: 4000, maxItems: 12 } }) }, {}), () => calls);
        assert.equal(row.result.ok, true, JSON.stringify(row.result));
        assert.equal((row.result.value.metered?.items ?? row.result.value.items).length, 12);
        records.push({ ...row, result: undefined });
      }
      assertCostGateCases('embedded-moc', records); cells.push({ base, n, safety, facts: 0, records });
    }
    t.diagnostic('R4_MOC_COUNTS ' + JSON.stringify(cells)); sizes.push(cells);
  }
  if (unmigratedCostOnly) return;
  for (const cells of sizes) for (const [i, row] of cells[1].records.entries()) {
    const old = cells[0].records[i];
    assert.equal(row.ports, old.ports, 'no additional E1 calls');
    assert.ok(row.begin <= old.begin, 'R2-A1 BEGIN <= legacy');
    assert.ok(row.statements <= old.statements + 6 + row.ports, 'R2-A1 legacy + 6 + E1: ' + JSON.stringify({ base, n: cells[0].n, method: row.method, legacy: old.statements, statements: row.statements, E1: row.ports }));
    assert.deepEqual([row.statements, row.begin, row.ports], pins[JSON.stringify(['moc', base, cells[0].n, row.method])], 'exact safety cell');
  }
  for (let i = 0; i < 2; i++) assert.ok(sizes[1][1].records[i].statements - sizes[0][1].records[i].statements <= sizes[1][0].records[i].statements - sizes[0][0].records[i].statements, 'R2-A1 slope <= legacy');
});

const probe = fileURLToPath(new URL('../testing/content-safety-s2h-path-cost-probe.mjs', import.meta.url));
for (const [v, base] of [[34, 18], [38, 23], [48, 33]]) for (const mode of ['source-evidence', 'rationale-evidence'])
test(`R2 recall ${mode} v${v}: same-engine ceiling, slope and exact safety pins`, t => {
  if (unmigratedCostOnly) return;
  const sizes = [];
  for (const n of [12, 24]) {
    const cells = [];
    for (const physical of [base, v]) {
      const child = spawnSync(process.execPath, [probe, 'memory', String(physical), String(n), '0', 'match', mode, '12'], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(child.status, 0, child.stderr + child.stdout.slice(-5000));
      const rows = child.stdout.split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
      assert.deepEqual(rows.map(r => r.method), ['scope.get', 'scope.list', 'scope.search', 'sourceSnapshot', 'get', 'list', 'map', 'fetch', 'recall', 'session']);
      const row = rows.find(r => r.method === 'recall');
      assert.equal(row.ok, true); assert.equal(row.empty, false); assert.equal(row.selected, 6, 'six selected Memories in each receipt mode');
      assertCostGateCases('recall-' + mode, [{ ...row, variant: mode }]); cells.push(row);
    }
    t.diagnostic('R4_RECALL_COUNTS ' + JSON.stringify({ base, v, mode, n, cells })); sizes.push(cells);
  }
  for (const [index, [old, row]] of sizes.entries()) {
    assert.equal(row.portCalls, old.portCalls); assert.ok(row.begin <= old.begin, 'R2-A1 BEGIN <= legacy');
    assert.ok(row.total <= old.total + 6 + row.portCalls, 'R2-A1 legacy + 6 + E1: ' + JSON.stringify({ base, n: [12, 24][index], mode, legacy: old.total, statements: row.total, E1: row.portCalls }));
    assert.deepEqual([row.total, row.begin, row.portCalls], pins[JSON.stringify(['recall', base, [12, 24][index], mode])], 'exact safety cell');
  }
  assert.ok(sizes[1][1].total - sizes[0][1].total <= sizes[1][0].total - sizes[0][0].total, 'R2-A1 slope <= legacy');
});

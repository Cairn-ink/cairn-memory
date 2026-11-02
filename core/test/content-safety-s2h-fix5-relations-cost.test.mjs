import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { assertCostGateCell, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
const authority = { authorize({ input, ...binding }) { return { ...binding, accessGeneration: 1 }; }, isCurrent: grant => grant };
const pins = JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-fix5-relations-counts.json', import.meta.url), 'utf8'));
assert.match(pins.mainSha, /^93bfa28c[0-9a-f]{32}$/);
const keys = [18, 23, 33].flatMap(base => [12, 24].flatMap(n => [1, 4].flatMap(expansions =>
  ['findCandidates', 'contextRead'].map(method => JSON.stringify([base, n, expansions, method]))))).sort();
for (const kind of ['legacy', 'safety']) assert.deepEqual(Object.keys(pins[kind]).sort(), keys, 'complete permanent cell pins');
for (const base of [18, 23, 33]) for (const expansions of [1, 4])
test(`R2 relations-one-hop-v1 v${base}: ${expansions} expansions, same-engine ceiling and slope`, async t => {
  const sizes = [];
  for (const n of [12, 24]) {
    const cells = [];
    for (const safety of unmigratedCostOnly ? [false] : [false, true]) {
      const f = safetyFixture(t, base); if (safety) await f.migrate(); const db = f.connect(); let calls = 0, deniedText = null, deniedDispatches = 0;
      let edges = [];
      const directCount = expansions === 4 ? n - 4 : 1;
      const core = openMemoryCore({ path: f.path, model: { contextWindow: 32768, countTokens: () => 1, relate: () => ({ edges }) },
        contextRead: { version: 'context-read-v1', authority, sources: ['relations-one-hop-v1'],
          counter: { id: 'synthetic', countTokens(text) { calls++; if (deniedText && text.includes(deniedText)) deniedDispatches++; return 1; } } } });
      t.after(() => { core.close(); db.close(); });
      const memories = Array.from({ length: n }, (_, i) => ok(core.admit({ namespace: ns,
        memory: { content: (i < directCount ? 'needle seed ' : 'unrelated endpoint ') + String(i).padStart(5, '0'), kind: 'fact' },
        receipts: [receipt('relation-' + i)] })).memory);
      const seeds = memories.slice(0, directCount).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
      for (let i = 0; i < expansions; i++) {
        edges = [{ from: 1, to: 0, fromReceipt: 0, toReceipt: 0, relation: 'supports-decision' }];
        assert.equal(ok(await core.reviewRationale({ namespace: ns,
          refs: [seeds[i], memories[directCount + i]].map(m => ({ memoryId: m.id, revision: m.revision })) })).inserted, 1);
      }
      const p = { readSet: [ns], types: ['memory'], intent: 'current' };
      ok(await core.refreshContextIndex({ ...p, budget: { maxItems: 1024, maxMs: 5000 } }, {}));
      assertCostGateCell(db, base, safety, 0, ns.ownerId, { testName: t.name, n, expansions });
      const records = [];
      for (const method of ['findCandidates', 'contextRead']) {
        const row = await measureContentRead(method, 'relations-one-hop-v1/' + expansions, () => core[method]({ ...p,
          query: 'needle', semantic: false, sources: ['relations-one-hop-v1'], deadlineMs: 5000,
          ...(method === 'findCandidates' ? { limit: 12 } : { budget: { maxTokens: 4000, maxItems: 12 } }) }, {}), () => calls);
        const result = ok(row.result);
        assert.equal((result.metered?.items ?? result.items).length, expansions === 4 ? 12 : 2, 'public edge produces every candidate');
        const trace = method === 'contextRead' ? result.diagnostics.candidates.trace : result.trace;
        assert.equal(trace.sources['relations-one-hop-v1'].added, expansions, 'actual expansion count');
        records.push({ ...row, result: undefined, trace: undefined });
      }
      if (safety) {
        const receiptId = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memories[directCount].id).id;
        transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'receipt', key: receiptId,
          reason: 'privacy_erase', actionId: 'relation-receipt-denied' }));
        deniedText = memories[directCount].content;
        for (const method of ['findCandidates', 'contextRead']) {
          const value = ok(await core[method]({ ...p, query: 'needle', semantic: false, sources: ['relations-one-hop-v1'], deadlineMs: 5000,
            ...(method === 'findCandidates' ? { limit: 12 } : { budget: { maxTokens: 4000, maxItems: 12 } }) }, {}));
          const items = value.metered?.items ?? value.items;
          const proofTrace = method === 'contextRead' ? value.diagnostics.candidates.trace : value.trace;
          assert.equal(proofTrace.sources['relations-one-hop-v1'].added, expansions - 1);
          assert.equal(items.length, expansions === 4 ? Math.min(n - 1, 12) : 1, 'committed receipt fact removes its expansion before the page/item limit');
          assert.equal(JSON.stringify(value).includes(memories[directCount].id), false, 'every candidate still checks its receipt on every surface');
          assert.equal(deniedDispatches, 0, 'suppressed expansion text never reaches the counter');
        }
      }
      cells.push({ base, n, safety, expansions, records });
    }
    t.diagnostic('R5_RELATIONS_COUNTS ' + JSON.stringify(cells)); sizes.push(cells);
  }
  for (const cells of sizes) for (const [i, old] of cells[0].records.entries()) {
    const key = JSON.stringify([base, cells[0].n, expansions, old.method]);
    assert.deepEqual([old.statements, old.begin, old.ports], pins.legacy[key], 'unmigrated equals composite 93bfa28c');
    if (unmigratedCostOnly) continue;
    const row = cells[1].records[i];
    assert.equal(row.ports, old.ports, 'no additional E1 calls');
    assert.ok(row.begin <= old.begin, 'R2-A1 BEGIN <= legacy');
    assert.ok(row.statements <= old.statements + 6 + row.ports,
      'R2-A1 legacy + 6 + E1: ' + JSON.stringify({ key, legacy: old.statements, actual: row.statements, E1: row.ports }));
    assert.deepEqual([row.statements, row.begin, row.ports], pins.safety[key], 'exact safety count');
  }
  if (!unmigratedCostOnly) for (let i = 0; i < 2; i++) assert.ok(
    sizes[1][1].records[i].statements - sizes[0][1].records[i].statements <=
    sizes[1][0].records[i].statements - sizes[0][0].records[i].statements, 'R2-A1 slope <= legacy');
});

for (const kind of ['own Raw fact', 'foreign Raw ancestry'])
test('R5 receipt ancestry proof retains refusal: ' + kind, async t => {
  if (unmigratedCostOnly) return;
  const { createHash } = await import('node:crypto');
  const { readTransaction } = await import('../database.mjs');
  const { sourceReader, sourceBudget } = await import('../context-read-relations.mjs');
  const { validateSourceReceipt } = await import('../source-evidence.mjs');
  const { withContentSuppressionReadInside } = await import('../content-suppression-storage.mjs');
  const f = safetyFixture(t, 33); await f.migrate(); const db = f.connect();
  const core = openMemoryCore({ path: f.path }); t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'synthetic proof control', kind: 'fact' }, receipts: [{ ...receipt(kind), client: 'codex' }] })).memory;
  const stored = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  transaction(db, () => {
    db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('proof-raw',
      kind === 'own Raw fact' ? ns.ownerId : 'foreign-synthetic-owner', ns.scope, ns.projectId ?? '', stored.client, 'proof-session', 'time', 'time');
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(stored.id, 'proof-raw', 'message', 0, 2, 'exact');
    if (kind === 'own Raw fact') writeContentSuppressionInside(db, { namespace: ns, kind: 'raw', key: 'proof-raw',
      reason: 'privacy_erase', actionId: 'raw-proof-denied' });
  });
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const expected = digest(validateSourceReceipt(memory.id, stored, digest));
  const row = db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  readTransaction(db, () => withContentSuppressionReadInside(db, [ns], () => {
    const reader = sourceReader(db, { storeId: row.store_id, cursorSecret: row.cursor_secret }, { cards: false },
      { readSet: [ns], types: ['memory'], intent: 'current' }, sourceBudget(Infinity));
    assert.equal(reader.metadata(ns, 'memory', memory.id).row.invalid_raw_ancestry, kind === 'own Raw fact' ? 0 : 1, 'actual canonical ancestry proof');
    assert.equal(reader.receipt(memory.id, stored.id, expected), false, 'canonical ancestry and Raw facts still refuse the receipt');
  }));
});

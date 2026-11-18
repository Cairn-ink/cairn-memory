import assert from 'node:assert/strict';
import test from 'node:test';
import { transaction } from '../database.mjs';
import { openMemoryCore } from '../index.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { completed, fixture, ns, ok, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';

const captureSourcePolicy = 'indexed-evidence-v1';
const firstWindow = 'A'.repeat(800);
const secondWindow = 'B'.repeat(800);
const refusal = { ok: false, error: { code: 'source_excluded', retryable: false } };

for (const [client, mutation] of [['codex', 'forget'], ['claude-code', 'correct']]) {
  test(`a disjoint mapped Raw span stays citable after ${mutation} (${client})`, async t => {
    let extracted = 0;
    const f = fixture(t, { lineage: true, coreOptions: { captureSourcePolicy }, model: {
      extract: () => ({ items: [{ content: 'Synthetic finding ' + ++extracted, kind: 'fact', confidence: .9,
        sourceIndices: [0] }] }),
    } });
    const rawInput = request(splitRaw(firstWindow + secondWindow)[0], { client });
    const first = completed(await f.core.captureRaw(rawInput)).admission.memories[0];
    const memory = { namespace: ns, memoryId: first.id, expectedRevision: first.revision };
    if (mutation === 'forget') ok(f.core.forget(memory));
    else ok(f.core.correct({ ...memory, content: 'Synthetic independent correction', kind: 'fact',
      receipt: { client: 'manual', sessionId: 'other', eventId: 'other-message', role: 'user', excerpt: 'Independent support.' } }));
    assert.deepEqual(f.db.prepare('SELECT start,end FROM raw_source_exclusions').all().map(row => ({ ...row })),
      [{ start: 0, end: 800 }]);

    const writer = openMemoryCore({ path: f.path, model: f.model, captureSourcePolicy });
    f.workspace.defer(() => writer.close());
    const { namespace, sessionId, messages: [{ id, role, content }] } = rawInput;
    const input = { namespace, client, sessionId, eventId: 'synthetic-recapture', messages: [{ id, role, content }] };
    const capture = ok(await writer.capture(input));
    assert.equal(capture.admission.memories.length, 1);
    assert.equal(extracted, 2);
    assert.deepEqual(f.calls.filter(call => call.method === 'extract').at(-1).input.messages.map(row => row.content),
      [secondWindow]);
    const memoryId = capture.admission.memories[0].id;
    const current = ok(writer.get({ namespace, memoryId }));
    assert.deepEqual(current.receipts.map(row => row.excerpt), [secondWindow]);
    const span = f.db.prepare('SELECT start,end FROM raw_receipt_lineage WHERE receipt_id=?').get(current.receipts[0].id);
    assert.deepEqual({ ...span }, { start: 800, end: 1600 });

    const admit = excerpt => writer.admit({ namespace, memory: { content: 'Synthetic claim from a cited window', kind: 'fact' },
      receipts: [{ client, sessionId, eventId: id, role, excerpt }] });
    assert.deepEqual(admit(firstWindow), refusal);
    const lineage = createRawLineageStorage(f.db);
    const revision = () => f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memoryId).revision;
    const before = revision();
    let refusalCode;
    try {
      transaction(f.db, () => {
        f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memoryId);
        lineage.assertAdmissionReceipts(namespace, [{ client, sessionId, eventId: id, role,
          excerpt: 'Synthetic unmapped excerpt.' }]);
      });
    } catch (error) {
      refusalCode = error.code;
    }
    assert.deepEqual([refusalCode, revision()], ['raw_lineage_unavailable', before]);
    const independent = ok(admit(secondWindow)).memory;
    assert.deepEqual(ok(writer.get({ namespace, memoryId: independent.id })).receipts.map(row => row.excerpt), [secondWindow]);
  });
}

test('registered Raw windows still obey an earlier address denial without a Raw exclusion', async t => {
  const f = fixture(t, { lineage: true, coreOptions: { captureSourcePolicy }, model: {
    extract: () => assert.fail('a pre-Raw forgotten address cannot be dispatched'),
  } });
  const input = request(splitRaw(firstWindow + secondWindow)[0], { client: 'codex' });
  const { namespace, client, sessionId, messages: [{ id, role }] } = input;
  const old = ok(f.core.admit({ namespace, memory: { content: 'Synthetic pre-Raw claim', kind: 'fact' },
    receipts: [{ client, sessionId, eventId: id, role, excerpt: firstWindow }] })).memory;
  ok(f.core.forget({ namespace, memoryId: old.id, expectedRevision: old.revision }));
  assert.equal(completed(await f.core.captureRaw(input)).admission.memories.length, 0);
  assert.ok(f.db.prepare('SELECT 1 FROM raw_source_maps').get());
  assert.equal(f.db.prepare('SELECT 1 FROM raw_source_exclusions').get(), undefined);
  assert.deepEqual(f.calls.filter(call => call.method === 'extract'), []);
});

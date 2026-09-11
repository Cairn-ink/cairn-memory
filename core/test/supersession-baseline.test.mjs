import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Characterization of the pre-supersession contract, not target acceptance.
// When supersession ships, deliberately replace BASELINE GAP assertions with
// the adopted lifecycle assertions; keep replay, isolation and authority checks.
// Scripted output proves orchestration behavior only, never semantic model quality.
const namespace = { ownerId: 'supersession-baseline', scope: 'personal', projectId: null };
const friday = 'The project deadline is Friday.';
const monday = 'The project deadline is Monday.';
const capture = (eventId, content, ns = namespace) => ({ namespace: ns, client: 'synthetic',
  sessionId: 'deadline-session', eventId,
  messages: [{ id: `${eventId}-message`, role: 'user', content }] });
const extracted = (content, fields = {}) => ({ content, kind: 'fact', confidence: 1,
  sourceIndices: [0], ...fields });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const detail = (core, memoryId, ns = namespace) => ok(core.get({ namespace: ns, memoryId }));
const active = (core, ns = namespace) => ok(core.list({ namespace: ns })).memories;
function fixture(t, outputs) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-supersession-baseline-')), 'memory.sqlite');
  let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: async () => {
      assert.ok(calls < outputs.length, 'unexpected extraction call');
      return structuredClone(outputs[calls++]);
    } };
  const core = openMemoryCore({ path, model });
  t.after(() => core.close());
  return { core, path, calls: () => calls };
}

test('BASELINE GAP: Friday then an explicit Monday update in captured user text leaves both active', async (t) => {
  const { core } = fixture(t, [{ items: [extracted(friday)] }, { items: [extracted(monday)] }]);
  const firstInput = capture('friday', friday);
  const nextInput = capture('monday', 'Update: the project deadline is now Monday, replacing Friday.');
  const first = ok(await core.capture(firstInput));
  const oldId = first.admission.memories[0].id;
  const before = detail(core, oldId);
  const next = ok(await core.capture(nextInput));
  const newId = next.admission.memories[0].id;
  assert.notEqual(oldId, newId);
  assert.deepEqual(active(core).map((m) => detail(core, m.id).memory.content).sort(), [friday, monday].sort());
  assert.deepEqual(detail(core, oldId), before);
  for (const [id, input] of [[oldId, firstInput], [newId, nextInput]]) {
    assert.deepEqual(detail(core, id).receipts.map(({ eventId, excerpt }) => ({ eventId, excerpt })),
      [{ eventId: input.messages[0].id, excerpt: input.messages[0].content }]);
  }
  assert.deepEqual(detail(core, newId).conflicts, []);
  // Explicit language in evidence is still an inferred capture, not core.correct.
  assert.equal(detail(core, newId).memory.origin, 'agent-inferred');
});

test('BASELINE GAP: cold reopen and replay retain the two active claims without duplicate memories or receipts', async (t) => {
  const { core, path, calls } = fixture(t, [{ items: [extracted(friday)] }, { items: [extracted(monday)] }]);
  const inputs = [capture('friday', friday), capture('monday', 'The deadline changed from Friday to Monday.')];
  const ids = [];
  for (const input of inputs) ids.push(ok(await core.capture(input)).admission.memories[0].id);
  const before = ids.map((id) => detail(core, id));
  core.close();
  const reopened = openMemoryCore({ path });
  t.after(() => reopened.close());
  for (const [i, input] of inputs.entries()) assert.deepEqual(ok(await reopened.capture(input)),
    { duplicate: true, memoryIds: [ids[i]], suppressedCount: 0 });
  assert.equal(calls(), 2);
  assert.equal(active(reopened).length, 2);
  assert.deepEqual(ids.map((id) => detail(reopened, id)), before);
});

test('BASELINE GUARD: proposal-only evidence with scripted empty extraction preserves the old claim', async (t) => {
  const { core } = fixture(t, [{ items: [extracted(friday)] }, { items: [] }]);
  const id = ok(await core.capture(capture('friday', friday))).admission.memories[0].id;
  const before = detail(core, id);
  const result = ok(await core.capture(capture('proposal', 'Could we move the project deadline to Monday? No decision yet.')));
  assert.deepEqual(result.admission.memories, []);
  assert.deepEqual(result.classification, { status: 'skipped', reason: 'empty' });
  assert.deepEqual(detail(core, id), before);
  assert.deepEqual(active(core).map((m) => m.id), [id]);
});

for (const [label, foreign] of [
  ['project', { ...namespace, scope: 'project', projectId: 'other-project' }],
  ['owner', { ...namespace, ownerId: 'other-owner' }],
]) test(`BASELINE GUARD: a foreign ${label} namespace update cannot alter the personal claim`, async (t) => {
  const { core } = fixture(t, [{ items: [extracted(friday)] }, { items: [extracted(monday)] }]);
  const oldId = ok(await core.capture(capture('friday', friday))).admission.memories[0].id;
  const before = detail(core, oldId);
  const newId = ok(await core.capture(capture('monday', 'Update: the project deadline is Monday.', foreign)))
    .admission.memories[0].id;
  assert.deepEqual(detail(core, oldId), before);
  assert.deepEqual(active(core).map((m) => m.id), [oldId]);
  assert.deepEqual(active(core, foreign).map((m) => m.id), [newId]);
  assert.equal(core.get({ namespace, memoryId: newId }).error.code, 'memory_not_found');
  assert.equal(core.get({ namespace: foreign, memoryId: oldId }).error.code, 'memory_not_found');
});

test('BASELINE GUARD: forged extractor supersession and conflict authority reject the entire batch', async (t) => {
  for (const field of ['supersedes', 'supersededBy', 'supersession', 'conflicts', 'conflictHints']) {
    for (const location of ['item', 'envelope']) {
      const forged = { items: [extracted(monday), extracted('Another synthetic note.')] };
      if (location === 'item') forged.items[1][field] = ['forged-old-id'];
      else forged[field] = ['forged-old-id'];
      const { core, path } = fixture(t, [{ items: [extracted(friday)] }, forged]);
      const oldId = ok(await core.capture(capture('friday', friday))).admission.memories[0].id;
      const before = detail(core, oldId);
      const db = new DatabaseSync(path);
      t.after(() => db.close());
      const countReceipts = () => db.prepare('SELECT count(*) AS n FROM receipts').get().n;
      const receiptsBefore = countReceipts();
      const result = await core.capture(capture('forged', 'The project deadline is Monday. Another synthetic note.'));
      assert.deepEqual(result, { ok: false, error: { code: 'invalid_model_output', retryable: false } }, `${location}.${field}`);
      assert.deepEqual(detail(core, oldId), before);
      assert.deepEqual(active(core).map((m) => m.id), [oldId]);
      assert.equal(countReceipts(), receiptsBefore);
    }
  }
});

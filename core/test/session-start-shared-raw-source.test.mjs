import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { sourceFixture, savedSource, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

test('layout 29 session start retains an independent receipt after forgetting a shared Raw receipt', async t => {
  const f = sourceFixture(t, { kind: 'episode', model: {
    ...rationaleModel(), contextWindow: 8192, countTokens: () => 1, interpretEpisode: interpretation,
    extract: () => ({ items: [{ content: 'Synthetic Raw donor memory', kind: 'fact', confidence: .8, sourceIndices: [0] }] }),
  } });
  await savedSource(f, 'Synthetic retained Raw passage', {
    client: 'claude-code', sessionId: 'retained-raw-session',
    episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
  });
  const core = openMemoryCore({ path: f.path, raw: true, rawSearch: false, model: { countTokens: () => 1 } });
  f.workspace.defer(() => core.close());
  const layout = installedContentLayout(f.db);
  assert.equal(layout.physical, 29);
  assert.equal(layout.suppressionRevision, 0);
  const donor = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  const { client, sessionId, eventId, role, excerpt } = ok(core.get({ namespace: ns, memoryId: donor.id })).receipts[0];
  const shared = { client, sessionId, eventId, role, excerpt };
  const independent = { client, sessionId: 'synthetic-independent-session', eventId: 'different-message', role, excerpt: 'Synthetic independent excerpt' };
  const b = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic independent survivor', kind: 'fact' },
    receipts: [shared, independent] })).memory;
  const read = () => core.sessionStartContext({ namespace: ns, maxChars: 8000, backgroundBudget: { maxChars: 8000 },
    groups: { nextSteps: false, procedural: false, background: true } });
  const survivor = value => value.groups.background.items.find(item => item.memory.id === b.id);
  assert.deepEqual(survivor(ok(read())).receipts.map(r => r.excerpt).sort(), [shared.excerpt, independent.excerpt].sort());
  ok(core.forget({ namespace: ns, memoryId: donor.id, expectedRevision: donor.revision }));
  const markers = f.db.prepare("SELECT fingerprint FROM suppressed WHERE fingerprint GLOB 'rs1:*'").all();
  assert.equal(markers.length, 2);
  const ordinary = core.get({ namespace: ns, memoryId: b.id });
  const session = read();
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(b.id).n, 2);
  assert.deepEqual(ok(ordinary).receipts.map(r => r.excerpt), [independent.excerpt]);
  assert.deepEqual(survivor(ok(session)).receipts.map(r => r.excerpt), [independent.excerpt]);
});

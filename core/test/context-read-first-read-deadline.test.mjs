import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { createContextReadAccess } from '../../adapters/mcp/context-read-access.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { controlledClock } from '../testing/context-read-assembly-fixture.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const query = patch => ({ readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope', raw: false, ...patch });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
async function fixture(t) {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const counter = { id: 'synthetic', countTokens: text => Math.ceil(Buffer.byteLength(text) / 4) };
  const core = openMemoryCore({ path, raw: true, rawSearch: false, contextRead: { ...access.configuration, counter },
    model: { contextWindow: 8192, countTokens: () => 1, extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: message.content, kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }) } });
  workspace.defer(() => core.close());
  for (let i = 0; i < 2; i++) ok(await core.capture({ namespace: ns, client: 'codex', sessionId: 'synthetic', eventId: 'synthetic-' + i,
    messages: [{ id: 'synthetic-' + i, role: 'user', content: 'Synthetic telescope ' + i, occurredAt: '2026-01-01T00:00:00.000Z' }] }));
  const productFacade = openContextProductFacade(path, {}); workspace.defer(() => productFacade.close());
  const product = openProductIndex({ path, facade: productFacade, maintenance: true, counter,
    authorize: () => ({ accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }), check() {}, envelope: work => work() }),
    ownerCoverage: { omittedNamespaces: 0 } }); workspace.defer(() => product.close());
  const refresh = { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } };
  return { core, access, product, async build() {
    while (ok(await access.call(core, 'refreshContextIndex', refresh)).status !== 'complete') {}
    while (ok(await product.run('refreshContextIndex', { ...refresh, mode: 'lexical' })).status !== 'complete') {}
  }, readers: [input => access.call(core, 'contextRead', input), input => product.run('contextRead', input)] };
}
function statements(t, hook) {
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = Reflect.apply(prepare, this, [sql]);
    hook(statement, sql);
    return statement;
  });
}
for (const reader of [0, 1]) for (const stage of ['before', 'during']) test(`${reader ? 'product' : 'embedded'} slow dates ${stage} batch retain the legacy item set undated`, async t => {
  const f = await fixture(t); await f.build();
  const legacy = ok(await f.readers[reader](query({ representation: 'representation-v2', deadlineMs: 1000 })));
  const clock = controlledClock(t); let batches = 0;
  statements(t, (statement, sql) => {
    if (sql.startsWith('SELECT r.*,') && sql.includes('source_time_available') || sql.includes(' AS evidence_receipts')) {
      const all = statement.all.bind(statement);
      statement.all = (...args) => { const rows = all(...args); if (stage === 'before') clock.advance(460); return rows; };
    }
    if (sql.startsWith('WITH wanted AS')) {
      const all = statement.all.bind(statement);
      statement.all = (...args) => { batches++; const rows = all(...args); if (stage === 'during') clock.advance(950); return rows; };
    }
  });
  const result = ok(await f.readers[reader](query({ deadlineMs: 1000 })));
  assert.deepEqual(result.metered.items, legacy.metered.items);
  assert.equal(result.diagnostics.stops.deadline, true);
  assert.equal(batches, stage === 'before' ? 0 : 1);
  assert.equal(result.metered.items.length, 2);
});
for (const state of ['never-built', 'invalidated', 'slow-open']) for (const explicit of [false, true]) test(`embedded ${state} index ${explicit ? 'honors explicit deadline (unchanged)' : 'uses bounded first-read grace'}`, async t => {
  const f = await fixture(t);
  if (state === 'invalidated') {
    await f.build();
    ok(await f.core.capture({ namespace: ns, client: 'codex', sessionId: 'synthetic', eventId: 'synthetic-new',
      messages: [{ id: 'synthetic-new', role: 'user', content: 'Synthetic telescope new' }] }));
  }
  const clock = controlledClock(t); let delayed = false;
  if (state === 'slow-open') {
    const exec = DatabaseSync.prototype.exec;
    t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
      const value = Reflect.apply(exec, this, [sql]);
      if (sql.includes('CREATE TABLE generations') && !delayed) { delayed = true; clock.advance(1100); }
      return value;
    });
  }
  statements(t, (statement, sql) => {
    if (!sql.startsWith('INSERT INTO postings')) return;
    const run = statement.run.bind(statement);
    statement.run = (...args) => { const row = run(...args); if (!delayed) { delayed = true; clock.advance(1100); } return row; };
  });
  const result = await f.readers[0](query(explicit ? { deadlineMs: 1000 } : {}));
  assert.equal(delayed, true);
  if (explicit) assert.ok(!result.ok || result.value.metered.items.length === 0);
  else assert.equal(ok(result).metered.items.length, state === 'invalidated' ? 3 : 2);
});
test('warm embedded store retains the exact default deadline (unchanged)', async t => {
  const f = await fixture(t); await f.build(); const clock = controlledClock(t);
  statements(t, (statement, sql) => {
    if (!sql.startsWith('WITH wanted AS')) return;
    const all = statement.all.bind(statement);
    statement.all = (...args) => { const rows = all(...args); clock.advance(1100); return rows; };
  });
  const result = await f.readers[0](query({}));
  assert.ok(!result.ok || result.value.metered.items.length === 0);
});
for (const reader of [0, 1]) test(`${reader ? 'product' : 'embedded'} final validation cannot complete: delivers nothing`, async t => {
  const f = await fixture(t); await f.build(); const clock = controlledClock(t); let reads = 0;
  statements(t, (statement, sql) => {
    if (!sql.startsWith('SELECT *') || !sql.includes(' FROM memories WHERE ')) return;
    const get = statement.get.bind(statement);
    statement.get = (...args) => { const row = get(...args); if (++reads > 2) clock.advance(1100); return row; };
  });
  const result = await f.readers[reader](query({ deadlineMs: 1000 }));
  assert.ok(!result.ok || result.value.metered.items.length === 0, 'late canonical validation must not deliver selected text');
  assert.ok(reads > 2);
});

test('first-read grace refuses work beyond the bounded default window (unchanged deadline refusal)', async t => {
  const f = await fixture(t), clock = controlledClock(t); let delayed = false;
  statements(t, (statement, sql) => {
    if (!sql.startsWith('INSERT INTO postings')) return;
    const run = statement.run.bind(statement);
    statement.run = (...args) => { const value = run(...args); if (!delayed) { delayed = true; clock.advance(3100); } return value; };
  });
  const result = await f.readers[0](query({}));
  assert.equal(delayed, true);
  assert.ok(!result.ok || result.value.metered.items.length === 0);
});

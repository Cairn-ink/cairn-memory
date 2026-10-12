import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, symlinkSync,
  renameSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadCardPlanQaCases, prepareCardPlanQaCase, cardPlanQaRoster } from '../card-plan-profile.mjs';
import { prepareCardPlanComparison, assertCardPlanStoreUnchanged,
  consumeCardPlanPreparation } from '../card-plan-store.mjs';

test('RS1–RS3: all 24 real cold stores retain 288 complete independently reconstructed sources', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'card-plan-store-red-' });
  const outputRoot = join(workspace.path, 'prepared');
  const preparation = await prepareCardPlanComparison({ outputRoot });
  const observation = preparation.observation;
  assert.equal(observation.version, 'card-plan-comparison-preparation-v1');
  assert.deepEqual(observation.cases.map(c => c.id), cardPlanQaRoster);
  assert.equal(lstatSync(outputRoot).mode & 0o777, 0o700);
  const sources = await loadCardPlanQaCases(), identities = new Set();
  for (const c of observation.cases) {
    const original = await prepareCardPlanQaCase(sources, c.id);
    assert.equal(c.captures.length, 12);
    assert.equal(c.rankRequest.input.candidates.length, 12);
    assert.deepEqual(c.sourceProvenance, original.sourceProvenance);
    assert.equal(c.recall.ok, true);
    assert.equal(c.recall.value.coverage, 'complete');
    assert.equal(c.recall.value.selection.strategy, 'complete-map');
    assert.equal(c.selectCalls, 0); assert.equal(c.rankCalls, 1);
    const expected = original.plan.cairnPlan.batches.map(batch => batch.indexedWindows[0]);
    const actual = c.captures.map(capture => capture.receipts[0]);
    assert.deepEqual(actual.map(row => [row.role, row.excerpt]), expected.map(row => [row.role, row.content]));
    for (const capture of c.captures) {
      assert.equal(capture.result.ok, true); assert.equal(capture.receipts.length, 1);
      assert(!identities.has(capture.receipts[0].id)); identities.add(capture.receipts[0].id);
    }
    assert(c.captures.every((capture, index) => capture.memory.content === expected[index].content),
      'every captured whole-card content must equal its independent full source window');
    const byMemory = new Map(c.captures.map(capture => [capture.memory.id, capture.memory.content]));
    assert(c.rankRequest.input.candidates.every(card => card.receipts[0].excerpt === byMemory.get(card.memory.id)),
      'every ranked whole source must equal its independently admitted card content');
    assert(c.rankRequest.input.candidates.every(card => !Object.hasOwn(card.memory, 'content')
      && card.interpretationStatus === 'omitted'), 'unchanged core source-only projection omits interpretation content');
    assert.deepEqual(c.rankRequest.input.candidates.map(card => card.receipts[0].id), c.candidateReceiptOrder);
    assert.deepEqual(c.stateBefore, c.stateAfter);
    await assertCardPlanStoreUnchanged(c);
    assert.equal(lstatSync(c.path).mode & 0o777, 0o600);
    for (const witness of Object.values(c.tokenWitnesses)) {
      assert.equal(typeof witness.text, 'string'); assert(witness.inputTokens > 0 && witness.inputTokens <= 6000);
    }
  }
  assert.equal(identities.size, 288);
  await consumeCardPlanPreparation(preparation);
  await assert.rejects(consumeCardPlanPreparation(preparation), { code: 'card_plan_preparation_consumed' });
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('RS4: nonfresh/symlink paths, replaced private identities and every logical SQLite table deny authority', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'card-plan-store-controls-' });
  const occupied = join(workspace.path, 'occupied'); mkdirSync(occupied, { mode: 0o700 });
  await assert.rejects(prepareCardPlanComparison({ outputRoot: occupied }), { code: 'card_plan_output_not_fresh' });
  const link = join(workspace.path, 'link'); symlinkSync(occupied, link);
  await assert.rejects(prepareCardPlanComparison({ outputRoot: link }), { code: 'card_plan_output_not_fresh' });
  await assert.rejects(prepareCardPlanComparison({ outputRoot: join(link, 'nested') }), { code: 'card_plan_output_unsafe' });
  const preparation = await prepareCardPlanComparison({ outputRoot: join(workspace.path, 'prepared') });
  const c = preparation.observation.cases[0], baseline = readFileSync(c.path);
  await assert.rejects(assertCardPlanStoreUnchanged({ ...c }), { code: 'invalid_card_plan_preparation' });
  let tables = 0;
  for (const [name, rows] of Object.entries(c.stateAfter.logical.tables)) {
    const db = new DatabaseSync(c.path), quoted = '"' + name.replaceAll('"', '""') + '"';
    try {
      if (rows.length) db.exec(`DELETE FROM ${quoted}`);
      else db.exec(`ALTER TABLE ${quoted} ADD COLUMN agent_probe INTEGER`);
    } finally { db.close(); }
    await assert.rejects(assertCardPlanStoreUnchanged(c), { code: 'card_plan_store_drift' });
    writeFileSync(c.path, baseline); await assertCardPlanStoreUnchanged(c); tables++;
  }
  assert.equal(tables, Object.keys(c.stateAfter.logical.tables).length);
  const db = new DatabaseSync(c.path); db.exec('CREATE TABLE agent_extra(value TEXT)'); db.close();
  await assert.rejects(assertCardPlanStoreUnchanged(c), { code: 'card_plan_store_drift' });
  writeFileSync(c.path, baseline);
  const moved = c.path + '.original'; renameSync(c.path, moved); copyFileSync(moved, c.path); chmodSync(c.path, 0o600);
  await assert.rejects(assertCardPlanStoreUnchanged(c), { code: 'card_plan_output_unsafe' });
  renameSync(c.path, c.path + '.replacement'); renameSync(moved, c.path);
  await assertCardPlanStoreUnchanged(c);
  renameSync(c.path, moved); symlinkSync(moved, c.path);
  await assert.rejects(assertCardPlanStoreUnchanged(c), { code: 'card_plan_output_unsafe' });
  renameSync(c.path, c.path + '.symlink'); renameSync(moved, c.path);
  chmodSync(c.path, 0o644);
  await assert.rejects(assertCardPlanStoreUnchanged(c), { code: 'card_plan_output_unsafe' });
  chmodSync(c.path, 0o600);
  const root = preparation.observation.outputRoot;
  renameSync(root, root + '-original'); mkdirSync(root, { mode: 0o700 });
  await assert.rejects(assertCardPlanStoreUnchanged(c), { code: 'card_plan_output_unsafe' });
  renameSync(root, root + '-replacement'); renameSync(root + '-original', root);
  await assertCardPlanStoreUnchanged(c);
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('RS4: owned teardown removes success, assertion and setup failure scratch', async () => {
  for (const mode of ['success', 'assertion', 'setup']) {
    const workspace = createTestWorkspace(null, { prefix: 'card-plan-cleanup-control-' });
    let closed = 0; workspace.defer(() => { closed++; });
    try {
      mkdirSync(join(workspace.path, 'partial'), { mode: 0o700 });
      if (mode === 'assertion') assert.fail('deliberate-owned-assertion');
      if (mode === 'setup') throw new Error('deliberate-owned-setup');
    } catch (error) { assert.equal(error.message, mode === 'assertion'
      ? 'deliberate-owned-assertion' : 'deliberate-owned-setup'); }
    finally { await workspace.cleanup(); }
    assert.equal(closed, 1); assert.equal(existsSync(workspace.path), false);
  }
});

test('RS4: hostile preparation descriptors reject without invoking hooks or creating output', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'card-plan-hostile-red-' });
  let hooks = 0;
  const options = Object.defineProperty({}, 'outputRoot', { enumerable: true,
    get() { hooks++; return join(workspace.path, 'forbidden'); } });
  await assert.rejects(prepareCardPlanComparison(options), { code: 'invalid_card_plan_preparation' });
  await assert.rejects(prepareCardPlanComparison(new Proxy({}, { ownKeys() { hooks++; throw Error('hostile'); } })),
    { code: 'invalid_card_plan_preparation' });
  assert.equal(hooks, 0); assert.equal(existsSync(join(workspace.path, 'forbidden')), false);
});

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { personal, project, ok, query, exact, scripted, capture, assertRareSourceRecall }
  from '../testing/source-ranking-recall-fixture.mjs';

if (process.env.CAIRN_IDF_CLEANUP_FIXTURE) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-idf-cleanup-child-' });
  const { model } = scripted();
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
    sourceRankingPolicy: 'bounded-idf-v1' }); workspace.defer(() => core.close());
  console.log(`owned=${workspace.path}`);
  try {
    await capture(core, personal, [exact], 'cleanup');
    const result = ok(await core.recall({ readSet: [personal], query, contextMode: 'source-evidence' }));
    assert.equal(result.memories.length, process.env.CAIRN_IDF_CLEANUP_FIXTURE === 'pass' ? 1 : 2,
      'deliberate synthetic assertion failure');
  } finally { await workspace.cleanup(); }
  process.exit(0);
}

test('R4 predetermined rare source wins actual packed windows after normal capture/classify and cold reopen', async t => {
  await assertRareSourceRecall(t);
});

test('R1/R4 ordinary recall and maps preserve bytes; unfiled and mixed namespaces remain independent', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-scopes-' });
  const path = join(workspace.path, 'memory.sqlite');
  const oldScript = scripted(), newScript = scripted();
  const old = openMemoryCore({ path, model: oldScript.model }); workspace.defer(() => old.close());
  await capture(old, personal, ['cobaltmarker unfiled original source'], 'unfiled');
  await capture(old, project, ['cobaltmarker project original source'], 'project');
  const enabled = openMemoryCore({ path, model: newScript.model, sourceRankingPolicy: 'bounded-idf-v1' });
  workspace.defer(() => enabled.close());
  assert.deepEqual(enabled.map({ namespace: personal }), old.map({ namespace: personal }));
  const ordinary = { readSet: [personal, project], query: 'cobaltmarker' };
  assert.deepEqual(await enabled.recall(ordinary), await old.recall(ordinary));
  assert.deepEqual(newScript.calls, oldScript.calls);
  for (const readSet of [[personal, project], [project, personal]]) {
    newScript.calls.length = 0;
    const result = ok(await enabled.recall({ readSet, query: 'cobaltmarker', contextMode: 'source-evidence' }));
    assert.equal(result.memories.length, 2);
    assert.ok(newScript.calls.find(call => call.method === 'select').input.maps
      .some(map => map.items.some(item => item.type === 'unfiled')));
  }
  assert.deepEqual(await enabled.recall({ readSet: [personal], query: '', contextMode: 'source-evidence' }),
    { ok: false, error: { code: 'invalid_input', retryable: false } });
});

test('R4 rare wrong-person/date, negation and proposal distractors remain diagnostic failures', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-counterexamples-' });
  const path = join(workspace.path, 'memory.sqlite');
  const { model, calls } = scripted();
  const core = openMemoryCore({ path, model, sourceRankingPolicy: 'bounded-idf-v1' }); workspace.defer(() => core.close());
  const distractors = ['cobaltmarker belongs to Bea, not Ari.', 'cobaltmarker was only used in 2019.',
    'cobaltmarker was rejected; do not adopt it.', 'cobaltmarker is a proposal awaiting adoption.'];
  let inappropriate = 0;
  for (let index = 0; index < distractors.length; index += 1) {
    const ns = { ...personal, ownerId: `counterexample-${index}` };
    await capture(core, ns, ['generic amber copper quartz relevant context', distractors[index]], `case-${index}`);
    const result = ok(await core.recall({ readSet: [ns], query, contextMode: 'source-evidence' }));
    assert.equal(result.memories[0]?.receipts[0].excerpt, distractors[index]);
    inappropriate += result.memories.length;
  }
  assert.equal(inappropriate, 4, 'scripted rare-token selector makes four inappropriate choices; no semantic claim');
  assert.equal(calls.filter(call => call.method === 'rank').length, 4);
});

test('R4 weighted winning passage can hide rare cue in unchanged unweighted label', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-label-limit-' });
  const { model, calls } = scripted();
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
    sourceRankingPolicy: 'bounded-idf-v1' }); workspace.defer(() => core.close());
  for (let i = 0; i < 10; i += 1) await capture(core, personal, [`generic amber copper quartz crowd ${i}`], `crowd-${i}`);
  const source = `generic amber copper quartz ${'padding '.repeat(28)}cobaltmarker`;
  const [target] = await capture(core, personal, [source], 'hidden-label');
  const result = ok(await core.recall({ readSet: [personal], query, contextMode: 'source-evidence' }));
  const visible = calls.find(call => call.method === 'select').input.maps.flatMap(map => map.items)
    .find(item => (item.ref.memoryId ?? item.ref.childId) === target.id);
  assert.ok(visible);
  assert.equal(visible.label.includes('cobaltmarker'), false);
  assert.deepEqual(result.memories, []);
});

test('R4 navigation-selected whole source can be omitted from rank independently', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-rank-limit-' });
  const { model, calls } = scripted();
  const baseCounter = model.countTokens;
  model.countTokens = text => {
    const parsed = JSON.parse(text || 'null');
    return parsed?.input?.candidates?.some(candidate => candidate.receipts?.some(receipt => receipt.excerpt.includes('cobaltmarker')))
      ? 6001 : baseCounter(text);
  };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
    sourceRankingPolicy: 'bounded-idf-v1' }); workspace.defer(() => core.close());
  await capture(core, personal, [exact], 'target');
  const result = ok(await core.recall({ readSet: [personal], query, contextMode: 'source-evidence' }));
  assert.ok(calls.find(call => call.method === 'select').input.maps[0].items[0].label.includes('cobaltmarker'));
  assert.equal(result.recallTruncated.candidatesOmitted, 1);
  assert.deepEqual(result.memories, []);
  assert.equal(calls.some(call => call.method === 'rank'), false);
});

test('R1/R4 stale count/microtask/select/fetch/rank callbacks keep authoritative finalization', async t => {
  for (const phase of ['count', 'microtask', 'select', 'fetch', 'rank']) {
    const workspace = createTestWorkspace(t, { prefix: `cairn-idf-stale-${phase}-` });
    const { model, calls } = scripted();
    let armed = false, core, target, changed = false;
    const mutate = () => { changed = true; ok(core.forget({ namespace: personal,
      memoryId: target.id, expectedRevision: target.revision })); };
    model.countTokens = text => {
      const parsed = JSON.parse(text || 'null');
      if (armed && ((phase === 'count' || phase === 'microtask') && parsed?.value?.items?.[0]?.label ||
          phase === 'fetch' && parsed?.value?.items?.[0]?.receipts)) {
        armed = false; if (phase === 'microtask') queueMicrotask(mutate); else mutate();
      }
      return 1;
    };
    for (const method of ['select', 'rank']) {
      const callback = model[method];
      model[method] = request => { if (armed && method === phase) { armed = false; mutate(); } return callback(request); };
    }
    core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
      sourceRankingPolicy: 'bounded-idf-v1' }); workspace.defer(() => core.close());
    target = (await capture(core, personal, [exact], phase))[0];
    target = ok(core.get({ namespace: personal, memoryId: target.id })).memory;
    armed = true;
    const result = await core.recall({ readSet: [personal], query, contextMode: 'source-evidence' });
    assert.equal(changed, true, phase);
    assert.equal(result.ok, false, `${phase}: ${JSON.stringify(result)}`);
    assert.equal(result.error.code, phase === 'fetch' ? 'cursor_stale' : phase === 'rank'
      ? 'revision_conflict' : 'index_revision_conflict',
      `${phase}: ${JSON.stringify(result)}`);
    if (phase !== 'rank') assert.equal(calls.some(call => call.method === 'rank'), false, phase);
  }
});

test('R4 eligible poisoned receipt rejects before selector on both source modes', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-poison-' });
  const path = join(workspace.path, 'memory.sqlite');
  const { model, calls } = scripted();
  const core = openMemoryCore({ path, model, sourceRankingPolicy: 'bounded-idf-v1' }); workspace.defer(() => core.close());
  const [target] = await capture(core, personal, [exact], 'target');
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('tampered source', target.id);
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    const result = await core.recall({ readSet: [personal], query, contextMode });
    assert.deepEqual(result, { ok: false, error: { code: 'storage_error', retryable: false } });
    assert.deepEqual(calls, []);
  }
});

test('R4 success and deliberate failure children clean their owned ranking scratch', () => {
  for (const mode of ['pass', 'fail']) {
    const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script', fileURLToPath(import.meta.url)], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 30000,
      env: { ...process.env, CAIRN_IDF_CLEANUP_FIXTURE: mode } });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, mode === 'pass' ? 0 : 1, child.stdout + child.stderr);
    if (mode === 'fail') assert.match(child.stderr, /deliberate synthetic assertion failure/);
    const owned = child.stdout.match(/^owned=(.+)$/m)?.[1];
    assert.ok(owned);
    assert.equal(existsSync(owned), false);
  }
});

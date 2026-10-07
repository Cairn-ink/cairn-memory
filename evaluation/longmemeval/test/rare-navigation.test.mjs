import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createMemoryRuntime } from '../../../core/runtime.mjs';
import { createQueryScore } from '../../../core/query-candidates.mjs';
import { createQueryExcerpt } from '../../../core/query-excerpt.mjs';
import { createRareQueryLabels } from '../../../core/rare-query-preview.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { modelRequestText, MODEL_INPUT_TOKENS } from '../../../core/model-call.mjs';
import { readFileSync } from 'node:fs';

const ns = { ownerId: 'rare-preview-synthetic', scope: 'personal', projectId: null };
const policy = { sourceCandidatePolicy: 'bounded-keyset-v1' };
const query = 'what when how did the does a before after Kivu tomorrow';
const common = 'what when how did the does a before after';
const anchor = 'Kivu tomorrow';
const ok = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
const receiptKey = source => createHash('sha256').update(JSON.stringify(source)).digest('hex');
const ref = item => item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision };
function model() {
  const calls = [], pages = [];
  return { calls, pages, contextWindow: 8192, countTokens(text) {
    const count = countOpenAITokens(text);
    try { const envelope = JSON.parse(text); if (envelope.ok && Array.isArray(envelope.value?.items)
      && envelope.value.items.some(item => item.label !== undefined)) pages.push({ value: envelope.value, tokens: count }); } catch { /* Count non-JSON too. */ }
    return count;
  },
    select({ input }) {
      calls.push({ stage: 'select', input });
      return { refs: input.maps.flatMap(page => page.items.filter(item => item.label.includes(anchor)).slice(0, 1)
        .map(item => ({ namespaceIndex: page.namespaceIndex, ...ref(item) }))) };
    },
    rank({ input }) {
      calls.push({ stage: 'rank', input });
      return { refs: input.candidates.slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex,
        memoryId: item.memory.id, revision: item.memory.revision })) };
    } };
}
function admit(core, content, excerpts, namespace = ns) {
  return ok(core.admit({ namespace, memory: { content, kind: 'context' },
    receipts: excerpts.map((excerpt, index) => ({ client: 'synthetic', sessionId: 'owned',
      eventId: `${content}-${index}`, role: 'user', excerpt })) })).memory;
}

test('G1 generic receipt hides rare anchors in default actual select input', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-rare-navigation-' });
  let core;
  workspace.defer(() => core?.close());
  const path = join(workspace.path, 'memory.sqlite');
  const oldModel = model();
  core = openMemoryCore({ path, model: oldModel, ...policy });
  for (let index = 0; index < 100; index++) admit(core, `what when how did the does a before distractor ${index}`,
    [`what when how did the does a before source ${index}`]);
  const necessary = `${'what when how '.repeat(25)}${'padding '.repeat(20)}${anchor}`;
  const target = admit(core, 'Kivu interpretation', [common, necessary]);
  assert.equal(createQueryExcerpt(query)(necessary).includes(anchor), false, 'window-only old policy also hides anchors on necessary source');
  const old = ok(await core.recall({ readSet: [ns], query, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  const oldItems = oldModel.calls.filter(call => call.stage === 'select').flatMap(call => call.input.maps.flatMap(page => page.items));
  assert.ok(oldItems.some(item => ref(item).memoryId === target.id), 'target ID really delivered before intervention');
  assert.equal(oldItems.find(item => ref(item).memoryId === target.id).label.includes(anchor), false);
  assert.equal(old.memories.length, 0);
  if (process.env.CAIRN_NAVIGATION_PREVIEW_ASSERT === 'baseline') {
    assert.ok(oldItems.find(item => ref(item).memoryId === target.id).label.includes(anchor), 'rare anchors must reach actual select input');
  }
  core.close();
  const newModel = model();
  core = openMemoryCore({ path, model: newModel, ...policy, navigationLabelPolicy: 'rare-query-window-v1' });
  const improved = ok(await core.recall({ readSet: [ns], query, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  const newItems = newModel.calls.filter(call => call.stage === 'select').flatMap(call => call.input.maps.flatMap(page => page.items));
  assert.deepEqual(newItems.map(ref), oldItems.map(ref), 'same actually delivered candidate identities and order');
  assert.ok(newItems.find(item => ref(item).memoryId === target.id).label.includes(anchor));
  assert.equal(improved.memories[0].memory.id, target.id);
  assert.equal(newModel.calls.filter(call => call.stage === 'select').length,
    oldModel.calls.filter(call => call.stage === 'select').length, 'no added select calls');
  assert.equal(newModel.calls.filter(call => call.stage === 'rank').length, 1, 'selection now legitimately reaches existing rank stage');
  for (const item of newItems) assert.ok([...item.label].length <= 120);
  for (const call of newModel.calls.filter(call => call.stage === 'select')) {
    for (const page of call.input.maps) {
      const observed = newModel.pages.find(trial => JSON.stringify(trial.value.items) === JSON.stringify(page.items));
      assert.ok(observed, 'actual delivered select map matches a measured envelope');
      assert.ok(observed.tokens <= 4000, 'that exact envelope respects map budget');
    }
    const prompt = readFileSync(new URL('../../../core/prompts/recall-select.md', import.meta.url), 'utf8');
    assert.ok(countOpenAITokens(modelRequestText(prompt, call.input)) <= MODEL_INPUT_TOKENS,
      'complete actual packed prompt + input fits model input limit');
  }
  const oldCursor = oldModel.pages.find(page => page.value.nextCursor)?.value.nextCursor;
  const newCursor = newModel.pages.find(page => page.value.nextCursor)?.value.nextCursor;
  assert.ok(oldCursor && newCursor);
  const decode = cursor => JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString());
  assert.equal(decode(oldCursor).labelPolicy, undefined);
  assert.equal(decode(newCursor).labelPolicy, 'rare-query-window-v1');
  assert.notEqual(decode(oldCursor).q, decode(newCursor).q);
});

test('G3 invalid values/combinations/getters fail before store creation', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-rare-option-' });
  const path = join(workspace.path, 'must-not-exist.sqlite');
  for (const value of [undefined, null, false, 'other']) assert.throws(() =>
    openMemoryCore({ path, ...policy, navigationLabelPolicy: value }), { code: 'invalid_input' });
  assert.throws(() => openMemoryCore({ path, navigationLabelPolicy: 'rare-query-window-v1' }), { code: 'invalid_input' });
  let reads = 0;
  const input = { path, ...policy };
  Object.defineProperty(input, 'navigationLabelPolicy', { enumerable: true, get() { reads++; throw Error('must not run'); } });
  assert.throws(() => openMemoryCore(input), { code: 'invalid_input' });
  assert.equal(reads, 0);
  assert.equal(existsSync(path), false);
});

test('G3 default bodies/source output and non-source mode stay byte-identical with no new calls', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-rare-parity-' });
  let core;
  workspace.defer(() => core?.close());
  const path = join(workspace.path, 'memory.sqlite');
  core = openMemoryCore({ path, ...policy });
  for (let index = 0; index < 36; index++) admit(core, `Kivu tomorrow parity ${index}`, [`Kivu tomorrow source ${index}`]);
  core.close();
  const outputs = [];
  for (const option of [{}, { navigationLabelPolicy: 'rare-query-window-v1' }]) {
    const instance = model();
    core = openMemoryCore({ path, ...policy, ...option, model: instance });
    const result = ok(await core.recall({ readSet: [ns], query: anchor }));
    outputs.push({ result, calls: instance.calls, pages: instance.pages });
    core.close();
  }
  assert.equal(JSON.stringify(outputs[0]), JSON.stringify(outputs[1]), 'same store, non-source output/request/cursor bytes');
  assert.equal(outputs[0].calls.filter(call => call.stage === 'rank').length, 1);
});

test('G2 excluded source rows never enter DF; eligible corruption and epoch changes fail closed', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-rare-boundary-' });
  const path = join(workspace.path, 'memory.sqlite');
  const instance = model();
  const core = openMemoryCore({ path, ...policy, navigationLabelPolicy: 'rare-query-window-v1', model: instance });
  workspace.defer(() => core.close());
  const current = admit(core, 'Kivu interpretation', [anchor]);
  admit(core, 'FOREIGN_PRIVATE', ['FOREIGN_PRIVATE'], { ...ns, ownerId: 'foreign' });
  const forgotten = admit(core, 'FORGOTTEN_PRIVATE', ['FORGOTTEN_PRIVATE']);
  ok(core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  const historical = admit(core, 'HISTORICAL_PRIVATE', ['HISTORICAL_PRIVATE']);
  ok(core.supersede({ namespace: ns, memoryId: historical.id, expectedRevision: historical.revision,
    replacement: { content: 'current replacement', kind: 'context' }, receipts: [{ client: 'synthetic',
      sessionId: 'owned', eventId: 'replacement', role: 'user', excerpt: 'current replacement' }] }));
  const excluded = admit(core, 'PROJECTION_PRIVATE', ['PROJECTION_PRIVATE']);
  const epoch = ok(core.map({ namespace: ns })).indexRevision;
  let rebuild = ok(core.rebuildIndex({ namespace: ns, expectedIndexRevision: epoch, limit: 1 }));
  while (!rebuild.exhausted) rebuild = ok(core.rebuildIndex({ namespace: ns, expectedIndexRevision: epoch, limit: 1, cursor: rebuild.nextCursor }));
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  db.prepare('DELETE FROM index_memories WHERE id=?').run(excluded.id);
  const runtime = createMemoryRuntime({ path });
  workspace.defer(() => runtime.close());
  let documents, labelCalls = 0;
  const input = { score: createQueryScore(anchor), memoryLabel: createQueryExcerpt(anchor),
    sourceReceiptLimit: 4, sourceCandidatePolicy: 'bounded-keyset-v1',
    rareLabels: value => { labelCalls++; documents = value; return createRareQueryLabels(anchor)(value); } };
  const boundary = { ...ns, projectId: '' };
  const page = runtime.queryCandidateRows(boundary, input);
  assert.equal(documents.length, 2);
  assert.equal(JSON.stringify(documents).includes('PRIVATE'), false);
  assert.equal(page.rows.length, 2);
  const receipt = db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY id LIMIT 1').get(current.id);
  db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run('corrupt', receipt.id);
  const previousCalls = labelCalls;
  assert.throws(() => runtime.queryCandidateRows(boundary, input), { code: 'storage_error' });
  assert.equal(labelCalls, previousCalls, 'label callback not reached on corruption');
  db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run(anchor, receipt.id);
  let revoked = false;
  instance.countTokens = text => {
    const count = countOpenAITokens(text);
    if (!revoked && text.includes('"nextCursor"') && text.includes('"label"')) {
      revoked = true;
      ok(core.forget({ namespace: ns, memoryId: current.id, expectedRevision: current.revision }));
    }
    return count;
  };
  return core.recall({ readSet: [ns], query: anchor, contextMode: 'source-evidence' }).then(result => {
    assert.equal(revoked, true);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'index_revision_conflict');
    assert.equal(instance.calls.length, 0);
  });
});

test('G4 bounded 200/1024 top pools retain raw CPU/memory counts; fifth receipt and pruned row never enter DF', t => {
  for (const count of [200, 1024]) {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-rare-measure-' });
    const path = join(workspace.path, 'memory.sqlite');
    const core = openMemoryCore({ path });
    workspace.defer(() => core.close());
    const db = new DatabaseSync(path);
    workspace.defer(() => db.close());
    const insert = db.prepare(`INSERT INTO memories
      (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
       deleted,created_at,updated_at,filing_status,currentness)
      VALUES (?,?,'personal','',?,?,'context','explicit',1,1,0,'2026-01-01','2026-01-01','unfiled','current')`);
    const add = db.prepare(`INSERT INTO receipts
      (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES (?,?,?,'synthetic','owned',?,'user',?,'2026-01-01')`);
    db.exec('BEGIN');
    const admittedRows = count === 1024 ? count + 1 : count;
    for (let index = 0; index < admittedRows; index++) {
      const id = `measure-${index.toString().padStart(4, '0')}`;
      const content = index === count ? 'PRUNED Kivu' : `${common} body ${index}`;
      insert.run(id, ns.ownerId, `fingerprint-${index}`, content);
      for (let receipt = 0; receipt < 5; receipt++) {
        const eventId = `${id}-${receipt}`;
        const excerpt = receipt === 4 ? 'FIFTH Kivu tomorrow' : index === count ? 'PRUNED Kivu' : `${common} retained ${receipt}`;
        const source = { client: 'synthetic', sessionId: 'owned', eventId, role: 'user', excerpt };
        add.run(eventId, id, receiptKey(source), eventId, excerpt);
      }
    }
    db.exec('COMMIT');
    const runtime = createMemoryRuntime({ path });
    workspace.defer(() => runtime.close());
    let oldLabelCalls = 0;
    const oldLabel = createQueryExcerpt(query);
    const input = { score: createQueryScore(query), memoryLabel: text => { oldLabelCalls++; return oldLabel(text); },
      sourceReceiptLimit: 4, sourceCandidatePolicy: 'bounded-keyset-v1' };
    const baselineStart = performance.now();
    const baseline = runtime.queryCandidateRows({ ...ns, projectId: '' }, input);
    const baselineElapsedMs = performance.now() - baselineStart;
    oldLabelCalls = 0;
    let poolCount = 0, sources = 0, units = 0;
    const before = process.memoryUsage(), cpu = process.cpuUsage(), started = performance.now();
    const improved = runtime.queryCandidateRows({ ...ns, projectId: '' }, { ...input, rareLabels: documents => {
      poolCount = documents.length;
      sources = documents.reduce((sum, texts) => sum + texts.length, 0);
      units = documents.flat().reduce((sum, text) => sum + text.length, 0);
      assert.equal(JSON.stringify(documents).includes('FIFTH'), false);
      if (count === 1024) assert.equal(JSON.stringify(documents).includes('PRUNED'), false);
      return createRareQueryLabels(query)(documents);
    } });
    const elapsedMs = performance.now() - started, cpuUsed = process.cpuUsage(cpu), after = process.memoryUsage();
    const expected = count;
    assert.equal(poolCount, expected);
    assert.equal(sources, expected * 5);
    assert.equal(oldLabelCalls, 0, 'rare path never computes discarded legacy windows');
    assert.deepEqual(improved.rows.map(row => ref(row.item)), baseline.rows.map(row => ref(row.item)));
    t.diagnostic(JSON.stringify({ synthetic: true, node: process.version, admittedRows,
      topMemories: poolCount, textSources: sources, utf16Units: units, baselineElapsedMs, elapsedMs,
      cpuUserMicros: cpuUsed.user, cpuSystemMicros: cpuUsed.system,
      heapUsedBefore: before.heapUsed, heapUsedAfter: after.heapUsed, rssBefore: before.rss, rssAfter: after.rss }));
  }
});

test('G5 owned workspace removes successful and failed option setup', async () => {
  for (const fail of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'cairn-rare-cleanup-' });
    try {
      if (fail) assert.throws(() => openMemoryCore({ path: join(workspace.path, 'store.sqlite'),
        navigationLabelPolicy: 'invalid' }), { code: 'invalid_input' });
      else {
        const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), ...policy,
          navigationLabelPolicy: 'rare-query-window-v1' });
        workspace.defer(() => core.close());
      }
    } finally { await workspace.cleanup(); }
    assert.equal(existsSync(workspace.path), false);
  }
});

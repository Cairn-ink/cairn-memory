import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { recallMemories } from '../recall.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';

const personal = { ownerId: 'continuation', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'project' };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
const memoryRef = (memory) => ({ memoryId: memory.id, revision: memory.revision });
const visible = (input) => input.maps.flatMap(({ namespaceIndex, items }) => items.flatMap((item) => {
  const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
    ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
  return ref ? [{ namespaceIndex, ...ref }] : [];
}));
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(({ namespaceIndex, memory }) =>
  ({ namespaceIndex, ...memoryRef(memory) })) });
function fixture(t, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-continuation-')), 'memory.sqlite');
  // Synthetic counting isolates deterministic page/control bounds, not provider token quality.
  const model = createMockRecallModel({ countTokens: () => 1,
    select: [({ input }) => ({ refs: visible(input).slice(0, 1) }), { refs: [] }], rank: [rank], ...options });
  const core = openMemoryCore({ path, model });
  t.after(() => core.close());
  return { core, path, model };
}
function admit(core, content, namespace = personal, sources = 1) {
  let memory;
  for (let i = 0; i < sources; i += 4) memory = ok(core.admit({ namespace, memory: { content, kind: 'fact' },
    receipts: Array.from({ length: Math.min(4, sources - i) }, (_, j) => ({ client: 'test', sessionId: 'session',
      eventId: `${content}-${i + j}`, role: 'user', excerpt: `Evidence ${i + j}` })),
  })).memory;
  return memory;
}
const seed = (core, namespace, count) => Array.from({ length: count }, (_, i) => admit(core, `Note ${i}`, namespace));
const recall = (core, readSet = [personal]) => core.recall({ readSet, query: 'Synthetic continuation', limit: 12 });
const secondPage = (core, namespace) => {
  const first = ok(core.map({ namespace, purpose: 'recall' }));
  assert.ok(first.nextCursor);
  return ok(core.map({ namespace, purpose: 'recall', cursor: first.nextCursor }));
};

// Authoritative integration tests below call the public SQLite facade.
test('T01: both namespace second pages are reachable with original namespace indices', async (t) => {
  for (const readSet of [[personal, project], [project, personal]]) {
    const f = fixture(t, { select: [{ refs: [] }, ({ input }) => ({ refs: visible(input).slice(0, 2) })] });
    for (const ns of readSet) seed(f.core, ns, 101);
    const expected = readSet.flatMap((ns, namespaceIndex) => visible({ maps: [{ namespaceIndex, ...secondPage(f.core, ns) }] }));
    const result = ok(await recall(f.core, readSet));
    assert.deepEqual(result.memories.map(({ memory }) => memory.id), expected.map((ref) => ref.memoryId));
    assert.deepEqual(result.memories.map(({ memory }) => memory.namespace), readSet);
    assert.deepEqual(f.model.calls.map((call) => call.method), ['select', 'select', 'rank']);
    assert.deepEqual(f.model.calls.slice(0, 2).map((call) => call.input.maxRefs), [24, 24]);
    assert.equal(result.coverage, 'complete');
  }
});

test('T01/T04: exhausted namespace is absent from round two; empty coverage follows last pages', async (t) => {
  for (const remaining of [101, 201]) {
    const { core, model } = fixture(t, { select: [{ refs: [] }, { refs: [] }] });
    admit(core, 'Only personal item'); seed(core, project, remaining);
    const result = ok(await recall(core, [personal, project]));
    assert.deepEqual(model.calls.map((call) => call.method), ['select', 'select']);
    assert.deepEqual(model.calls[1].input.maps.map((map) => map.namespaceIndex), [1]);
    assert.deepEqual(result.memories, []);
    assert.deepEqual(result.namespaces.map(({ mapExhausted, fetchExhausted }) => [mapExhausted, fetchExhausted]),
      [[true, true], [remaining === 101, true]]);
    assert.equal(result.coverage, remaining === 101 ? 'complete' : 'budget_exhausted');
  }
});

test('T02: round two rejects old-page, foreign, group, duplicate and excessive refs without writes', async (t) => {
  for (const kind of ['old', 'foreign', 'group', 'duplicate', 'namespace-cap', 'round-cap']) {
    let old;
    let foreign;
    let group;
    const { core, path } = fixture(t, { select: [({ input }) => {
      old = visible(input)[0];
      return { refs: kind === 'round-cap' ? input.maps.flatMap((map) => visible({ maps: [map] }).slice(0, 12)) : [] };
    }, ({ input }) => {
      const refs = visible(input);
      if (kind === 'old') return { refs: [old] };
      if (kind === 'foreign') return { refs: [{ namespaceIndex: 0, ...memoryRef(foreign) }] };
      if (kind === 'group') return { refs: [{ namespaceIndex: 0, memoryId: group.id, revision: group.revision }] };
      if (kind === 'duplicate') return { refs: [refs[0], refs[0]] };
      if (kind === 'namespace-cap') return { refs: refs.filter((ref) => ref.namespaceIndex === 0).slice(0, 13) };
      assert.equal(input.maxRefs, 12);
      return { refs: [...refs.filter((ref) => ref.namespaceIndex === 0).slice(0, 7),
        ...refs.filter((ref) => ref.namespaceIndex === 1).slice(0, 6)] };
    }] });
    seed(core, personal, 114); seed(core, project, 114);
    foreign = admit(core, 'Foreign evidence', { ...personal, ownerId: 'foreign' });
    if (kind === 'group') {
      const memory = admit(core, 'Filed evidence');
      group = ok(core.applyPlacement({ namespace: personal,
        proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: 'Actual group', parentL2Ids: [] } }] },
        expectedMemoryRevisions: [memoryRef(memory)],
        expectedIndexRevision: ok(core.map({ namespace: personal })).indexRevision })).createdMocs[0];
    }
    const db = new DatabaseSync(path); t.after(() => db.close());
    const snapshot = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
    const before = snapshot();
    error(await recall(core, [personal, project]), 'invalid_model_output');
    assert.deepEqual(snapshot(), before);
  }
});

test('T04: public recall returns exact contiguous two-page evidence prefix, including 200 receipt ceiling', async (t) => {
  for (const sources of [101, 200, 201]) {
    const { core } = fixture(t);
    const memory = admit(core, `Sources ${sources}`, personal, sources);
    const first = ok(core.fetch({ namespace: personal, refs: [memoryRef(memory)] }));
    const second = ok(core.fetch({ namespace: personal, refs: [memoryRef(memory)], cursor: first.nextCursor }));
    const expected = [...first.items[0].receipts, ...second.items[0].receipts];
    const result = ok(await recall(core));
    assert.equal(result.memories[0].receiptCount, sources);
    assert.equal(result.memories[0].receipts.length, Math.min(200, sources));
    assert.deepEqual(result.memories[0].receipts, expected);
    assert.equal(new Set(expected.map((receipt) => receipt.id)).size, expected.length);
    assert.equal(result.namespaces[0].fetchExhausted, sources <= 200);
    assert.equal(result.coverage, sources <= 200 ? 'complete' : 'budget_exhausted');
  }
});

test('T05: accumulated ranking overflow cannot silently drop candidates or receipts', async (t) => {
  const { core, model } = fixture(t, { countTokens: (text) => {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed?.input?.candidates?.[0]?.receipts.length > 100) return 6001;
    return 1;
  } });
  admit(core, 'Accumulated evidence', personal, 101);
  error(await recall(core), 'context_budget_exceeded');
  assert.deepEqual(model.calls.map((call) => call.method), ['select']);
});

test('T05: second selection request/output/counter/deadline failures keep explicit envelopes', async (t) => {
  for (const failure of ['request', 'output', 'counter', 'deadline']) {
    let model;
    const f = fixture(t, { select: [{ refs: [] }, () => {
      if (failure === 'deadline') throw Object.assign(new Error('scripted timeout'), { code: 'model_timeout' });
      return { refs: [] };
    }], countTokens: (text) => {
      if (!model || model.calls.length === 0) return 1;
      const parsed = text ? JSON.parse(text) : null;
      if (failure === 'request' && parsed?.input?.maps) return 6001;
      if (model.calls.length === 2 && parsed?.refs) return failure === 'counter' ? NaN : failure === 'output' ? 1025 : 1;
      return 1;
    } });
    model = f.model; seed(f.core, personal, 101);
    error(await recall(f.core), { request: 'context_budget_exceeded', output: 'invalid_model_output',
      counter: 'token_count_unavailable', deadline: 'model_timeout' }[failure]);
    assert.ok(model.calls.every((call) => call.method === 'select'));
  }
});

test('T06: another connection mutating during either selection round never emits stale evidence', async (t) => {
  for (const round of [1, 2]) for (const action of ['correct', 'forget']) {
    let other;
    const mutate = ({ input }) => {
      const selected = visible(input)[0];
      if (action === 'forget') ok(other.forget({ namespace: personal, memoryId: selected.memoryId, expectedRevision: selected.revision }));
      else ok(other.correct({ namespace: personal, memoryId: selected.memoryId, expectedRevision: selected.revision,
        content: 'Corrected evidence', kind: 'fact', receipt: { client: 'test', sessionId: 's', eventId: 'correct', role: 'user', excerpt: 'Correction' } }));
      return { refs: [selected] };
    };
    const { core, path } = fixture(t, { select: round === 1 ? [mutate, { refs: [] }] : [{ refs: [] }, mutate] });
    seed(core, personal, 101);
    other = openMemoryCore({ path }); t.after(() => other.close());
    const result = await recall(core);
    assert.equal(result.ok, false);
    assert.ok(['cursor_stale', 'revision_conflict'].includes(result.error.code), JSON.stringify(result));
    assert.deepEqual(Object.keys(result), ['ok', 'error']);
  }
});

test('T06: receipt-continuation counter mutation propagates freshness failure without payload', async (t) => {
  const { core, path, model } = fixture(t);
  const memory = admit(core, 'Continuation race', personal, 101);
  const other = openMemoryCore({ path }); t.after(() => other.close());
  let pages = 0;
  model.countTokens = (text) => {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed?.value?.items?.[0]?.receipts && ++pages === 2)
      ok(other.forget({ namespace: personal, memoryId: memory.id, expectedRevision: memory.revision }));
    return 1;
  };
  error(await recall(core), 'index_revision_conflict');
  assert.equal(pages, 2);
});

test('T06: all fetched candidates are checked after rank and its final output counter, including unranked round-two refs', async (t) => {
  for (const phase of ['rank', 'counter']) for (const action of ['correct', 'forget']) {
    let other;
    let unranked;
    let changed = false;
    const mutate = () => {
      if (changed) return;
      changed = true;
      if (action === 'forget') ok(other.forget({ namespace: personal, memoryId: unranked.id, expectedRevision: unranked.revision }));
      else ok(other.correct({ namespace: personal, memoryId: unranked.id, expectedRevision: unranked.revision,
        content: 'Replacement', kind: 'fact', receipt: { client: 'test', sessionId: 's', eventId: 'replacement', role: 'user', excerpt: 'Replacement' } }));
    };
    const { core, path, model } = fixture(t, {
      select: [({ input }) => ({ refs: visible(input).slice(0, 1) }), ({ input }) => ({ refs: visible(input).slice(0, 1) })],
      rank: [({ input }) => {
        assert.equal(input.candidates.length, 2);
        unranked = input.candidates[1].memory;
        if (phase === 'rank') mutate();
        // Deliberately change model copies too; none may become authoritative.
        input.candidates[0].memory.content = 'Fabricated content';
        input.candidates[0].receipts[0].excerpt = 'Fabricated receipt';
        return rank({ input: { ...input, limit: 1 } });
      }],
    });
    seed(core, personal, 101);
    other = openMemoryCore({ path }); t.after(() => other.close());
    model.countTokens = (text) => {
      if (phase === 'counter' && unranked && text.startsWith('{"refs":')) mutate();
      return 1;
    };
    error(await recall(core), 'revision_conflict');
    assert.equal(changed, true);
  }
});

// Orchestration seam tests wrap real public SQLite map/fetch operations. Their
// finalize callback records inputs; authoritative rereading is tested above.
function orchestration(core, model, readSet, hooks = {}) {
  const maps = [];
  const fetches = [];
  let finalized;
  const pending = recallMemories({ model, readSet, query: 'Bounds', limit: 12,
    map: (input) => { maps.push(structuredClone(input)); return core.map(input); },
    fetch: (input) => { fetches.push(structuredClone(input)); const result = core.fetch(input);
      return hooks.fetch ? hooks.fetch(result, input, fetches.length) : result; },
    finalize: (candidates, selected) => { finalized = { candidates, selected }; return selected.map((i) => candidates[i].item); },
  });
  return { pending, maps, fetches, finalized: () => finalized };
}

test('T03 seam: four map pages, three model calls, 36 unique candidates and 72 singleton fetches', async (t) => {
  const select = ({ input }) => ({ refs: input.maps.flatMap((map) => visible({ maps: [map] })
    .slice(0, input.maxRefs === 24 ? 12 : 6)) });
  const { core, model } = fixture(t, { select: [select, select] });
  for (const ns of [personal, project]) {
    seed(core, ns, 106);
    const first = ok(core.map({ namespace: ns, purpose: 'recall' }));
    const second = secondPage(core, ns);
    const selected = [...first.items.slice(0, 12), ...second.items.slice(0, 6)];
    for (const item of selected) {
      const memory = ok(core.get({ namespace: ns, memoryId: item.ref.memoryId })).memory;
      admit(core, memory.content, ns, 101);
    }
  }
  const run = orchestration(core, model, [personal, project]);
  await run.pending;
  assert.equal(run.maps.length, 4);
  assert.deepEqual(model.calls.map((call) => call.method), ['select', 'select', 'rank']);
  assert.deepEqual(model.calls.slice(0, 2).map((call) => call.input.maxRefs), [24, 12]);
  assert.equal(model.calls[2].input.candidates.length, 36);
  assert.equal(run.fetches.length, 72);
  const byRef = new Map();
  for (const input of run.fetches) {
    assert.equal(input.refs.length, 1);
    const key = JSON.stringify([input.namespace, input.refs]);
    const pages = byRef.get(key) ?? []; pages.push(input); byRef.set(key, pages);
  }
  assert.equal(byRef.size, 36);
  for (const pages of byRef.values()) {
    assert.equal(pages.length, 2); assert.equal(pages[0].cursor, undefined); assert.ok(pages[1].cursor);
    assert.equal(pages[0].tokenBudget, pages[1].tokenBudget);
  }
  assert.equal(run.finalized().candidates.length, 36);
  assert.ok(run.finalized().candidates.every((candidate) => candidate.item.receipts.length === 101));
});

test('T03 seam: a memory under multiple parents across map pages is fetched and ranked once', async (t) => {
  const { core, model } = fixture(t, { countTokens: (text) => {
    const parsed = text ? JSON.parse(text) : null;
    // Force a real token-bounded map split after two group rows and one ref.
    return parsed?.value?.items?.[0]?.type && parsed.value.items.length > 3 ? 4001 : 1;
  }, select: [({ input }) => ({ refs: [...new Map(visible(input)
    .map((ref) => [ref.memoryId, ref])).values()] }), ({ input }) => ({ refs: visible(input) })] });
  const memory = admit(core, 'Shared parent memory');
  let revision = memory.revision;
  const parents = [];
  for (let i = 0; i < 2; i++) {
    const applied = ok(core.applyPlacement({ namespace: personal,
      proposal: { items: [{ memoryId: memory.id, parentIds: parents, newL1: { title: `Topic ${String(i).padStart(3, '0')}`, parentL2Ids: [] } }] },
      expectedMemoryRevisions: [{ memoryId: memory.id, revision }],
      expectedIndexRevision: ok(core.map({ namespace: personal })).indexRevision }));
    parents.push(applied.createdMocs[0].id); revision = applied.memories[0].revision;
  }
  const run = orchestration(core, model, [personal]);
  const result = await run.pending;
  assert.equal(run.maps.length, 2);
  assert.equal(run.fetches.length, 1);
  assert.equal(model.calls[2].input.candidates.length, 1);
  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].memory.id, memory.id);
});

test('T04 seam: trusted continuation duplicate receipt or identity mismatch fails revision_conflict', async (t) => {
  for (const kind of ['receipt', 'memory', 'revision']) {
    const { core, model } = fixture(t);
    admit(core, 'Page integrity', personal, 101);
    let first;
    const run = orchestration(core, model, [personal], { fetch: (response, input) => {
      const page = ok(response);
      if (!input.cursor) first = page.items[0];
      else if (kind === 'receipt') page.items[0].receipts[0] = first.receipts[0];
      else if (kind === 'memory') page.items[0].memory.id = 'different-memory';
      else page.items[0].memory.revision++;
      return response;
    } });
    await assert.rejects(run.pending, (err) => err.code === 'revision_conflict');
    assert.equal(run.finalized(), undefined);
  }
});

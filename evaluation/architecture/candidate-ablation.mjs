import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/contract.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export const FIXTURE = deepFreeze(JSON.parse(readFileSync(new URL('./candidate-ablation-fixtures.json', import.meta.url), 'utf8')));
const RETRIEVAL = deepFreeze({ topK: FIXTURE.topK, materializationCap: FIXTURE.materializationCap,
  branchCap: FIXTURE.branchCap, branchSlots: FIXTURE.branchSlots,
  fallbackSlots: FIXTURE.fallbackSlots, aliases: FIXTURE.aliases });
const namespace = Object.freeze({ ownerId: 'candidate-ablation', scope: 'personal', projectId: null });
const foreignNamespace = Object.freeze({ ...namespace, ownerId: 'candidate-ablation-foreign' });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const unique = (values) => [...new Set(values)];
const words = (text) => [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0].toLowerCase());
const LIMITS = Object.freeze({ mapPages: 32, mapRows: 1600, receipts: 4 });

function receipt(key, text) {
  return { client: 'ablation', sessionId: 'synthetic', eventId: key, role: 'user', excerpt: text };
}

function admit(core, key, content, ns = namespace) {
  return ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(key, content)] })).memory;
}

function scriptedModel() {
  const calls = { select: 0, rank: 0, visible: 0, fetched: 0 };
  return { calls, contextWindow: 8192, countTokens: () => 1,
    async select({ input }) {
      calls.select++;
      const visible = input.maps.flatMap((map) => map.items.flatMap((item) => {
        if (item.type === 'unfiled') return [{ namespaceIndex: map.namespaceIndex, ...item.ref }];
        if (item.type === 'ref' && item.ref.childType === 'memory') return [{ namespaceIndex: map.namespaceIndex,
          memoryId: item.ref.childId, revision: item.ref.childRevision }];
        return [];
      }));
      calls.visible += visible.length;
      return { refs: visible.slice(0, 12) };
    },
    async rank({ input }) {
      calls.rank++;
      calls.fetched += input.candidates.length;
      return { refs: input.candidates.slice(0, input.limit).map((candidate) => ({
        namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
        revision: candidate.memory.revision,
      })) };
    } };
}

function place(core, memory, topic, topics) {
  const indexRevision = ok(core.map({ namespace, purpose: 'classification' })).indexRevision;
  const item = topics.has(topic)
    ? { memoryId: memory.id, parentIds: [topics.get(topic)] }
    : { memoryId: memory.id, parentIds: [], newL1: { title: topic, parentL2Ids: [] } };
  const value = ok(core.applyPlacement({ namespace, proposal: { items: [item] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }], expectedIndexRevision: indexRevision }));
  if (!topics.has(topic)) {
    const made = value.createdMocs.find((moc) => moc.level === 'L1');
    assert.ok(made);
    topics.set(topic, made.id);
  }
}

export function buildSyntheticCore(config = FIXTURE) {
  assert.equal(config.version, 'candidate-retrieval-ablation-v2');
  const model = scriptedModel();
  const core = openMemoryCore({ path: ':memory:', model });
  try {
    const ids = new Map();
    const bank = [];
    for (let i = 0; i < config.bankCount; i++) {
      bank.push(admit(core, `bank-${i}`, `Synthetic index filler ${String(i).padStart(4, '0')} plain note.`));
    }
    const tail = [...bank].sort((a, b) => b.id.localeCompare(a.id))[0];
    const correctedTail = ok(core.correct({ namespace, memoryId: tail.id,
      expectedRevision: tail.revision, content: 'The zirconium sextant is in a plain note.',
      kind: 'fact', receipt: receipt('tail-correction', 'The zirconium sextant is in a plain note.') })).memory;
    ids.set('tail', correctedTail.id);
    const topics = new Map();
    for (const row of config.special) {
      const ns = row.key === 'foreign' ? foreignNamespace : namespace;
      const memory = admit(core, row.key, row.content, ns);
      ids.set(row.key, memory.id);
      if (row.key !== 'foreign') place(core, memory, row.topic, topics);
      if (row.key === 'deleted') ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: 2 }));
      if (row.key === 'corrected') ok(core.correct({ namespace, memoryId: memory.id,
        expectedRevision: 2, content: 'The revised teal timetable is current.',
        kind: 'fact', receipt: receipt('corrected-new', 'The revised teal timetable is current.') }));
      if (row.key === 'historical') ok(core.supersede({ namespace, memoryId: memory.id,
        expectedRevision: 2, replacement: { content: 'The current silver rota is active.', kind: 'fact' },
        receipts: [receipt('historical-new', 'The current silver rota is active.')] }));
    }
    return { core, model, ids };
  } catch (error) { core.close(); throw error; }
}

// Public map is the eligibility authority. Get is used only after a current map
// reference, and any ambiguous/incomplete projection aborts the whole index.
export function projectCurrent(core) {
  const began = performance.now();
  const refs = new Map();
  const recordRef = (id, revision) => {
    const previous = refs.get(id);
    assert.ok(previous === undefined || previous === revision, 'conflicting map revisions');
    refs.set(id, revision);
  };
  const mocs = new Map();
  const topicById = new Map();
  let cursor;
  let pageCount = 0;
  let mapRows = 0;
  let invalidRefs = 0;
  while (true) {
    assert.ok(++pageCount <= LIMITS.mapPages, 'map page cap exhausted');
    const page = ok(core.map({ namespace, purpose: 'recall', limit: 100, tokenBudget: 4000,
      ...(cursor ? { cursor } : {}) }));
    mapRows += page.items.length;
    invalidRefs += page.invalidRefs.length;
    assert.ok(mapRows <= LIMITS.mapRows, 'map row cap exhausted');
    for (const item of page.items) {
      if (item.type === 'moc') mocs.set(item.moc.id, item.moc);
      else if (item.type === 'unfiled') recordRef(item.ref.memoryId, item.ref.revision);
      else if (item.type === 'ref' && item.ref.childType === 'memory') {
        recordRef(item.ref.childId, item.ref.childRevision);
        const parents = topicById.get(item.ref.childId) ?? new Set();
        parents.add(item.ref.parentId);
        topicById.set(item.ref.childId, parents);
      }
    }
    if (page.exhausted) { assert.equal(page.nextCursor, null); break; }
    assert.ok(page.nextCursor && page.nextCursor !== cursor, 'map failed to progress');
    cursor = page.nextCursor;
  }
  assert.equal(invalidRefs, 0, 'invalid map refs prevent complete projection');
  const projected = [];
  for (const [id, revision] of refs) {
    const detail = ok(core.get({ namespace, memoryId: id, receiptLimit: LIMITS.receipts }));
    assert.equal(detail.memory.revision, revision, 'map/get revision mismatch');
    assert.equal(detail.memory.state, 'active', 'noncurrent map reference prevents complete projection');
    assert.ok(detail.exhausted && detail.receipts.length >= 1, 'source projection incomplete');
    const topics = [...(topicById.get(id) ?? [])].map((mocId) => {
      const moc = mocs.get(mocId);
      assert.ok(moc && moc.level === 'L1' && typeof moc.title === 'string', 'unresolved MOC title');
      return { key: mocId, title: moc.title };
    });
    projected.push({ id, revision, content: detail.memory.content,
      source: detail.receipts.map((r) => r.excerpt).join(' '), topics });
  }
  return { rows: projected, metrics: { mapPages: pageCount, mapRows, eligibleRefs: refs.size,
    rowsIndexed: projected.length, sourceReads: refs.size, buildMs: Math.round(performance.now() - began) } };
}

function queryTerms(query, aliasesOn, aliases) {
  const terms = new Set(words(query));
  if (aliasesOn) for (const pair of aliases) if (pair.some((term) => terms.has(term))) {
    for (const term of pair) terms.add(term);
  }
  return [...terms].map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}

export function buildIndexes(projection) {
  const began = performance.now();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE VIRTUAL TABLE docs USING fts5(content, source, topic, topic_key UNINDEXED, tokenize='unicode61')");
    db.exec("CREATE VIRTUAL TABLE branches USING fts5(title, branch_key UNINDEXED, tokenize='unicode61')");
    const insert = db.prepare('INSERT INTO docs(rowid,content,source,topic,topic_key) VALUES (?,?,?,?,?)');
    const insertBranch = db.prepare('INSERT INTO branches(rowid,title,branch_key) VALUES (?,?,?)');
    const ids = new Map();
    const branchRows = new Map();
    let ordinal = 0;
    for (const row of projection.rows) {
      const title = row.topics.map((topic) => topic.title).join(' ');
      const key = row.topics.map((topic) => topic.key).join(' ');
      insert.run(++ordinal, row.content, row.source, title, key);
      ids.set(ordinal, row.id);
      for (const topic of row.topics) branchRows.set(topic.key, topic.title);
    }
    let branchOrdinal = 0;
    const branches = new Map();
    for (const [key, title] of branchRows) {
      insertBranch.run(++branchOrdinal, title, key);
      branches.set(branchOrdinal, key);
    }
    const global = db.prepare('SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY bm25(docs), rowid LIMIT ?');
    const branch = db.prepare("SELECT rowid FROM docs WHERE docs MATCH ? AND instr(' ' || topic_key || ' ', ' ' || ? || ' ') > 0 ORDER BY bm25(docs), rowid LIMIT ?");
    const route = db.prepare('SELECT rowid FROM branches WHERE branches MATCH ? ORDER BY bm25(branches), rowid LIMIT ?');
    return { db, ids, branches, global, branch, route,
      buildMs: Math.round(performance.now() - began), rowsIndexed: ordinal,
      branchesIndexed: branchRows.size, close() { db.close(); } };
  } catch (error) { db.close(); throw error; }
}

export function retrieve(index, query, options) {
  assert.deepEqual(Object.keys(options).sort(), ['aliasesOn', 'routing'], 'retrieval options must exclude labels');
  const { routing, aliasesOn } = options;
  assert.equal(typeof routing, 'boolean');
  assert.equal(typeof aliasesOn, 'boolean');
  const began = performance.now();
  const expression = queryTerms(query, aliasesOn, RETRIEVAL.aliases);
  const counts = { routedBranches: 0, branchMaterialized: 0, fallbackMaterialized: 0,
    materialized: 0, sqliteQueries: 0, routeCapReached: false, branchCapReached: false,
    fallbackCapReached: false, capReached: false };
  if (!expression) return { ids: [], counts, queryMs: Math.round(performance.now() - began) };
  const globalLimit = routing ? 8 : RETRIEVAL.materializationCap;
  const globalRows = index.global.all(expression, globalLimit);
  counts.sqliteQueries++;
  let ranked;
  if (!routing) {
    ranked = globalRows.map((row) => row.rowid);
    counts.fallbackMaterialized = globalRows.length;
    counts.materialized = globalRows.length;
    counts.fallbackCapReached = globalRows.length === globalLimit;
    counts.capReached = counts.fallbackCapReached;
  } else {
    const routeRows = index.route.all(expression, RETRIEVAL.branchCap);
    counts.sqliteQueries++;
    counts.routedBranches = routeRows.length;
    counts.routeCapReached = routeRows.length === RETRIEVAL.branchCap;
    const branchRows = [];
    for (const row of routeRows) {
      const selected = index.branch.all(expression, index.branches.get(row.rowid), 8);
      counts.sqliteQueries++;
      counts.branchMaterialized += selected.length;
      counts.branchCapReached ||= selected.length === 8;
      branchRows.push(...selected.map((item) => item.rowid));
    }
    counts.fallbackMaterialized = globalRows.length;
    counts.fallbackCapReached = globalRows.length === globalLimit;
    counts.materialized = counts.branchMaterialized + counts.fallbackMaterialized;
    assert.ok(counts.materialized <= RETRIEVAL.materializationCap, 'candidate cap exceeded');
    counts.capReached = counts.routeCapReached || counts.branchCapReached ||
      counts.fallbackCapReached || counts.materialized === RETRIEVAL.materializationCap;
    const local = unique(branchRows).slice(0, RETRIEVAL.branchSlots);
    const fallback = unique(globalRows.map((row) => row.rowid)).filter((id) => !local.includes(id));
    ranked = [...local, ...fallback.slice(0, RETRIEVAL.fallbackSlots)];
    if (ranked.length < RETRIEVAL.topK) ranked.push(...fallback.slice(RETRIEVAL.fallbackSlots,
      RETRIEVAL.fallbackSlots + RETRIEVAL.topK - ranked.length));
  }
  return { ids: unique(ranked).slice(0, RETRIEVAL.topK).map((rowid) => index.ids.get(rowid)), counts,
    queryMs: Math.round(performance.now() - began) };
}

export function scoreCase(expected, retrieved, ids) {
  const expectedIds = expected.map((key) => ids.get(key));
  assert.ok(expectedIds.every(Boolean), 'missing evaluator label');
  const hits = expectedIds.filter((id) => retrieved.includes(id)).length;
  return { expectedCount: expectedIds.length, retrievedCount: retrieved.length,
    hits, anyAt5: expectedIds.length ? hits > 0 : null,
    allAt5: expectedIds.length ? hits === expectedIds.length : null,
    falsePositives: expectedIds.length ? null : retrieved.length };
}

export async function runAblation() {
  const config = FIXTURE;
  const { core, model, ids } = buildSyntheticCore(config);
  let index;
  try {
    const projection = projectCurrent(core);
    const projectedIds = new Set(projection.rows.map((row) => row.id));
    for (const key of ['deleted', 'historical', 'foreign']) {
      assert.equal(projectedIds.has(ids.get(key)), false, 'lifecycle/namespace control entered current projection');
    }
    const corrected = projection.rows.find((row) => row.id === ids.get('corrected'));
    assert.ok(corrected && !`${corrected.content} ${corrected.source}`.includes('old copper'),
      'obsolete correction source entered current projection');
    index = buildIndexes(projection);
    const cases = [];
    for (const item of config.queries) {
      const before = { ...model.calls };
      const began = performance.now();
      const result = ok(await core.recall({ readSet: [namespace], query: item.query, limit: config.topK }));
      const baselineIds = result.memories.map((row) => row.memory.id);
      const baseline = { ...scoreCase(item.expected, baselineIds, ids),
        coverage: result.coverage, selectionVisible: model.calls.visible - before.visible,
        selectedFetched: model.calls.fetched - before.fetched,
        scriptedCalls: model.calls.select + model.calls.rank - before.select - before.rank,
        providerCalls: 0,
        queryMs: Math.round(performance.now() - began) };
      const cells = {};
      for (const routing of [false, true]) for (const aliasesOn of [false, true]) {
        const key = `${routing ? 'moc' : 'flat'}_${aliasesOn ? 'alias' : 'plain'}`;
        const found = retrieve(index, item.query, { routing, aliasesOn });
        cells[key] = { ...scoreCase(item.expected, found.ids, ids), ...found.counts,
          queryMs: found.queryMs, scriptedCalls: 0, providerCalls: 0 };
      }
      cases.push({ name: item.name, baseline, cells });
    }
    return { version: config.version, caps: { topK: config.topK, materialization: config.materializationCap,
      branches: config.branchCap, branchSlots: config.branchSlots, fallbackSlots: config.fallbackSlots },
      projection: projection.metrics,
      indexedBuild: { rowsIndexed: index.rowsIndexed, branchesIndexed: index.branchesIndexed,
        buildMs: index.buildMs },
      limitations: { tokenUsage: 'not_measured', sqliteInternalWork: 'unknown', modelQuality: 'scripted_only',
        indexLifecycle: 'full_rebuild' }, cases };
  } finally { index?.close(); core.close(); }
}

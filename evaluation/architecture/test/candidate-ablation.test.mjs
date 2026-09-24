import assert from 'node:assert/strict';
import test from 'node:test';
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 16);
const { FIXTURE, buildSyntheticCore, projectCurrent, buildIndexes, retrieve,
  runAblation, scoreCase } = supported ? await import('../candidate-ablation.mjs') : {};

const expected = (name) => FIXTURE.queries.find((item) => item.name === name);

test('frozen synthetic packet exposes actual prefix miss and bounded alternate reach', { skip: !supported }, async () => {
  const report = await runAblation();
  const past = report.cases.find((item) => item.name === 'past_prefix');
  assert.equal(past.baseline.anyAt5, false);
  assert.equal(past.baseline.coverage, 'budget_exhausted');
  assert.equal(past.baseline.selectionVisible, 200);
  assert.equal(past.cells.flat_plain.anyAt5, true);
  assert.equal(past.cells.moc_plain.anyAt5, true);
  assert.ok(report.projection.mapPages > 1);
  assert.equal(report.indexedBuild.rowsIndexed, report.projection.rowsIndexed);
  assert.ok(report.indexedBuild.rowsIndexed > 1024);
  for (const item of report.cases) for (const cell of Object.values(item.cells)) {
    assert.ok(cell.materialized <= FIXTURE.materializationCap);
    assert.ok(cell.retrievedCount <= FIXTURE.topK);
    assert.equal(cell.scriptedCalls, 0);
    assert.equal(cell.providerCalls, 0);
    assert.ok(cell.sqliteQueries >= 1);
  }
  const alias = report.cases.find((item) => item.name === 'alias_pure');
  assert.equal(alias.cells.flat_plain.anyAt5, false);
  assert.equal(alias.cells.flat_alias.anyAt5, true);
  assert.equal(alias.cells.moc_plain.anyAt5, false);
  assert.equal(alias.cells.moc_alias.anyAt5, true);
  const wrong = report.cases.find((item) => item.name === 'wrong_branch');
  assert.equal(wrong.cells.moc_plain.routedBranches, 1);
  assert.equal(wrong.cells.moc_plain.anyAt5, true);
  assert.ok(wrong.cells.moc_plain.fallbackMaterialized > 0);
  assert.equal(wrong.cells.moc_plain.sqliteQueries, 3);
  const unknown = report.cases.find((item) => item.name === 'unknown');
  assert.equal(unknown.cells.flat_plain.anyAt5, null);
  assert.equal(unknown.cells.flat_plain.falsePositives, unknown.cells.flat_plain.retrievedCount);
  const cjk = report.cases.find((item) => item.name === 'chinese_exact');
  assert.equal(cjk.cells.flat_plain.anyAt5, false); // retained unicode61 word-boundary failure
  assert.equal(report.limitations.tokenUsage, 'not_measured');
  assert.equal(JSON.stringify(report).includes('memoryId'), false);
  assert.equal(JSON.stringify(report).includes('zirconium sextant'), false);
});

test('current map projection removes lifecycle and foreign controls before both indexes', { skip: !supported }, () => {
  const { core, ids } = buildSyntheticCore();
  try {
    const projection = projectCurrent(core);
    const visible = new Set(projection.rows.map((row) => row.id));
    for (const key of ['deleted', 'historical', 'foreign']) assert.equal(visible.has(ids.get(key)), false);
    const corrected = projection.rows.find((row) => row.id === ids.get('corrected'));
    assert.ok(corrected);
    assert.equal(corrected.content.includes('old copper'), false);
    assert.equal(corrected.source.includes('old copper'), false);
    const index = buildIndexes(projection);
    try {
      for (const key of ['deleted', 'historical', 'foreign']) {
        const query = expected(`${key}_control`).query;
        for (const routing of [false, true]) for (const aliasesOn of [false, true]) {
          assert.equal(retrieve(index, query, { routing, aliasesOn }).ids.includes(ids.get(key)), false);
        }
      }
    } finally { index.close(); }
  } finally { core.close(); }
});

test('evaluator labels stay outside strategies and any/all separate partial evidence', { skip: !supported }, () => {
  const ids = new Map([['first', 'a'], ['second', 'b']]);
  assert.deepEqual(scoreCase(['first', 'second'], ['a'], ids), {
    expectedCount: 2, retrievedCount: 1, hits: 1, anyAt5: true, allAt5: false,
    falsePositives: null,
  });
  const { core } = buildSyntheticCore();
  try {
    const index = buildIndexes(projectCurrent(core));
    try {
      const query = expected('multiple_evidence').query;
      const bare = retrieve(index, query, { routing: false, aliasesOn: false });
      assert.throws(() => retrieve(index, query, { routing: false, aliasesOn: false,
        expected: ['impossible-label'] }), /retrieval options must exclude labels/);
      assert.equal(JSON.stringify(bare).includes('expected'), false);
    } finally { index.close(); }
  } finally { core.close(); }
});

test('projection fails closed on stale, historical, incomplete and invalid public pages', { skip: !supported }, () => {
  const { core, ids } = buildSyntheticCore();
  const changedMap = (change) => ({
    map(input) {
      const result = core.map(input);
      if (!result.ok || input.cursor) return result;
      return { ...result, value: change(structuredClone(result.value)) };
    },
    get: core.get,
  });
  const changedGet = (change) => ({
    map: core.map,
    get(input) {
      const result = core.get(input);
      return result.ok ? { ...result, value: change(structuredClone(result.value)) } : result;
    },
  });
  try {
    assert.throws(() => projectCurrent(changedMap((page) => {
      const ref = page.items.find((item) => item.type === 'ref' && item.ref.childType === 'memory');
      assert.ok(ref);
      ref.ref.childRevision++;
      return page;
    })), /map\/get revision mismatch/);
    assert.throws(() => projectCurrent(changedMap((page) => {
      const unfiledIndex = page.items.findIndex((item) => item.type === 'unfiled');
      const filed = page.items.find((item) => item.type === 'ref' && item.ref.childType === 'memory');
      assert.ok(unfiledIndex >= 0 && filed);
      const current = page.items[unfiledIndex].ref;
      page.items.splice(unfiledIndex, 0, { type: 'ref', ref: { ...filed.ref,
        childId: current.memoryId, childRevision: current.revision + 1 } });
      return page;
    })), /conflicting map revisions/);
    assert.throws(() => projectCurrent(changedMap((page) => {
      const historical = core.get({ namespace: { ownerId: 'candidate-ablation', scope: 'personal', projectId: null },
        memoryId: ids.get('historical') });
      assert.equal(historical.ok, true);
      page.items.push({ type: 'unfiled', ref: { memoryId: ids.get('historical'),
        revision: historical.value.memory.revision } });
      return page;
    })), /noncurrent map reference/);
    assert.throws(() => projectCurrent(changedMap((page) => {
      page.exhausted = false;
      page.nextCursor = null;
      return page;
    })), /map failed to progress/);
    assert.throws(() => projectCurrent(changedMap((page) => {
      page.invalidRefs.push({ reason: 'stale' });
      return page;
    })), /invalid map refs/);
    assert.throws(() => projectCurrent(changedGet((detail) => {
      detail.exhausted = false;
      return detail;
    })), /source projection incomplete/);
  } finally { core.close(); }
});

test('routing reports per-query caps even below the combined materialization cap', { skip: !supported }, () => {
  const row = (id, topic) => ({ id, revision: 1, content: 'amber field note',
    source: 'amber field note', topics: [{ key: topic, title: topic }] });
  const crowded = buildIndexes({ rows: Array.from({ length: 9 }, (_, i) => row(`row-${i}`, 'amber')) });
  try {
    const found = retrieve(crowded, 'amber', { routing: true, aliasesOn: false });
    assert.equal(found.counts.materialized, 16);
    assert.equal(found.counts.capReached, true);
    assert.equal(found.counts.branchCapReached, true);
    assert.equal(found.counts.fallbackCapReached, true);
    assert.equal(found.counts.routeCapReached, false);
    assert.equal(found.counts.sqliteQueries, 3);
    assert.equal(retrieve(crowded, 'amber', { routing: false, aliasesOn: false }).counts.capReached, false);
  } finally { crowded.close(); }
  const twoBranches = buildIndexes({ rows: [row('first', 'amber-a'), row('second', 'amber-b')] });
  try {
    const found = retrieve(twoBranches, 'amber', { routing: true, aliasesOn: false });
    assert.equal(found.counts.routeCapReached, true);
    assert.equal(found.counts.materialized, 4);
    assert.equal(found.counts.sqliteQueries, 4);
    assert.equal(found.counts.capReached, true);
  } finally { twoBranches.close(); }
});

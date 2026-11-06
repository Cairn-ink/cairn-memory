import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'map-binary-test', scope: 'personal', projectId: null };
const limits = [1, 2, 3, 7, 50, 100];
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const receipt = (eventId, excerpt = 'Synthetic fixture source') => ({
  client: 'map-binary-test', sessionId: 'fixture', eventId, role: 'user', excerpt,
});
const decode = cursor => JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url'));

// Frozen descending scan, kept ONLY in this test. Both implementations load the
// real contract, runtime, cursor codec, SQLite reads and caller-port fences.
const descendingScan = `      const capacity = Math.min(count, page.rows.length);
      for (let take = capacity; take >= 0; take--) {
        if (take === 0 && page.rows.length > 0) throw new MemoryStoreError('context_item_too_large');
        const selected = page.rows.slice(0, take);
        const pageEnded = take === page.rows.length;
        const exhausted = pageEnded && page.scanExhausted !== false;
        const value = { items: selected.filter((row) => row.item).map((row) => row.item),
          nextCursor: pageEnded ? null : encodeCursor({ ...binding, e: page.epoch, a: { offset: offset + take } }),
          exhausted, truncatedBy: exhausted ? null : take < capacity ? 'token_budget' : 'page_limit',
          indexRevision: page.epoch,
          invalidRefs: selected.filter((row) => row.invalidRef).map((row) => row.invalidRef) };
        if (countTokens(model, JSON.stringify(success(value))) <= budget) {
          runtime.assertEpoch(ns, page.epoch, page.suppressionEpoch);
          return value;
        }
      }
      throw new MemoryStoreError('context_item_too_large');`;
const scratch = createTestWorkspace(null, { prefix: 'map-scan-reference-' });
after(() => scratch.cleanup());
const contractURL = new URL('../contract.mjs', import.meta.url);
const source = readFileSync(contractURL, 'utf8');
const start = source.indexOf('      const capacity = Math.min(count, page.rows.length);');
const end = source.indexOf('\n    });\n  }\n\n  function fetch(', start);
assert.ok(start > 0 && end > start, 'unique map-loop boundary');
assert.equal(source.indexOf('      const capacity = Math.min(count, page.rows.length);', start + 1), -1);
const referencePath = join(scratch.path, 'reference-contract.mjs');
writeFileSync(referencePath, (source.slice(0, start) + descendingScan + source.slice(end))
  .replace(/from (["'])(\.\.?\/[^"']+)\1/g,
    (_, quote, specifier) => `from ${quote}${new URL(specifier, contractURL).href}${quote}`));
const { openMemoryCore: openScanCore } = await import(pathToFileURL(referencePath));

async function fixture(t, { safety = false, count = 103, mix = 'uniform', topics = false } = {}) {
  const f = safetyFixture(t);
  let counter = () => 1;
  const calls = [];
  const model = { contextWindow: 8192,
    countTokens(text) { calls.push(text); return counter(text); },
    select: () => ({ refs: [] }),
    rank: () => ({ refs: [] }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
  };
  let core = openMemoryCore({ path: f.path, model });
  const memories = [];
  for (let i = 0; i < count; i++) memories.push(ok(core.admit({ namespace,
    memory: { content: `Synthetic seed ${i}`, kind: 'fact' }, receipts: [receipt(`seed-${i}`)],
  })).memory);
  // Public map order is stable ID order for unfiled rows. Assign the size mixes
  // in that order, rather than relying on the admission order of random IDs.
  // SQLite's BINARY ordering is the contract's ordering (not locale collation).
  memories.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const [i, memory] of memories.entries()) {
    const size = mix === 'increasing' ? 1 + i % 103 : mix === 'decreasing' ? 103 - i % 103 : 24;
    const huge = (mix === 'huge-first' && i === 0) || (mix === 'huge-last' && i === count - 1);
    const content = `${String(i).padStart(3, '0')} ${huge ? '\u0001'.repeat(115) : '界'.repeat(size)}`;
    memories[i] = ok(core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      content, kind: 'fact', receipt: receipt(`size-${i}`, content) })).memory;
    if (topics) {
      const indexRevision = ok(core.map({ namespace, purpose: 'classification' })).indexRevision;
      const placed = ok(core.applyPlacement({ namespace,
        proposal: { items: [{ memoryId: memory.id, parentIds: [],
          newL1: { title: `Topic ${String(i).padStart(3, '0')} ${'界'.repeat(size)}`, parentL2Ids: [] } }] },
        expectedMemoryRevisions: [{ memoryId: memory.id, revision: memories[i].revision }],
        expectedIndexRevision: indexRevision }));
      memories[i] = placed.memories[0];
    }
  }
  core.close();
  if (safety) await f.migrate();
  core = openMemoryCore({ path: f.path, model });
  const scan = openScanCore({ path: f.path, model });
  f.workspace.defer(() => { scan.close(); core.close(); });
  // Read identity through SQLite only. A signed fixture cursor lets the matrix
  // target offsets 9/10 and 99/100 without changing the limit/budget binding.
  const db = new DatabaseSync(f.path, { readOnly: true });
  const identity = db.prepare('SELECT cursor_secret secret FROM store_metadata').get();
  db.close();
  return { core, scan, model, memories, calls, path: f.path,
    setCounter(value) { counter = value; calls.length = 0; },
    at(template, offset, budget) {
      const payload = { ...decode(template), b: budget, a: { offset } };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${body}.${createHmac('sha256', identity.secret).update(body).digest('base64url')}`;
    },
  };
}

// Deterministic BPE-style approximation: word and whitespace runs use fixed
// four-code-unit chunks, while each punctuation character costs one token.
// Keep the mandatory matrix independent of optional adapter dependencies.
function countChunkTokens(text) {
  return (text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [])
    .reduce((total, run) => total + Math.ceil(run.length / 4), 0);
}
const counters = [
  ['length', text => Math.ceil(text.length / 16)],
  ['chunks', countChunkTokens],
];
const comparable = result => result.ok ? JSON.stringify(result) : result.error.code;

test('differential: exact whole envelopes match the descending scan on monotone prefixes', async t => {
  let comparisons = 0;
  const maximum = Object.fromEntries(limits.map(limit => [limit, 0]));
  for (const safety of [false, true]) for (const mix of ['uniform', 'increasing', 'decreasing', 'huge-first', 'huge-last']) {
    const f = await fixture(t, { safety, mix });
    for (const purpose of ['recall', 'classification']) for (const limit of limits) {
      f.setCounter(() => 1);
      const template = ok(f.core.map({ namespace, purpose, limit })).nextCursor;
      assert.ok(template);
      for (const offset of [0, 9, 10, 99, 100, 102, 103]) for (const [counterName, counter] of counters) {
        const base = { namespace, purpose, limit };
        // Enumerate the reference's exact envelopes once at this binding to
        // derive budgets at the first, middle and full-page boundaries.
        f.setCounter(text => text ? 4001 : 0);
        f.scan.map({ ...base, tokenBudget: 4000, cursor: f.at(template, offset, 4000) });
        const envelopes = f.calls.filter(Boolean);
        const costs = envelopes.map(counter);
        // The top is deliberately excluded: its cursor/flags can break order.
        for (let i = 2; i < costs.length; i++) assert.ok(costs[i] <= costs[i - 1],
          `fixture must have monotone uniform prefixes: ${counterName}/${mix}/${limit}/${offset}`);
        const boundaries = [1, costs.at(-1), costs[Math.floor(costs.length / 2)], costs[0], 4000];
        const budgets = [...new Set(boundaries.flatMap(cost => [cost - 1, cost, cost + 1]))]
          .filter(budget => Number.isInteger(budget) && budget >= 1 && budget <= 4000);
        for (const tokenBudget of budgets) {
          const input = { ...base, tokenBudget, ...(offset ? { cursor: f.at(template, offset, tokenBudget) } : {}) };
          f.setCounter(counter);
          const expected = f.scan.map(input);
          f.setCounter(counter);
          const actual = f.core.map(input);
          const probes = f.calls.filter(Boolean);
          const capacity = Math.min(limit, Math.max(0, 103 - offset));
          maximum[capacity] = Math.max(maximum[capacity] ?? 0, probes.length);
          assert.ok(probes.length <= Math.ceil(Math.log2(Math.max(1, capacity))) + 2,
            `probe bound capacity=${capacity} probes=${probes.length}`);
          assert.equal(comparable(actual), comparable(expected),
            JSON.stringify({ safety, mix, purpose, limit, offset, counterName, tokenBudget }));
          if (actual.ok) assert.ok(probes.includes(JSON.stringify(actual)), 'returned envelope was exactly probed');
          comparisons++;
        }
      }
    }
  }
  t.diagnostic(`MAP_DIFFERENTIAL comparisons=${comparisons} counters=length,chunks safety=off,on mixes=5 purposes=2 limits=6 offsets=7`);
  t.diagnostic('MAP_PROBE_MAXIMA ' + JSON.stringify(maximum));
});

test('optional o200k tokenizer: exact envelopes match the descending scan', async t => {
  const { createContextCounter } = await import('../../adapters/openai/context-counter.mjs');
  let counter;
  try { counter = await createContextCounter(); }
  catch (error) {
    if (error.code !== 'context_tokenizer_unavailable') throw error;
    t.skip('o200k_base tokenizer is not installed; mandatory differential uses the self-contained chunk counter');
    return;
  }
  let comparisons = 0;
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety, count: 7 });
    for (const limit of limits) for (const tokenBudget of [1, 80, 200, 500, 1000, 4000]) {
      const input = { namespace, limit, tokenBudget };
      f.setCounter(counter.countTokens);
      const expected = f.scan.map(input);
      f.setCounter(counter.countTokens);
      assert.equal(comparable(f.core.map(input)), comparable(expected));
      comparisons++;
    }
  }
  t.diagnostic(`MAP_OPTIONAL_O200K_DIFFERENTIAL comparisons=${comparisons}`);
});

test('near-capacity: the one-shorter page takes exactly two envelope probes', async t => {
  for (const safety of [false, true]) for (const capacity of [2, 3, 7, 50, 100]) {
    const f = await fixture(t, { safety, count: capacity + 1 });
    f.setCounter(text => !text || JSON.parse(text).value.items.length < capacity ? 1 : 4001);
    const result = f.core.map({ namespace, limit: capacity });
    const probes = f.calls.filter(Boolean);
    assert.deepEqual(probes.map(text => JSON.parse(text).value.items.length),
      [capacity, capacity - 1], `capacity=${capacity} safety=${safety}`);
    assert.equal(probes.length, 2);
    assert.equal(ok(result).items.length, capacity - 1);
    assert.equal(probes[1], JSON.stringify(result), 'return the exactly counted page');
    assert.equal(f.calls.filter(text => text === '').length, 1, 'exclude the pre-loop count');
    t.diagnostic(`MAP_NEAR_CAPACITY capacity=${capacity} safety=${safety} probes=${probes.length}`);
  }
});

test('probe bound: every capacity 1..100, every monotone fitting threshold, and one-probe fast path', async t => {
  const f = await fixture(t);
  const maximum = {};
  for (let capacity = 1; capacity <= 100; capacity++) {
    let max = 0;
    for (let threshold = 0; threshold <= capacity; threshold++) {
      f.setCounter(text => !text || JSON.parse(text).value.items.length <= threshold ? 1 : 4001);
      const result = f.core.map({ namespace, limit: capacity });
      const probes = f.calls.filter(Boolean).length;
      max = Math.max(max, probes);
      assert.ok(probes <= Math.ceil(Math.log2(capacity)) + 2,
        `capacity=${capacity} threshold=${threshold} probes=${probes}`);
      if (threshold === 0) assert.equal(result.error?.code, 'context_item_too_large');
      else assert.equal(ok(result).items.length, threshold);
      if (threshold === capacity) assert.equal(probes, 1);
      assert.equal(f.calls.filter(text => text === '').length, 1, 'unchanged pre-loop count');
    }
    maximum[capacity] = max;
  }
  t.diagnostic('MAP_ALL_CAPACITIES_PROBE_MAXIMA ' + JSON.stringify(maximum));
});

test('non-monotone counters retain a probed fit and their cursors continue without gaps', async t => {
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety, count: 12 });
    const visited = [];
    // Capacity 8 and one-shorter 7 fail; 3 fits, 5 fails, then 4 fits.
    // The unprobed 6 would fit, so a smaller observed fit is still permitted.
    const fits = new Set([1, 2, 3, 4, 6]);
    f.setCounter(text => !text || fits.has(JSON.parse(text).value.items.length) ? 1 : 4001);
    let cursor;
    do {
      const result = f.core.map({ namespace, limit: 8, ...(cursor ? { cursor } : {}) });
      const value = ok(result);
      const serialized = JSON.stringify(result);
      assert.ok(f.calls.includes(serialized), 'returned exact envelope occurred among probes');
      assert.ok(fits.has(value.items.length), 'exact returned count fits');
      visited.push(...value.items.map(item => item.ref.memoryId));
      if (!cursor) {
        assert.equal(value.items.length, 4, 'permitted smaller fit than the descending scan');
        assert.equal(decode(value.nextCursor).a.offset, 4);
      }
      cursor = value.nextCursor;
    } while (cursor);
    assert.deepEqual(visited, f.memories.map(memory => memory.id));
    assert.equal(new Set(visited).size, 12);
  }
});

test('all non-monotone fit masks return an observed fit whenever any probe fits', async t => {
  const f = await fixture(t, { count: 7 });
  for (let mask = 0; mask < 128; mask++) {
    const fits = take => (mask & (1 << (take - 1))) !== 0;
    f.setCounter(text => !text || fits(JSON.parse(text).value.items.length) ? 1 : 4001);
    const result = f.core.map({ namespace, limit: 7 });
    const fittingProbes = f.calls.filter(Boolean).filter(text => fits(JSON.parse(text).value.items.length));
    if (fittingProbes.length) {
      assert.equal(result.ok, true, `fit mask ${mask}`);
      assert.ok(fittingProbes.includes(JSON.stringify(result)));
    } else assert.equal(result.error?.code, 'context_item_too_large');
  }
});

test('empty pages, zero budget, and the discontinuous full-page envelope preserve refusals and flags', async t => {
  for (const safety of [false, true]) for (const count of [0, 1, 2, 3]) {
    const f = await fixture(t, { safety, count });
    for (const limit of limits) for (const tokenBudget of [0, 1, 4000]) {
      f.setCounter(() => 1);
      const expected = f.scan.map({ namespace, limit, tokenBudget });
      f.setCounter(() => 1);
      const actual = f.core.map({ namespace, limit, tokenBudget });
      assert.equal(comparable(actual), comparable(expected));
      assert.equal(f.calls.filter(Boolean).length, tokenBudget === 0 ? 0 : 1,
        'invalid zero budget is rejected before counting; capacity/empty page counted exactly once');
    }
    if (count > 1) {
      // A cursor makes the smaller envelope larger. Top must be probed first.
      f.setCounter(text => !text || JSON.parse(text).value.nextCursor === null ? 1 : 4001);
      const result = ok(f.core.map({ namespace, limit: count }));
      assert.equal(result.items.length, count);
      assert.equal(result.exhausted, true);
      assert.equal(result.truncatedBy, null);
      assert.equal(f.calls.filter(Boolean).length, 1);
    }
  }
});

test('recall navigation, source modes and classification catalog use the real map search', async t => {
  let comparisons = 0;
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety, count: 103, topics: true });
    for (const [counterName, counter] of counters) for (const ceiling of [1, 3, 7, 50, 100]) {
      const count = text => {
        if (!text) return 0;
        const envelope = JSON.parse(text);
        if (envelope.ok && Array.isArray(envelope.value?.items)) {
          return envelope.value.items.length > ceiling ? 4001 : counter(text);
        }
        return 1; // Isolate map budgeting from select/rank/classify packing.
      };
      const run = async (core, input) => {
        const selected = [];
        f.model.select = ({ input }) => { selected.push(JSON.stringify(input)); return { refs: [] }; };
        f.setCounter(count);
        const result = await core.recall(input);
        return { result: comparable(result), selected };
      };
      for (const contextMode of [undefined, 'source-evidence', 'rationale-evidence']) {
        const input = { readSet: [namespace], query: '界', ...(contextMode ? { contextMode } : {}) };
        assert.deepEqual(await run(f.core, input), await run(f.scan, input),
          JSON.stringify({ safety, counterName, ceiling, contextMode }));
        comparisons++;
      }
      f.setCounter(() => 1);
      const indexRevision = ok(f.core.map({ namespace })).indexRevision;
      const memory = f.memories[0];
      const input = { namespace, memoryIds: [memory.id],
        expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }], mapRevision: indexRevision };
      f.setCounter(count);
      const expected = await f.scan.classifyPlacement(input);
      f.setCounter(count);
      const actual = await f.core.classifyPlacement(input);
      assert.equal(comparable(actual), comparable(expected));
      comparisons++;
    }
  }
  t.diagnostic(`MAP_INTERNAL_DIFFERENTIAL comparisons=${comparisons}`);
});

test('throwing and invalid counts on the first envelope preserve token_count_unavailable', async t => {
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety, count: 3 });
    for (const invalid of [() => { throw Error('synthetic'); }, () => -1, () => NaN, () => 0.5, () => Promise.resolve(1)]) {
      for (const core of [f.scan, f.core]) {
        f.setCounter(text => text ? invalid() : 0);
        assert.equal(core.map({ namespace }).error?.code, 'token_count_unavailable');
        assert.equal(f.calls.filter(Boolean).length, 1);
      }
    }
  }
});

test('invalid-reference rows consume take and preserve all envelope fields', async t => {
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety, count: 7, topics: true });
    const db = new DatabaseSync(f.path);
    db.prepare('UPDATE moc_memory_refs SET memory_revision = 999 WHERE memory_id = ?').run(f.memories[0].id);
    db.close();
    f.setCounter(() => 1);
    const all = ok(f.core.map({ namespace, purpose: 'classification' }));
    assert.ok(all.invalidRefs.length > 0);
    for (const limit of limits) for (const [, counter] of counters) for (const tokenBudget of [1, 80, 200, 500, 1000, 4000]) {
      const input = { namespace, purpose: 'classification', limit, tokenBudget };
      f.setCounter(counter);
      const expected = f.scan.map(input);
      f.setCounter(counter);
      assert.equal(comparable(f.core.map(input)), comparable(expected));
    }
  }
});

test('SQL census: ordinary map statements are identical; safety drops only one E1 per avoided probe', async t => {
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety });
    const counter = text => !text || JSON.parse(text).value.items.length <= 1 ? 1 : 4001;
    f.setCounter(counter);
    const scan = await measureContentRead('map', 'descending', () => f.scan.map({ namespace }), () => f.calls.length);
    f.setCounter(counter);
    const binary = await measureContentRead('map', 'binary', () => f.core.map({ namespace }), () => f.calls.length);
    assert.equal(comparable(binary.result), comparable(scan.result));
    const isE1 = sql => /^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(sql);
    const ordinary = row => row.sql.filter(([sql]) => !isE1(sql)).sort(([a], [b]) => a.localeCompare(b));
    assert.deepEqual(ordinary(binary), ordinary(scan), 'same SQL text and execution multiplicities outside E1');
    assert.equal(binary.begin, scan.begin);
    assert.equal(f.calls.filter(Boolean).length, 9, 'envelope probes');
    assert.equal(scan.statements - binary.statements, safety ? scan.ports - binary.ports : 0);
    t.diagnostic('MAP_SQL_CENSUS ' + JSON.stringify({ safety,
      scan: { statements: scan.statements, begin: scan.begin, callerCounts: scan.ports },
      binary: { statements: binary.statements, begin: binary.begin, callerCounts: binary.ports },
      ordinaryStatementKinds: ordinary(binary).length }));
  }
});

test('a later rejected probe cannot return an earlier fit after a namespace mutation', async t => {
  for (const safety of [false, true]) {
    const f = await fixture(t, { safety, count: 7 });
    let mutated = false;
    f.setCounter(text => {
      if (!text) return 0;
      const take = JSON.parse(text).value.items.length;
      if (take === 4 && !mutated) {
        mutated = true;
        const memory = f.memories[0];
        ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
      }
      return take <= 3 ? 1 : 4001;
    });
    const result = f.core.map({ namespace, limit: 7 });
    assert.equal(mutated, true);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, safety ? 'evidence_unavailable' : 'index_revision_conflict');
  }
});

// Isolated real-core race fixture. Loader hooks exist only in this process/thread.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'snapshot-race', scope: 'personal', projectId: null };
const internal = { ...ns, projectId: '' };
const foreign = { ...ns, ownerId: 'snapshot-foreign' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const model = () => ({ contextWindow: 8192, countTokens: () => 1,
  extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
    kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
  classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
  select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.slice(0, 12).map(item => ({
    namespaceIndex: map.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
      : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))) }),
  rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex,
    memoryId: item.memory.id, revision: item.memory.revision })) }) });
const capture = (core, namespace, eventId, messages) => core.capture({ namespace, client: 'synthetic',
  sessionId: 'snapshots', eventId, messages: messages.map((content, i) => ({ id: `${eventId}-${i}`, role: 'user', content })) });
const rowCount = db => db.prepare('SELECT count(*) AS n FROM memories').get().n;

if (!isMainThread) {
  const { scenario, mutation, path, gate: shared } = workerData;
  const gate = new Int32Array(shared);
  let activeTransactions = 0, maxPage = 0, reached = 0, injected = false, selectors = 0;
  let maskCalls = 0, labelCalls = 0, pageCalls = 0;
  const expectedBoundary = scenario.includes('page') ? 'page' : scenario.includes('winner-batch') ? 'winner-batch'
    : scenario.includes('label') ? 'label' : scenario.includes('counter') || scenario === 'same-model' ? 'counter' : 'mask';
  globalThis.snapshotRaceBoundary = kind => {
    if (['read-error', 'label-error', 'poison-eligible', 'poison-excluded'].includes(scenario)) return;
    if (kind === 'mask') maskCalls++;
    if (kind === 'label') labelCalls++;
    if (kind === 'page') pageCalls++;
    const hit = kind === 'mask' && expectedBoundary === 'mask' && maskCalls === 1 ||
      kind === 'label' && expectedBoundary === 'label' && labelCalls === 1 ||
      kind === 'label' && expectedBoundary === 'winner-batch' && labelCalls === 257 ||
      kind === 'page' && expectedBoundary === 'page' && pageCalls === 2 ||
      kind === 'counter' && expectedBoundary === 'counter';
    if (!hit || reached) return;
    reached++;
    parentPort.postMessage({ type: 'paused', boundary: expectedBoundary, activeTransactions, maxPage });
    const wait = Atomics.wait(gate, 0, 0, 20_000);
    assert.ok(wait === 'ok' || wait === 'not-equal', 'parent released race boundary');
  };
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    let source = String(loaded.source);
    const replace = (target, replacement) => {
      assert.equal(source.split(target).length, 2, `exact isolated mutation/instrumentation: ${target}`);
      source = source.replace(target, replacement);
    };
    if (url.endsWith('/core/source-ranking.mjs')) {
      replace('  function add(masks, slot, memory, receipts) {',
        "  function add(masks, slot, memory, receipts) { globalThis.snapshotRaceBoundary('mask');");
    } else if (url.endsWith('/core/query-excerpt.mjs')) {
      replace('  return (content) => window(content, WIDTH);',
        "  return (content) => { globalThis.snapshotRaceBoundary('label'); if (globalThis.snapshotLabelFailure) { globalThis.snapshotLabelFailureObserved = true; throw new Error('snapshot_label_failure'); } return window(content, WIDTH); };");
    } else if (url.endsWith('/core/moc-storage.mjs')) {
      replace('      const limit = Math.min(page, scan - physicalRows);',
        "      globalThis.snapshotRaceBoundary('page'); const limit = Math.min(page, scan - physicalRows);");
      if (mutation === 'long-transaction') {
        replace('      return rankedSourceRows(ns, { query, memoryLabel, keyset });',
          '      return transaction(db, () => rankedSourceRows(ns, { query, memoryLabel, keyset }));');
        replace("      db.exec('BEGIN');", '      /* isolated long-transaction control */');
        replace("        db.exec('COMMIT');", '        /* outer transaction owns commit */');
        replace("        db.exec('ROLLBACK');", '        /* outer transaction owns rollback */');
      }
      if (mutation === 'omit-generation') {
        replace("        if (generation === null) fail('index_unavailable');", '        /* isolated missing availability check */');
        replace('currentEpoch !== anchor.epoch || generation !== anchor.generation', 'currentEpoch !== anchor.epoch');
      }
    } else return loaded;
    return { ...loaded, source };
  } });
  const [{ openMemoryCore }, { createMemoryRuntime }, { createQueryExcerpt }, { createQueryScore }] = await Promise.all([
    import('../contract.mjs'), import('../runtime.mjs'), import('../query-excerpt.mjs'), import('../query-candidates.mjs'),
  ]);
  const scripted = model();
  const select = scripted.select;
  scripted.select = request => { selectors++; return select(request); };
  scripted.countTokens = text => {
    const parsed = JSON.parse(text || 'null');
    if ((scenario.includes('counter') && parsed?.value?.items?.[0]?.label) ||
        scenario === 'same-model' && parsed?.input?.maps) globalThis.snapshotRaceBoundary('counter');
    return 1;
  };
  const core = openMemoryCore({ path, model: scripted, sourceRankingPolicy: 'bounded-idf-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  const runtime = createMemoryRuntime({ path });
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.exec = function(sql, ...args) {
    const value = exec.call(this, sql, ...args);
    if (/^BEGIN(?: IMMEDIATE)?$/u.test(sql.trim())) activeTransactions++;
    if (/^(COMMIT|ROLLBACK)$/u.test(sql.trim())) activeTransactions--;
    return value;
  };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    if (!sql.includes('INDEXED BY capture_current_memories') || !sql.includes('ORDER BY id LIMIT ?')) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'all') return (...args) => {
        const rows = target.all(...args); maxPage = Math.max(maxPage, rows.length);
        if (scenario === 'read-error' && !injected) { injected = true; throw new Error('snapshot_read_failure'); }
        return rows;
      };
      return Reflect.get(target, property, target);
    } });
  };
  parentPort.postMessage({ type: 'ready' });
  parentPort.once('message', async () => {
    try {
      globalThis.snapshotLabelFailure = scenario === 'label-error';
      let result;
      if (scenario === 'null-label-private') {
        try {
          const value = runtime.queryCandidateRows(internal, { query: 'synthetic marker', sourceReceiptLimit: 4,
            sourceRankingPolicy: 'bounded-idf-v1', sourceCandidatePolicy: 'bounded-keyset-v1',
            score: createQueryScore('synthetic marker'), memoryLabel: createQueryExcerpt('synthetic marker') });
          result = { ok: true, value: { memories: value.rows } };
        } catch (error) { result = { ok: false, error: { code: error.code ?? 'storage_error' } }; }
      } else result = await core.recall({ readSet: [ns], query: 'synthetic marker', contextMode: 'source-evidence', limit: 12 });
      globalThis.snapshotLabelFailure = false;
      const following = await capture(core, foreign, 'following', ['synthetic following source']);
      parentPort.postMessage({ type: 'done', ok: result.ok, code: result.error?.code ?? null,
        returned: result.value?.memories?.length ?? null, selectors, reached, activeTransactions,
        maxPage, injected: injected || globalThis.snapshotLabelFailureObserved === true, followingOk: following.ok,
        followingApplied: following.value?.classification?.status === 'applied' });
    } finally {
      DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.prepare = prepare;
      runtime.close(); core.close(); parentPort.close();
    }
  });
} else {
  const [scenario, mutation] = process.argv.slice(2);
  const { openMemoryCore } = await import('../contract.mjs');
  const workspace = createTestWorkspace(null, { prefix: 'cairn-snapshot-race-' });
  let observed, assertion, worker;
  const gate = new Int32Array(new SharedArrayBuffer(4));
  try {
    const path = join(workspace.path, 'memory.sqlite');
    const writer = openMemoryCore({ path, model: model() }); workspace.defer(() => writer.close());
    const db = new DatabaseSync(path); workspace.defer(() => db.close());
    const count = scenario.includes('page') || scenario.includes('winner-batch') ? 300 : 5;
    let target;
    for (let start = 0; start < 5; start += 5) {
      const seeded = ok(await capture(writer, ns, `seed-${start}`,
        Array.from({ length: Math.min(5, count - start) }, (_, i) => `synthetic marker source ${start + i}`)));
      assert.equal(seeded.classification.status, 'applied');
      target ??= seeded.admission.memories[0];
    }
    if (count > 5) {
      // Explicit structural race-capacity setup. Only the first five targets
      // establish normal capture; these extra rows are not admission/quality evidence.
      const memory = db.prepare(`INSERT INTO memories
        (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,
          created_at,updated_at,filing_status,currentness)
        VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,0,'2026-01-01','2026-01-01','unfiled','current')`);
      const receipt = db.prepare(`INSERT INTO receipts
        (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
        VALUES (?,?,?,'synthetic','snapshots',?,'user',?,'2026-01-01')`);
      db.exec('BEGIN');
      try {
        for (let index = 5; index < count; index++) {
          const id = `structural-${String(index).padStart(6, '0')}`;
          const content = `synthetic marker capacity ${index}`;
          memory.run(id, ns.ownerId, `structural-fingerprint-${index}`, content);
          const source = { client: 'synthetic', sessionId: 'snapshots', eventId: id, role: 'user', excerpt: content };
          const key = createHash('sha256').update(JSON.stringify(source)).digest('hex');
          receipt.run(`${id}-source`, id, key, id, content);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const rebuild = full => {
      const epoch = ok(writer.map({ namespace: ns })).indexRevision;
      let page = ok(writer.rebuildIndex({ namespace: ns, expectedIndexRevision: epoch, limit: 1 }));
      if (full) while (!page.exhausted) page = ok(writer.rebuildIndex({ namespace: ns,
        expectedIndexRevision: epoch, limit: 1, cursor: page.nextCursor }));
      return page;
    };
    if (scenario.startsWith('active-')) rebuild(true);
    if (scenario === 'poison-excluded') {
      const saved = ok(await capture(writer, foreign, 'poison', ['synthetic excluded source']));
      db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('poison foreign', saved.admission.memories[0].id);
    }
    if (scenario === 'poison-eligible') db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('poison eligible', target.id);
    const beforeEpoch = db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=?').get(ns.ownerId).epoch;
    worker = new Worker(new URL(import.meta.url), { workerData: { scenario, mutation, path, gate: gate.buffer } });
    const queued = [], waiting = [];
    worker.on('message', message => {
      const index = waiting.findIndex(item => item.type === message.type);
      if (index < 0) queued.push(message); else waiting.splice(index, 1)[0].resolve(message);
    });
    worker.on('error', error => { for (const item of waiting.splice(0)) item.reject(error); });
    const receive = type => {
      const index = queued.findIndex(item => item.type === type);
      return index < 0 ? new Promise((resolve, reject) => waiting.push({ type, resolve, reject }))
        : Promise.resolve(queued.splice(index, 1)[0]);
    };
    const exit = new Promise(resolve => worker.once('exit', resolve));
    await receive('ready');
    worker.postMessage('go');
    const noPause = ['read-error', 'label-error', 'poison-eligible', 'poison-excluded'].includes(scenario);
    let paused, mutationResult;
    if (!noPause) {
      paused = await receive('paused');
      const before = rowCount(db);
      if (scenario.startsWith('foreign-')) {
        const result = await capture(writer, foreign, 'concurrent', ['synthetic committed foreign source']);
        mutationResult = { ok: result.ok, code: result.error?.code ?? null,
          admission: result.value?.admission?.memories?.length ?? null,
          classification: result.value?.classification?.status ?? null };
        if (result.ok) {
          const cold = openMemoryCore({ path });
          try {
            const inspected = ok(cold.inspectAdmission({ namespace: foreign, client: 'synthetic', eventId: 'concurrent', includeInitialClassification: true }));
            const detail = ok(cold.get({ namespace: foreign, memoryId: result.value.admission.memories[0].id }));
            mutationResult.cold = inspected.status === 'completed' && inspected.initialClassification.status === 'applied' &&
              inspected.members.length === 1 && inspected.members[0].status === 'current' &&
              inspected.members[0].memoryId === detail.memory.id && inspected.members[0].revision === detail.memory.revision &&
              detail.receipts.length === 1 && detail.receipts[0].excerpt === 'synthetic committed foreign source';
          } finally { cold.close(); }
        }
      } else if (scenario.startsWith('null-')) {
        const staged = rebuild(false);
        mutationResult = { staged: !staged.exhausted, generation: db.prepare('SELECT active_generation FROM namespace_index_state WHERE owner_id=?').get(ns.ownerId).active_generation };
      } else if (scenario.includes('publish')) {
        const published = rebuild(true); mutationResult = { published: published.exhausted };
      } else if (scenario.startsWith('receipt-')) {
        const detail = ok(writer.get({ namespace: ns, memoryId: target.id }));
        ok(writer.admit({ namespace: ns, memory: { content: detail.memory.content, kind: 'fact' },
          receipts: [{ client: 'synthetic', sessionId: 'snapshots', eventId: 'extra', role: 'user', excerpt: 'synthetic additional receipt' }] }));
      } else if (scenario.startsWith('forget-')) ok(writer.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
      else if (scenario.startsWith('filing-')) ok(writer.applyPlacement({ namespace: ns,
        proposal: { items: [{ memoryId: target.id, parentIds: [], newL1: { title: 'Changed filing', parentL2Ids: [] } }] },
        expectedMemoryRevisions: [{ memoryId: target.id, revision: target.revision }],
        expectedIndexRevision: ok(writer.map({ namespace: ns })).indexRevision }));
      else ok(writer.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
        content: 'synthetic corrected source', kind: 'fact', receipt: { client: 'synthetic', sessionId: 'snapshots',
          eventId: 'corrected', role: 'user', excerpt: 'synthetic corrected source' } }));
      mutationResult = { ...mutationResult, before, after: rowCount(db),
        epochAfter: db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=?').get(ns.ownerId).epoch };
      Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
    }
    const done = await receive('done');
    const workerExit = await exit;
    observed = { scenario, mutation: mutation ?? null, paused: paused ?? null, mutationResult: mutationResult ?? null,
      beforeEpoch, done, workerExit, journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode };
    assert.equal(workerExit, 0);
    if (scenario.startsWith('foreign-')) {
      assert.equal(mutationResult.ok, true, 'outside-lock capture must fully commit before release');
      assert.equal(mutationResult.admission, 1); assert.equal(mutationResult.classification, 'applied');
      assert.equal(mutationResult.after, mutationResult.before + 1, 'exactly one new memory committed while ranking paused');
      assert.equal(mutationResult.cold, true);
    }
    if (!noPause) { assert.equal(paused.activeTransactions, 0, 'computation must hold no SQLite transaction'); assert.equal(done.reached, 1); }
    assert.ok(done.maxPage <= 256);
    assert.equal(done.activeTransactions, 0);
    assert.equal(done.followingOk, true, 'following capture commits after error or success');
    assert.equal(done.followingApplied, true);
    if (scenario.startsWith('null-')) {
      assert.equal(mutationResult.staged, true); assert.equal(mutationResult.generation, null);
      assert.equal(mutationResult.epochAfter, beforeEpoch, 'NULL creation does not bump epoch');
      assert.equal(done.code, 'index_unavailable', 'staged NULL must reject at anchored read');
      assert.equal(done.selectors, 0);
    } else if (scenario.startsWith('foreign-') || scenario === 'poison-excluded') {
      assert.equal(done.ok, true); assert.equal(done.returned, 5); assert.equal(done.selectors, 1);
    } else if (noPause) {
      assert.equal(done.code, 'storage_error'); assert.equal(done.selectors, 0);
      if (scenario !== 'poison-eligible') assert.equal(done.injected, true);
    } else {
      if (scenario.includes('publish')) assert.equal(mutationResult.published, true);
      assert.ok(mutationResult.epochAfter > beforeEpoch, 'trusted same-namespace mutation advanced epoch');
      assert.equal(done.code, 'index_revision_conflict'); assert.equal(done.selectors, 0);
    }
  } catch (error) {
    if (error?.code !== 'ERR_ASSERTION') throw error;
    assertion = error.message; process.exitCode = 2;
  } finally {
    Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
    if (worker) await worker.terminate();
    await workspace.cleanup();
  }
  assert.equal(existsSync(workspace.path), false);
  process.stdout.write(`${JSON.stringify({ ...observed, cleanup: true, assertion: assertion ?? null })}\n`);
  if (assertion) process.stderr.write(`SNAPSHOT_RACE_ASSERTION_FAILED:${assertion}\n`);
}

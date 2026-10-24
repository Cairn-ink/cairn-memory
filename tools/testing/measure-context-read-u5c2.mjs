/** Opt-in synthetic public-operation corpus. No network, keys or providers.
 * node tools/testing/measure-context-read-u5c2.mjs --run --sizes=1000,10000
 *   [--iterations=10] [--shape=balanced|topics|members] [--keep] [--fast-seed]
 * Large bounds: --sizes=100000 --shape=topics (then members) --iterations=1.
 * Cold means first query on a new handle, not an OS-cache flush.
 */
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/index.mjs';
import { readTransaction } from '../../core/database.mjs';
import { createTestWorkspace } from './workspace.mjs';
import { host } from '../../core/testing/context-read-core-fixture.mjs';
import { instrumentSourceWork } from './context-read-source-work.mjs';
import { expandRelations } from '../../core/context-read-relations.mjs';
import { rankMoc } from '../../core/context-read-moc.mjs';

const args = process.argv.slice(2), value = (name, fallback) => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=') ?? fallback;
const percentile = (rows, p) => [...rows].sort((a, b) => a - b)[Math.max(0, Math.ceil(rows.length * p) - 1)];
const ok = result => { if (!result.ok) throw Error(JSON.stringify(result)); return result.value; };
const ns = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' }, sources = ['relations-one-hop-v1', 'moc-v1'];
if (!args.includes('--run')) console.log('Opt in with --run. Synthetic public operations only; no network or providers.');
else {
  if (args.some(a => !['--run', '--keep', '--fast-seed'].includes(a) && !/^--(?:sizes|iterations|shape|reuse)=/.test(a))) throw Error('invalid_measurement_arguments');
  const sizes = value('sizes', '1000,10000').split(',').map(Number), iterations = Number(value('iterations', '10')), shape = value('shape', 'balanced'), reuse = value('reuse');
  if (sizes.some(n => !Number.isSafeInteger(n) || n < 1 || n > 100000) || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100 ||
      !['balanced', 'topics', 'members'].includes(shape) || reuse && (sizes.length !== 1 || !reuse.startsWith('/tmp/'))) throw Error('invalid_measurement_arguments');
  console.log(JSON.stringify({ kind: 'environment', node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, platform: platform(), release: release(),
    provider: 'none', counter: 'none', iterations, shape, seedSynchronous: args.includes('--fast-seed') ? 'OFF; ANALYZE for fixture preparation only; measured handles use defaults' : 'default', plannerStatistics: 'ANALYZEd fixture; ANALYZE statistics persist across handles', cold: 'new handle; OS cache not flushed' }));
  for (const size of sizes) {
    const workspace = createTestWorkspace(null, { prefix: 'u5c2-measure-' }), path = reuse ?? join(workspace.path, 'store.sqlite'), trusted = host();
    let writer, modelEdges = [];
    try {
      if (!reuse) {
        // Optional synthetic-seeding acceleration changes no public operation,
        // schema, validation or retrieval. Capture the constructor's canonical
        // handle only long enough to set a connection-local durability pragma.
        // Close it before measurement; all measured handles use defaults.
        const nativePrepare = DatabaseSync.prototype.prepare, opened = new Set();
        if (args.includes('--fast-seed')) DatabaseSync.prototype.prepare = function (...parameters) { opened.add(this); return nativePrepare.apply(this, parameters); };
        try { writer = openMemoryCore({ path, model: { contextWindow: 32768, countTokens: () => 1, relate: () => ({ edges: modelEdges }) } }); }
        finally { DatabaseSync.prototype.prepare = nativePrepare; }
        for (const db of opened) if (db.isOpen && nativePrepare.call(db, 'PRAGMA database_list').all().some(row => row.file === path)) {
          db.exec('PRAGMA synchronous=OFF');
          // Refresh SQLite planner statistics during fixture creation. Public
          // placement's existing currentMemoryRefs join otherwise chooses a
          // growing namespace scan. No application index/table is introduced.
          db.exec('ANALYZE');
        }
        const seedDb = [...opened].find(db => db.isOpen && nativePrepare.call(db, 'PRAGMA database_list').all().some(row => row.file === path));
        const start = performance.now(), groupSize = shape === 'topics' ? 1 : shape === 'members' ? 1000 : 25;
        let parent, indexRevision, candidates = [], endpoints = [];
        for (let offset = 0; offset < size; offset += 5) {
          const records = [];
          for (let i = offset; i < Math.min(size, offset + 5); i++) {
            const text = `${i % 5 === 0 ? 'needle ' : ''}Synthetic deployment item ${i} partition ${i % 31} 資料庫`;
            const admitted = ok(writer.admit({ namespace: ns, memory: { content: text, kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 'u5c2-measure',
              eventId: String(i), role: 'user', excerpt: 'Synthetic receipt ' + i }] })); indexRevision = admitted.indexRevision; records.push(admitted.memory);
          }
          const items = records.map((m, j) => {
            const fresh = shape === 'topics' || offset % groupSize === 0;
            return { memoryId: m.id, parentIds: fresh ? [] : [parent], ...(fresh ? { newL1: { title: `needle synthetic topic ${shape === 'topics' ? offset + j : Math.floor(offset / groupSize)}`, parentL2Ids: [] } } : {}) };
          });
          const placed = ok(writer.applyPlacement({ namespace: ns, expectedIndexRevision: indexRevision,
            expectedMemoryRevisions: records.map(m => ({ memoryId: m.id, revision: m.revision })), proposal: { items } }));
          if (seedDb && (offset === 0 || offset % 1000 === 0)) seedDb.exec('ANALYZE');
          if (placed.createdMocs.length) parent = placed.createdMocs[0].id;
          for (const m of placed.memories) {
            if (m.content.includes('needle')) { candidates.push(m); candidates.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))); candidates = candidates.slice(0, 4); }
            else if (endpoints.length < 8) endpoints.push(m);
          }
          if ((offset + records.length) % 1000 === 0) console.log(JSON.stringify({ kind: 'seed_progress', size, shape, memories: offset + records.length, elapsedMs: performance.now() - start }));
        }
        for (const [i, seed] of candidates.entries()) for (const endpoint of endpoints.slice(i * 2, i * 2 + 2)) {
          modelEdges = [{ from: 1, to: 0, fromReceipt: 0, toReceipt: 0, relation: 'supports-decision' }];
          ok(await writer.reviewRationale({ namespace: ns, refs: [seed, endpoint].map(m => ({ memoryId: m.id, revision: m.revision })) }));
        }
        // Persist final planner statistics, including on ordinary seed runs.
        if (seedDb) seedDb.exec('ANALYZE');
        writer.close(); writer = null;
        console.log(JSON.stringify({ kind: 'seed_complete', size, shape, seedMs: performance.now() - start, path: args.includes('--keep') ? path : undefined }));
      }
      const analyzer = new DatabaseSync(path); analyzer.exec('ANALYZE'); analyzer.close();
      // Large-source boundary instrumentation runs directly on the canonical
      // adapter before lexical maintenance. SQLite WHERE callbacks count visited
      // records, including rejected rows, independently of returned cardinality.
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        const nativePrepare = db.prepare.bind(db), meter = instrumentSourceWork(db, { readSet: [ns] });
        const row = nativePrepare('SELECT store_id,cursor_secret FROM store_metadata').get();
        const identity = { storeId: row.store_id, cursorSecret: row.cursor_secret };
        const direct = nativePrepare("SELECT id,revision FROM memories WHERE owner_id=? AND scope=? AND project_id=? AND content LIKE '%needle%' ORDER BY id LIMIT 4")
          .all(ns.ownerId, ns.scope, ns.projectId).map(m => ({ ref: { type: 'memory', namespace: ns, memoryId: m.id, revision: m.revision } }));
        for (const source of sources) {
          const before = structuredClone(meter.counts), started = performance.now();
          const boundary = readTransaction(db, () => source === 'moc-v1' ? rankMoc(meter.database, identity, {},
            { readSet: [ns], types: ['memory'], intent: 'current', query: 'needle' }, Infinity) :
            expandRelations(meter.database, identity, {}, { readSet: [ns], types: ['memory'], intent: 'current' }, direct, Infinity));
          const privateWork = { lookups: meter.counts.private.lookups - before.private.lookups, visits: meter.counts.private.visits - before.private.visits };
          const d = boundary.diagnostic, independent = { lookups: meter.counts.lookups - before.lookups, visits: meter.counts.visits - before.visits };
          const physical = { visits: independent.visits + privateWork.visits, lookups: independent.lookups + privateWork.lookups };
          const breakdown = Object.fromEntries([...new Set([...Object.keys(meter.counts.byTable), ...Object.keys(meter.counts.lookupsByTable)])].map(table => [table, { visits: (meter.counts.byTable[table] ?? 0) - (before.byTable[table] ?? 0), lookups: (meter.counts.lookupsByTable[table] ?? 0) - (before.lookupsByTable[table] ?? 0) }]));
          if (d.work !== independent.visits + independent.lookups + d.checks || privateWork.lookups + privateWork.visits > 50000 || d.records !== independent.visits || d.lookups !== independent.lookups || d.work + d.reservedWork > 50000 || d.peakBytes > 8 * 1024 * 1024)
            throw Error('source_boundary_exceeded_or_work_mismatch: ' + JSON.stringify({ source, independent, diagnostic: d }));
          console.log(JSON.stringify({ kind: 'source_boundary', size, shape, source, elapsedMs: performance.now() - started,
            independent: { ...independent, databaseWork: independent.lookups + independent.visits, plansChecked: meter.counts.plansChecked - before.plansChecked },
            physical, breakdown, privateScopeWork: privateWork, chargedDatabaseWork: d.records + d.lookups, diagnostic: d }));
        }
      } finally { db.close(); }
      // Build the complete lexical projection outside query timing; maintenance
      // is reported separately and remains bounded/resumable under U5a rules.
      const maintenance = openMemoryCore({ path, contextRead: { version: 'context-read-v1', authority: trusted.authority } });
      try {
        const start = performance.now(); let complete = false, calls = 0;
        while (!complete) {
          const result = ok(await trusted.call(maintenance, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
          complete = result.status === 'complete'; calls++; if (calls % 10 === 0) console.log(JSON.stringify({ kind: 'maintenance_progress', size, calls, elapsedMs: performance.now() - start }));
        }
        console.log(JSON.stringify({ kind: 'lexical_ready', size, calls, elapsedMs: performance.now() - start }));
      } finally { maintenance.close(); }
      for (const enabled of [null, [sources[0]], [sources[1]], sources]) {
        const core = openMemoryCore({ path, contextRead: { version: 'context-read-v1', authority: trusted.authority, ...(enabled ? { sources: enabled } : {}) } });
        const samples = [], failures = [], work = []; let cold, coverage;
        try {
          for (let iteration = 0; iteration <= iterations; iteration++) {
            const start = performance.now(), result = await trusted.call(core, 'findCandidates', { readSet: [ns], types: ['memory'], intent: 'current', query: 'needle', deadlineMs: 5000 });
            const elapsed = performance.now() - start;
            if (iteration === 0) cold = elapsed; else samples.push(elapsed);
            if (!result.ok) failures.push(result.error.code);
            else { coverage = result.value.coverage; work.push(Object.fromEntries(Object.entries(result.value.trace.sources ?? {}).map(([id, source]) => [id, {
              status: source.status, reasons: source.reasons, work: source.work ?? 0, reservedWork: source.reservedWork ?? 0,
              peakBytes: source.peakBytes ?? 0, stateBytes: source.stateBytes ?? 0, examined: source.examined, added: source.added, membersRanked: source.membersRanked,
            }]))); }
          }
          console.log(JSON.stringify({ kind: 'findCandidates_profile', node: process.version, size, shape, sources: enabled ?? [], coldMs: cold,
            p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95), iterations, failures, coverage, sourceCounters: work.at(-1), peakRssKiB: process.resourceUsage().maxRSS }));
          if (failures.length) throw Error('measurement_query_failure');
        } finally { core.close(); }
      }
    } finally {
      writer?.close();
      if (args.includes('--keep') && !reuse) console.log(JSON.stringify({ kind: 'retained_synthetic_store', path }));
      else await workspace.cleanup();
    }
  }
}

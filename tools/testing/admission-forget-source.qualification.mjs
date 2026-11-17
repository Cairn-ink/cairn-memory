// Optional history comparisons belong here, never in node:test files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/index.mjs';
import { eventTimeSafetyFixture } from '../../core/testing/receipt-event-time-fixture.mjs';
import { safetyFixture, ns, ok } from '../../core/testing/content-safety-s2h-fixture.mjs';

const [phase, base] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(phase), 'usage: node <qualification> before|after [base-ref]');
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
const source = { client: 'synthetic-client', sessionId: 'synthetic-session', eventId: 'm1',
  role: 'user', excerpt: 'I drink green tea every morning.' };
const clean = { ...source, eventId: 'm2', excerpt: 'I collect ceramic mugs.' };
const original = 'The user prefers green tea in the morning';
const reworded = 'In the mornings the user likes to drink green tea';
const tokenLookup = sql => /json_each\(\?\).*CROSS JOIN suppressed s/s.test(sql);

function meter(call, fault) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(name => [name, StatementSync.prototype[name]]));
  const counts = { prepared: 0, executed: 0, exec: 0, tokenPrepared: 0, tokenExecuted: 0 };
  DatabaseSync.prototype.prepare = function (sql) {
    counts.prepared++; if (tokenLookup(sql)) counts.tokenPrepared++;
    if (fault?.test(sql)) throw Object.assign(new Error('synthetic storage failure'), { code: 'ERR_SQLITE_ERROR' });
    return Reflect.apply(prepare, this, [sql]);
  };
  DatabaseSync.prototype.exec = function (sql) { counts.exec++; return Reflect.apply(exec, this, [sql]); };
  for (const [name, original] of methods) StatementSync.prototype[name] = function (...args) {
    counts.executed++; if (tokenLookup(this.sourceSQL)) counts.tokenExecuted++;
    return Reflect.apply(original, this, args);
  };
  try { return { counts, value: call() }; }
  finally {
    DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec;
    for (const [name, original] of methods) StatementSync.prototype[name] = original;
  }
}

async function fixture(shape, open, work) {
  const cleanups = [], t = { after: fn => cleanups.push(fn) };
  try {
    const f = shape === 'hosted-53' ? eventTimeSafetyFixture(t, 33) : safetyFixture(t, 18);
    if (shape === 'hosted-53') await f.migrate();
    const core = open({ path: f.path }); f.workspace.defer(() => core.close());
    const db = f.connect(); f.workspace.defer(() => db.close());
    await work({ core, db });
  } finally { while (cleanups.length) await cleanups.pop()(); }
}

for (const shape of ['hosted-53', 'legacy-18']) await fixture(shape, openMemoryCore, async ({ core, db }) => {
  for (const size of [1, 4]) for (const temperature of ['cold', 'warm']) {
    const receipts = Array.from({ length: size }, (_, i) => ({ ...source, eventId: `${size}-${temperature}-${i}` }));
    const measured = meter(() => core.admit({ namespace: ns,
      memory: { content: `Synthetic cost fact ${size} ${temperature}`, kind: 'fact' }, receipts }));
    ok(measured.value);
    assert.equal(measured.counts.tokenExecuted, phase === 'after' ? 1 : 0);
    console.log(JSON.stringify({ kind: 'admit-cost', phase, shape, temperature, receipts: size, ...measured.counts }));
  }
  if (phase === 'after') {
    const text = readFileSync(new URL('../../core/raw-lineage-storage.mjs', import.meta.url), 'utf8');
    const section = text.slice(text.indexOf('  function assertAdmissionReceipts('), text.indexOf('  function assertReceipts('));
    const lookup = section.match(/db.prepare\(`([\s\S]*?)`\)/)?.[1]; assert.ok(lookup);
    const key = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + lookup).all(JSON.stringify(['rs1:i:' + key]), ...boundary(ns));
    assert.ok(plan.some(row => /SEARCH s USING (?:COVERING )?INDEX sqlite_autoindex_suppressed_1/.test(row.detail) &&
      ['owner_id=?', 'scope=?', 'project_id=?', 'fingerprint=?'].every(part => row.detail.includes(part))));
    assert.equal(plan.some(row => /SCAN s(?: |$)/.test(row.detail)), false);
    console.log(JSON.stringify({ kind: 'admit-lookup-plan', shape, details: plan.map(row => row.detail) }));
  }
});

if (base) {
  // Snapshot production modules only. Tests always import the checked-out tree.
  const root = mkdtempSync(join(tmpdir(), 'admission-qualification-'));
  try {
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', base], { encoding: 'utf8' }).trim().split('\n')
      .filter(path => /^core\/[^/]+\.mjs$/.test(path) || path.startsWith('core/prompts/') ||
        path === 'plugins/cairn-memory/lib/redact.mjs');
    const archive = execFileSync('git', ['archive', base, '--', ...paths], { maxBuffer: 32 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', root], { input: archive });
    const before = await import(pathToFileURL(join(root, 'core/index.mjs')));
    const pathsToCheck = ['admit', 'duplicate', 'finish', 'correct', 'supersede'];
    const states = ['allowed', 'suppressed', 'guard', 'receipt-storage', 'epoch-storage'];
    const cases = [];
    for (const path of pathsToCheck) for (const state of states) for (const marked of [false, true])
    for (const order of ['single', 'first', 'last']) cases.push({ path, state, marked, order });
    const outcomes = [];
    for (const [version, open] of [['base', before.openMemoryCore], ['change', openMemoryCore]]) {
      const rows = [];
      for (const shape of ['hosted-53', 'legacy-18']) await fixture(shape, open, async f => {
        for (const [index, cell] of cases.entries()) {
          const namespace = { ...ns, projectId: `cell-${index}` };
          const admit = (content, receipts) => f.core.admit({ namespace, memory: { content, kind: 'fact' }, receipts });
          const first = ok(admit(original, [source])).memory;
          ok(f.core.forget({ namespace, memoryId: first.id, expectedRevision: first.revision }));
          if (!cell.marked) f.db.prepare("DELETE FROM suppressed WHERE owner_id=? AND scope=? AND project_id=? AND fingerprint LIKE 'rs1:%'")
            .run(...boundary(namespace));
          const current = ['duplicate', 'correct', 'supersede'].includes(cell.path)
            ? ok(admit('A clean current fact', [clean])).memory : undefined;
          const receipts = cell.order === 'single' ? [source] : cell.order === 'first' ? [source, clean] : [clean, source];
          const content = cell.state === 'suppressed' ? original : cell.path === 'duplicate' ? 'A clean current fact' : reworded;
          const key = { namespace, client: source.client, eventId: 'manual-event', payloadDigest: 'a'.repeat(64) };
          const token = cell.path === 'finish' ? ok(f.core.claimAdmission({ ...key, leaseMs: 125000 })).token : undefined;
          const revision = (current?.revision ?? 0) + (cell.state === 'guard' ? 1 : 0);
          const write = () => {
            if (['admit', 'duplicate'].includes(cell.path)) return f.core.admit({ namespace,
              memory: { content, kind: 'fact' }, receipts, ...(cell.state === 'guard' ? { unexpected: true } : {}) });
            if (cell.path === 'finish') return f.core.finishAdmission({ ...key,
              token: cell.state === 'guard' ? 'absent' : token, items: [{ content, kind: 'fact', confidence: .9, receipts }] });
            if (cell.path === 'correct') return f.core.correct({ namespace, memoryId: current.id,
              expectedRevision: revision, content, kind: 'fact', receipt: receipts[0] });
            return f.core.supersede({ namespace, memoryId: current.id, expectedRevision: revision,
              replacement: { content, kind: 'fact' }, receipts });
          };
          const fault = cell.state === 'receipt-storage' ? /INSERT INTO receipts/ :
            cell.state === 'epoch-storage' ? /INSERT INTO namespace_epochs/ : undefined;
          const material = () => ['memories', 'receipts', 'namespace_epochs', 'admission_claims', 'suppressed']
            .map(name => f.db.prepare(`SELECT * FROM ${name}`).all().map(row => JSON.stringify(row)).sort());
          const prior = material(), measured = meter(write, fault), result = measured.value;
          if (!result.ok) assert.deepEqual(material(), prior, 'a refusal rolls back all material writes');
          rows.push({ shape, ...cell, result: result.ok ? { ok: true,
            ...Object.fromEntries(['deduplicated', 'duplicate', 'suppressedCount', 'indexRevision'].filter(key =>
              Object.hasOwn(result.value, key)).map(key => [key, result.value[key]])),
            ...(result.value.memories ? { memories: result.value.memories.length } : {}) } : result,
            tokenExecuted: measured.counts.tokenExecuted });
        }
      });
      outcomes.push(rows);
      console.log(JSON.stringify({ kind: 'admit-matrix-version', version, cells: rows.length }));
    }
    assert.equal(outcomes[0].length, 300);
    const changed = Object.fromEntries(pathsToCheck.map(path => [path, 0]));
    for (const [index, a] of outcomes[0].entries()) {
      const b = outcomes[1][index];
      const admittedSource = a.path !== 'correct' || a.order !== 'last';
      const shouldChange = a.result.ok && a.marked && a.state === 'allowed' && admittedSource;
      if (shouldChange) {
        assert.deepEqual(b.result, { ok: false, error: { code: 'source_excluded', retryable: false } });
        assert.equal(b.tokenExecuted, 1); changed[a.path]++;
      } else assert.deepEqual(b.result, a.result, 'every base outcome stays equal outside allowed token hits');
      if (!a.result.ok) assert.equal(b.tokenExecuted, 0, 'existing errors precede token validation');
    }
    console.log(JSON.stringify({ kind: 'base-admit-outcomes', base, cells: 300, changed,
      result: 'equal except allowed-to-refused(source_excluded) on token hits' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { openMemoryCore } from '../../core/index.mjs';
import { createTestWorkspace } from './workspace.mjs';

const base = '1280bf75';
const root = fileURLToPath(new URL('../../', import.meta.url));
const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'probe' };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const ok = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

function command(program, args, input) {
  const result = spawnSync(program, args, { cwd: root, input, maxBuffer: 128 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

function markerLookup({ sql }) {
  return (sql.startsWith('SELECT s.fingerprint FROM json_each(?) w CROSS JOIN suppressed s') ||
    sql.startsWith('SELECT r.id FROM json_each(?) wanted\nCROSS JOIN receipts r') ||
    sql.startsWith('SELECT r.id FROM json_each(?) page\nCROSS JOIN json_each(page.value,') ||
    sql.startsWith('WITH marker_selection AS MATERIALIZED (')) &&
    /(?:CROSS JOIN|JOIN) suppressed s\b/.test(sql) && sql.includes('s.fingerprint=');
}

async function trace(t, work) {
  const statements = [];
  const hooks = [t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    statements.push({ method: 'exec', sql, bindings: [] });
    return exec.call(this, sql);
  })];
  for (const method of ['get', 'all', 'run', 'iterate']) {
    const original = StatementSync.prototype[method];
    hooks.push(t.mock.method(StatementSync.prototype, method, function (...bindings) {
      statements.push({ method, sql: this.sourceSQL, bindings });
      return original.apply(this, bindings);
    }));
  }
  try { return { value: await work(), statements }; }
  finally { for (const hook of hooks) hook.mock.restore(); }
}

const exec = DatabaseSync.prototype.exec;

function compare(t, before, after, rationaleMode) {
  assert.deepEqual(after.value, before.value, 'result envelopes, cursors and model inputs');
  const prior = before.statements.filter(statement => !markerLookup(statement));
  const current = after.statements.filter(statement => !markerLookup(statement));
  if (rationaleMode) {
    const order = statements => {
      const sourceReads = statements.flatMap(({ sql }, index) => sql.startsWith(
        'SELECT * FROM receipts WHERE memory_id = ? ORDER BY created_at, id LIMIT ') ? [index] : []);
      const history = statements.findIndex(({ sql }) => sql.includes('FROM receipts WHERE memory_id=?') && sql.includes('AND id IN ('));
      assert.ok(sourceReads.length > 1 && history >= 0);
      return history < sourceReads[1];
    };
    t.diagnostic(`root history safety precedes the rationale source read: parent ${order(prior)}, head ${order(current)}`);
  }
  const first = prior.findIndex((statement, index) => JSON.stringify(statement) !== JSON.stringify(current[index]));
  if (first !== -1) assert.deepEqual(current[first], prior[first], 'SQL execution ' + (first + 1));
  assert.equal(current.length, prior.length, 'SQL executions');
  t.diagnostic(`${current.length} identical executions and ${after.statements.length - current.length} scoped marker lookups`);
}

test('no-marker SQL, results and model inputs match the parent', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'shared-source-parity-' });
  const baseline = join(workspace.path, 'base');
  mkdirSync(baseline);
  command('tar', ['-xf', '-', '-C', baseline], command('git', ['archive', base, 'core', 'plugins/cairn-memory/lib/redact.mjs']));
  const { openMemoryCore: openBase } = await import(pathToFileURL(join(baseline, 'core/index.mjs')));
  const path = join(workspace.path, 'store.sqlite');
  const seed = openMemoryCore({ path, model: {
    contextWindow: 8192,
    countTokens: () => 1,
    relate: () => ({ edges: [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] }),
  } });
  let refs;
  try {
    refs = [0, 1].map(index => ref(ok(seed.admit({ namespace,
      memory: { kind: 'fact', content: 'Synthetic Memory ' + index },
      receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'event-' + index, role: 'user', excerpt: 'Proof ' + index }],
    })).memory));
    assert.equal(ok(await seed.reviewRationale({ namespace, refs })).inserted, 1);
  } finally { seed.close(); }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM suppressed WHERE fingerprint GLOB 'rs1:*'").get().n, 0);
  } finally { db.close(); }

  async function exercise(t, open, mode, operation) {
    const inputs = [];
    const core = open({ path, model: {
      contextWindow: 8192,
      countTokens(text) { inputs.push(['count', text]); return 1; },
      select({ input }) { inputs.push(['select', input]); return { refs: refs.map(value => ({ namespaceIndex: 0, ...value })) }; },
      rank({ input }) { inputs.push(['rank', input]); return { refs: refs.map(value => ({ namespaceIndex: 0, ...value })) }; },
    } });
    try {
      return await trace(t, async () => {
        const request = mode ? { contextMode: mode } : {};
        if (operation === 'recall') {
          const response = await core.recall({ readSet: [namespace], query: 'Synthetic', ...request });
          assert.equal(ok(response).memories.length, 2);
          return { response, inputs };
        }
        const response = core.fetch({ namespace, refs, ...request });
        assert.ok(ok(response).nextCursor);
        const next = core.fetch({ namespace, refs, cursor: response.value.nextCursor, ...request });
        assert.ok(ok(next).exhausted);
        const invalid = core.fetch({ namespace, refs, cursor: response.value.nextCursor + 'x', ...request });
        assert.equal(invalid.error.code, 'invalid_cursor');
        return { response, next, invalid, inputs };
      });
    } finally { core.close(); }
  }

  for (const [operation, mode] of [
    ['fetch', 'source-evidence'], ['fetch', 'rationale-evidence'],
    ['recall', undefined], ['recall', 'source-evidence'], ['recall', 'rationale-evidence'],
  ]) {
    await t.test(`${operation} ${mode ?? 'ordinary'}`, async t => {
      compare(t, await exercise(t, openBase, mode, operation), await exercise(t, openMemoryCore, mode, operation), mode === 'rationale-evidence');
    });
  }
});

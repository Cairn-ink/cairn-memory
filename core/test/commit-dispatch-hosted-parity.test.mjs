import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../contract.mjs';

const base = 'a8de07ba7dbb61fcebe4bb80f06e5f6d092c35e2';
const ns = { ownerId: 'synthetic-hosted-commit', scope: 'personal', projectId: null };
const receipt = eventId => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt: 'Synthetic source' });
const admit = { namespace: ns, memory: { content: 'Synthetic hosted parity memory', kind: 'fact' }, receipts: [receipt('original')] };

// Compare complete envelopes with a bijection for independently allocated IDs.
// Fixed wall time keeps every timestamp and cursor anchor comparable as well.
function identities(value) {
  const ids = new Map();
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(item)) {
      if (!ids.has(item)) ids.set(item, 'id-' + ids.size);
      return ids.get(item);
    }
    return item;
  }));
}
async function trace(open, path) {
  const operations = [], sql = [], originals = new Map();
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-13T00:00:00.000Z'])); }
    static now() { return NativeDate.parse('2026-11-13T00:00:00.000Z'); }
  };
  for (const [prototype, methods] of [[DatabaseSync.prototype, ['exec']], [StatementSync.prototype, ['get','all','run','iterate']]]) {
    for (const method of methods) {
      const original = prototype[method]; originals.set([prototype, method], original);
      prototype[method] = function(...args) {
        sql.push([method, method === 'exec' ? args[0] : this.sourceSQL]);
        return Reflect.apply(original, this, args);
      };
    }
  }
  let core;
  try {
    core = open({ path, model: { contextWindow: 8192, countTokens: () => 1,
      extract: async () => ({ items: [{ content: 'Synthetic captured parity memory', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
    const first = core.admit(admit);
    assert.equal(typeof first?.then, 'undefined', 'hosted admission remains synchronous');
    operations.push(first); const id = first.value.memory.id;
    operations.push(core.get({ namespace: ns, memoryId: id }));
    operations.push(core.list({ namespace: ns }));
    operations.push(core.correct({ namespace: ns, memoryId: id, expectedRevision: 99,
      content: 'Synthetic corrected parity', kind: 'fact', receipt: receipt('correction') }));
    const corrected = core.correct({ namespace: ns, memoryId: id, expectedRevision: 1,
      content: 'Synthetic corrected parity', kind: 'fact', receipt: receipt('correction') });
    operations.push(corrected);
    operations.push(core.forget({ namespace: ns, memoryId: id, expectedRevision: 99 }));
    operations.push(core.forget({ namespace: ns, memoryId: id, expectedRevision: corrected.value.memory.revision }));
    operations.push(core.get({ namespace: ns, memoryId: id }));
    operations.push(await core.capture({ namespace: ns, client: 'synthetic', sessionId: 'session', eventId: 'batch',
      messages: [{ id: 'message', role: 'user', content: 'Synthetic captured parity source' }] }));
    operations.push(core.list({ namespace: ns }));
    core.close(); core = null;
    return { operations: identities(operations), sql };
  } finally {
    core?.close(); globalThis.Date = NativeDate;
    for (const [[prototype, method], original] of originals) prototype[method] = original;
  }
}

test('no-dispatcher hosted envelopes, refusals and complete SQL sequence equal the merged base', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'commit-hosted-parity-' });
  const archive = join(workspace.path, 'base.tar');
  execFileSync('git', ['archive', '--output', archive, base, 'core', 'tools/testing', 'plugins/cairn-memory/lib/redact.mjs']);
  execFileSync('tar', ['-xf', archive, '-C', workspace.path]);
  const previous = await import(pathToFileURL(join(workspace.path, 'core/contract.mjs')).href);
  const expected = await trace(previous.openMemoryCore, join(workspace.path, 'base.sqlite'));
  const actual = await trace(openMemoryCore, join(workspace.path, 'current.sqlite'));
  assert.deepEqual(actual.operations, expected.operations, 'default hosted envelopes and refusal codes must remain identical');
  assert.deepEqual(actual.sql, expected.sql, 'default hosted SQL statement sequence must remain identical');
  t.diagnostic('hosted parity: ' + actual.operations.length + ' complete envelopes, ' + actual.sql.length + ' SQL executions');
});

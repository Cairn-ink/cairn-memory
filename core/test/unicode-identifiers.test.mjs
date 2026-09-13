import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { identifier } from '../validation.mjs';

const ns = (ownerId, projectId = null) => ({ ownerId,
  scope: projectId === null ? 'personal' : 'project', projectId });
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const admission = namespace => ({ namespace, memory: { content: 'Synthetic marker', kind: 'fact' },
  receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'event',
    role: 'user', excerpt: 'Synthetic marker' }] });

test('U1 malformed identifiers reject while valid strings retain exact identity', () => {
  for (const value of ['x\ud800', 'x\udc00', '\udc00\ud800', '\ud800a']) {
    assert.throws(() => identifier(value), { code: 'invalid_identifier' });
  }
  for (const value of ['x🚋', 'x\ufffd', 'é', 'e\u0301', 'Ａ', 'A']) {
    assert.equal(identifier(value), value);
  }
});

test('U2 invalid owner and project aliases cannot admit or read canonical replacement-character namespaces', t => {
  const core = openMemoryCore({ path: ':memory:' }); t.after(() => core.close());
  for (const field of ['owner', 'project']) {
    const canonical = field === 'owner' ? ns('synthetic-\ufffd') : ns('synthetic', 'project-\ufffd');
    const saved = ok(core.admit(admission(canonical))).memory;
    const before = ok(core.get({ namespace: canonical, memoryId: saved.id }));
    for (const lone of ['\ud800', '\udc00']) {
      const malformed = field === 'owner' ? ns(`synthetic-${lone}`) : ns('synthetic', `project-${lone}`);
      for (const result of [core.admit(admission(malformed)),
        core.get({ namespace: malformed, memoryId: saved.id }), core.list({ namespace: malformed })]) {
        assert.deepEqual(result, { ok: false, error: { code: 'invalid_input', retryable: false } });
      }
      assert.deepEqual(ok(core.get({ namespace: canonical, memoryId: saved.id })), before);
    }
  }
});

test('U2 record, receipt and admission identifiers reject without changing stored state', t => {
  const core = openMemoryCore({ path: ':memory:' }); t.after(() => core.close());
  const namespace = ns('synthetic'); const saved = ok(core.admit(admission(namespace))).memory;
  const before = ok(core.get({ namespace, memoryId: saved.id }));
  for (const lone of ['\ud800', '\udc00']) {
    for (const field of ['client', 'sessionId', 'eventId']) {
      const value = admission(namespace); value.receipts[0][field] += lone;
      assert.equal(core.admit(value).error?.code, 'invalid_input');
    }
    assert.equal(core.get({ namespace, memoryId: `id-${lone}` }).error?.code, 'invalid_input');
    assert.equal(core.claimAdmission({ namespace, client: 'synthetic', eventId: `event-${lone}`,
      payloadDigest: 'a'.repeat(64), leaseMs: 1000 }).error?.code, 'invalid_input');
  }
  assert.deepEqual(ok(core.get({ namespace, memoryId: saved.id })), before);
});

test('U2 legacy namespaces reject malformed owner and project identities', t => {
  const store = openMemoryStore({ path: ':memory:' }); t.after(() => store.close());
  for (const lone of ['\ud800', '\udc00']) {
    assert.throws(() => store.scope({ ownerId: `synthetic-${lone}` }), { code: 'invalid_identifier' });
    assert.throws(() => store.scope({ ownerId: 'synthetic', projectId: `project-${lone}` }), { code: 'invalid_identifier' });
  }
});

test('U3 valid distinct Unicode namespaces stay separate across a full cold reopen', t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-unicode-identifiers-')), 'synthetic.sqlite');
  let core = openMemoryCore({ path }); t.after(() => core.close());
  const namespaces = ['synthetic-🚋', 'synthetic-\ufffd', 'synthetic-é', 'synthetic-e\u0301',
    'synthetic-Ａ', 'synthetic-A'].map(owner => ns(owner));
  const records = namespaces.map(namespace => ({ namespace, saved: ok(core.admit(admission(namespace))).memory }));
  assert.equal(new Set(records.map(r => r.saved.id)).size, records.length);
  core.close(); core = openMemoryCore({ path });
  for (const row of records) {
    assert.deepEqual(ok(core.get({ namespace: row.namespace, memoryId: row.saved.id })).memory.namespace, row.namespace);
    for (const foreign of records.filter(other => other !== row)) {
      assert.equal(core.get({ namespace: foreign.namespace, memoryId: row.saved.id }).error?.code, 'memory_not_found');
    }
  }
});

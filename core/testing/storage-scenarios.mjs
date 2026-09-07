import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { boundedText } from '../validation.mjs';

// Test-only adapter. Never import this module into a host or expose fixture IDs
// as public inputs. No model exists in this supported model-free action subset.
export const storageCaseIds = Object.freeze(['M08', 'M10', 'M13', 'M16', 'M18', 'M20', 'M23', 'M29']);
const actionFields = {
  get: ['operation', 'memoryId', 'modelAvailable', 'expectedError'],
  list: ['operation', 'limit', 'modelAvailable', 'saveCursorAs', 'cursorFrom', 'expectedError'],
  correct: ['operation', 'memoryId', 'expectedRevision', 'replacementMemoryFixtureId',
    'expectedMemoryFixtureId', 'receiptId', 'expectedError'],
  forget: ['operation', 'memoryId', 'expectedRevision', 'expectedError'],
  admit: ['operation', 'memoryFixtureId', 'expectedMemoryFixtureId', 'receiptId', 'client', 'eventId', 'expectedError'],
  restart: ['operation'],
};
const expectationFields = ['status', 'error', 'memoryIds', 'receiptIds', 'runtimeMemoryIds',
  'modelCalls', 'receiptExcerpts', 'listedMemoryFixtureIds', 'exhausted', 'revision',
  'filing', 'removedReceiptIds'];
const metadataFields = ['id', 'namespace', 'kind', 'origin', 'confidence', 'revision',
  'state', 'filing', 'receiptCount', 'createdAt', 'updatedAt'].sort();
const keys = (value, allowed) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'expected object');
  for (const key of Object.keys(value)) assert(allowed.includes(key), `unsupported field: ${key}`);
};
const success = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const sorted = (values) => [...values].sort();
const boundary = (value) => ({ ownerId: value.ownerId,
  scope: value.projectId === null ? 'personal' : 'project', projectId: value.projectId });

export function runStorageScenario(corpus, caseId) {
  const matches = corpus.memoryCases.filter((value) => value.id === caseId);
  assert.equal(matches.length, 1, `missing/duplicate scenario: ${caseId}`);
  const scenario = matches[0];
  keys(scenario.expected, expectationFields);
  assert(['ok', 'error'].includes(scenario.expected.status), 'unsupported status');
  if (scenario.expected.status === 'error') {
    keys(scenario.expected, ['status', 'error', 'memoryIds', 'receiptIds', 'runtimeMemoryIds', 'modelCalls']);
  } else assert.equal(scenario.expected.error, undefined, 'successful outcome cannot declare an error');
  for (const step of scenario.steps) {
    assert(Object.hasOwn(actionFields, step.operation), `unsupported operation: ${step.operation}`);
    keys(step, actionFields[step.operation]);
    if ('modelAvailable' in step) assert.equal(step.modelAvailable, false);
  }
  const fixtures = new Map(corpus.memories.map((value) => [value.id, value]));
  assert.equal(fixtures.size, corpus.memories.length, 'duplicate snapshot');
  const lookup = (id) => { const value = fixtures.get(id); assert(value, `unknown snapshot: ${id}`); return value; };
  const runtimeIds = new Map();
  const receiptIds = new Map();
  const cursors = new Map();
  const resolveId = (id) => { assert(runtimeIds.has(id), `unbound runtime alias: ${id}`); return runtimeIds.get(id); };
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-storage-scenario-')), 'memory.sqlite');
  let core = openMemoryCore({ path });
  const namespace = boundary(scenario.namespace);
  const makeReceipt = (value, step = {}) => ({ client: step.client ?? 'fixture',
    sessionId: scenario.id, eventId: step.eventId ?? value.receipt.id,
    role: 'user', excerpt: boundedText(value.receipt.excerpt, 800, true) });

  function bindSource(value, memoryId, receiptInput, sourceNamespace) {
    const detail = success(core.get({ namespace: sourceNamespace, memoryId }));
    const matches = detail.receipts.filter((r) => r.client === receiptInput.client &&
      r.sessionId === receiptInput.sessionId && r.eventId === receiptInput.eventId &&
      r.excerpt === receiptInput.excerpt && r.role === receiptInput.role);
    assert.equal(matches.length, 1, 'source must be actually returned, not manufactured');
    assert.ok(matches[0].id);
    if (receiptIds.has(value.receipt.id)) assert.equal(receiptIds.get(value.receipt.id), matches[0].id);
    receiptIds.set(value.receipt.id, matches[0].id);
  }

  try {
    for (const id of scenario.setupMemoryIds) {
      const value = lookup(id);
      assert.equal(value.origin, 'explicit', 'inferred seeding requires a future adapter');
      assert.equal(value.revision, 1, 'non-initial snapshot seeding is unsupported');
      const sourceNamespace = boundary(value);
      const source = makeReceipt(value);
      const saved = success(core.admit({ namespace: sourceNamespace,
        memory: { content: value.content, kind: value.kind }, receipts: [source] }));
      const alias = value.runtimeId ?? value.id;
      assert(!runtimeIds.has(alias), 'multiple initial versions of a runtime ID');
      runtimeIds.set(alias, saved.memory.id);
      bindSource(value, saved.memory.id, source, sourceNamespace);
      // Fixture initialization only, before scenario actions/cursors. Pin source
      // timestamps without replacing generated runtime/receipt IDs or revisions.
      const seedDb = new DatabaseSync(path);
      try {
        seedDb.exec('BEGIN IMMEDIATE');
        seedDb.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?')
          .run(value.updatedAt, value.updatedAt, saved.memory.id);
        seedDb.prepare('UPDATE receipts SET created_at = ? WHERE memory_id = ?')
          .run(value.updatedAt, saved.memory.id);
        seedDb.exec('COMMIT');
      } finally { seedDb.close(); }
    }
    let last;
    for (const [index, step] of scenario.steps.entries()) {
      if (step.operation === 'restart') { core.close(); core = openMemoryCore({ path }); continue; }
      switch (step.operation) {
        case 'get': last = core.get({ namespace, memoryId: resolveId(step.memoryId) }); break;
        case 'list': {
          if (step.cursorFrom) assert(cursors.has(step.cursorFrom), 'missing saved cursor');
          last = core.list({ namespace, limit: step.limit,
            ...(step.cursorFrom ? { cursor: cursors.get(step.cursorFrom) } : {}) });
          if (last.ok && step.saveCursorAs) {
            assert.ok(last.value.nextCursor, 'fixture expected a continuing page');
            cursors.set(step.saveCursorAs, last.value.nextCursor);
          }
          break;
        }
        case 'correct': {
          const value = lookup(step.replacementMemoryFixtureId);
          assert.equal(value.id, step.expectedMemoryFixtureId);
          assert.equal(value.receipt.id, step.receiptId);
          const source = makeReceipt(value);
          const memoryId = resolveId(step.memoryId);
          last = core.correct({ namespace, memoryId, expectedRevision: step.expectedRevision,
            content: value.content, kind: value.kind, receipt: source });
          if (last.ok) {
            assert.equal(last.value.memory.id, memoryId, 'correction changed runtime identity');
            bindSource(value, memoryId, source, namespace);
          }
          break;
        }
        case 'forget': last = core.forget({ namespace, memoryId: resolveId(step.memoryId),
          expectedRevision: step.expectedRevision }); break;
        case 'admit': {
          const value = lookup(step.memoryFixtureId);
          assert.equal(value.id, step.expectedMemoryFixtureId);
          assert.equal(value.receipt.id, step.receiptId);
          assert.equal(value.origin, 'explicit', 'inferred admission is unsupported');
          const source = makeReceipt(value, step);
          last = core.admit({ namespace, memory: { content: value.content, kind: value.kind }, receipts: [source] });
          if (last.ok) {
            const alias = value.runtimeId ?? value.id;
            if (runtimeIds.has(alias)) assert.equal(runtimeIds.get(alias), last.value.memory.id);
            runtimeIds.set(alias, last.value.memory.id);
            bindSource(value, last.value.memory.id, source, namespace);
          }
          break;
        }
        default: assert.fail(`unsupported operation: ${step.operation}`);
      }
      if (step.expectedError) {
        assert.equal(last.ok, false);
        assert.equal(last.error.code, step.expectedError);
      } else if (index !== scenario.steps.length - 1) success(last);
    }
    const expected = scenario.expected;
    assert(last, 'scenario has no observable operation');
    assert.equal(last.ok, expected.status === 'ok');
    if (expected.status === 'error') {
      assert.equal(last.error.code, expected.error);
      assert.equal(last.value, undefined, 'failed result leaked a payload');
      for (const field of ['memoryIds', 'receiptIds', 'runtimeMemoryIds']) assert.deepEqual(expected[field], []);
    } else {
      const value = last.value;
      const returned = value.memory ? [value.memory] : [];
      assert.deepEqual(sorted(returned.map((m) => m.id)), sorted(expected.memoryIds.map((id) => {
        const fixture = lookup(id); return resolveId(fixture.runtimeId ?? id);
      })));
      assert.deepEqual(sorted(returned.map((m) => m.id)), sorted(expected.runtimeMemoryIds.map(resolveId)));
      for (const id of expected.memoryIds) {
        const fixture = lookup(id);
        const actual = returned.find((m) => m.id === resolveId(fixture.runtimeId ?? id));
        assert.equal(actual.content, fixture.content);
        assert.equal(actual.kind, fixture.kind);
        assert.equal(actual.revision, fixture.revision);
        assert.equal(actual.origin, fixture.origin);
        assert.deepEqual(actual.namespace, boundary(fixture));
      }
      assert.deepEqual(sorted((value.receipts ?? []).map((r) => r.id)), sorted(expected.receiptIds.map((id) => {
        assert(receiptIds.has(id), `unbound receipt alias: ${id}`); return receiptIds.get(id);
      })));
      for (const [id, excerpt] of Object.entries(expected.receiptExcerpts ?? {})) {
        assert.equal(value.receipts.find((r) => r.id === receiptIds.get(id))?.excerpt, excerpt);
      }
      for (const id of expected.removedReceiptIds ?? []) {
        assert(receiptIds.has(id), 'unbound removed receipt');
        assert(!(value.receipts ?? []).some((r) => r.id === receiptIds.get(id)));
      }
      if (expected.listedMemoryFixtureIds) {
        assert.deepEqual(sorted(value.memories.map((m) => m.id)),
          sorted(expected.listedMemoryFixtureIds.map((id) => resolveId(lookup(id).runtimeId ?? id))));
        for (const memory of value.memories) assert.deepEqual(Object.keys(memory).sort(), metadataFields);
      }
      if ('exhausted' in expected) assert.equal(value.exhausted, expected.exhausted);
      if ('revision' in expected) assert.equal(value.memory.revision, expected.revision);
      if ('filing' in expected) assert.equal(value.memory.filing.status, expected.filing);
    }
    if ('modelCalls' in expected) assert.equal(expected.modelCalls, 0, 'this adapter has no model operations');
    return { caseId, status: 'passed', path };
  } finally { core.close(); }
}

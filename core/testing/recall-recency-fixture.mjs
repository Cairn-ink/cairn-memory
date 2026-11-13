import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createQueryScore } from '../query-candidates.mjs';
import { createQueryExcerpt } from '../query-excerpt.mjs';
import { fail } from '../validation.mjs';
import { eventTimeSafetyFixture } from './receipt-event-time-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const namespace = { ownerId: 'recency-tests', scope: 'personal', projectId: null };
export const ns = { ...namespace, projectId: '' };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const key = index => createHash('sha256').update('synthetic-row-' + index).digest('hex');
export const marker = index => 'distinctive' + index;
export const model = (pages = []) => ({ contextWindow: 16384,
  countTokens(text) {
    try { const frame = JSON.parse(text); if (frame.ok && frame.value?.items) pages.push(frame.value); } catch {}
    return 1;
  },
  select: ({ input }) => ({ refs: input.maps.flatMap(page => page.items
    .filter(item => item.label.includes(input.query))
    .map(item => ({ namespaceIndex: page.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
      : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))).slice(0, Math.min(12,input.maxRefs)) }),
  rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(item => ({
    namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) }),
});

export function fixture(t, port = model()) {
  const workspace = createTestWorkspace(t, { prefix: 'recency-scan-' });
  const path = join(workspace.path, 'store.sqlite');
  const core = openMemoryCore({ path, model: port }); workspace.defer(() => core.close());
  let db;
  const runtime = createMemoryRuntime({ path }, { attachRaw(connection) { db = connection; } });
  workspace.defer(() => runtime.close());
  return { workspace, path, core, runtime, db };
}

// Test-only builtin replacement updates the engine's existing UUID bindings.
export function installAscendingUUIDs(t, initial = 0) {
  let counter = initial;
  const mock = t.mock.method(crypto, 'randomUUID', () =>
    '00000000-0000-4000-8000-' + String(++counter).padStart(12, '0'));
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
}

export async function layoutFixture(t, layout, port = model()) {
  if (layout === 'plain') return fixture(t, port);
  assert.equal(layout, 53);
  const f = eventTimeSafetyFixture(t, 33);
  await f.migrate();
  const core = openMemoryCore({ path: f.path, model: port });
  f.workspace.defer(() => core.close());
  let db;
  const runtime = createMemoryRuntime({ path: f.path }, { attachRaw(connection) { db = connection; } });
  f.workspace.defer(() => runtime.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  return { ...f, core, runtime, db };
}

// Only fresh synthetic stores use SQL seeding. Each body is 150–600 ASCII
// characters; timestamps put the last writes first independently of hashed IDs.
export function seed(db, count, targetNamespace = ns, offset = 0, identify = key) {
  const memory = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
      deleted,created_at,updated_at,filing_status,currentness)
    VALUES (?,?,?,?,?,?,'fact','explicit',1,1,0,?,?,'unfiled','current')`);
  const receipt = db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'synthetic','recency',?,'user',?,'2026-01-01')`);
  db.exec('BEGIN');
  try {
    for (let index = 1 + offset; index <= count + offset; index++) {
      const id = identify(index), content = `${marker(index)} note ` + 'realistic ordinary note text '.repeat(24);
      const body = content.slice(0, 150 + index % 451);
      const source = `${marker(index)} sourceonly${index} original note`;
      const eventId = 'event-' + index;
      const receiptKey = createHash('sha256').update(JSON.stringify({ client: 'synthetic',
        sessionId: 'recency', eventId, role: 'user', excerpt: source })).digest('hex');
      const time = new Date(Date.UTC(2026,0,1) + index * 1000).toISOString();
      memory.run(id, targetNamespace.ownerId, targetNamespace.scope, targetNamespace.projectId, id, body, time, time);
      receipt.run('receipt-' + index, id, receiptKey, eventId, source);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export const query = (runtime, text, options = {}) => runtime.queryCandidateRows(ns, {
  score: createQueryScore(text), memoryLabel: createQueryExcerpt(text), ...options,
});

// Reproduction of the default candidate algorithm at 56968dca:
// capture_current_memories ID prefix + 1 sentinel, same literal scorer,
// strict receipt improvement (stable receipt-ID order), score DESC then ID ASC.
// These fixtures have no placements, suppressed rows or published generation.
// Freeze the base scorer too, so a future scorer edit cannot update both sides.
function baseQueryScore(query) {
  const words = /[\p{L}\p{N}]+/gu;
  if (typeof query !== 'string' || query.length > 4000) fail('invalid_input');
  const wanted = new Set(Array.from(query.matchAll(words), match => match[0].toLowerCase()));
  return content => {
    if (typeof content !== 'string' || content.length > 4000) fail('invalid_input');
    const matched = new Set();
    for (const match of content.matchAll(words)) {
      const word = match[0].toLowerCase();
      if (wanted.has(word)) matched.add(word);
    }
    return matched.size;
  };
}
export function baseCandidates(db, text, sourceReceiptLimit = 0) {
  const score = baseQueryScore(text), label = createQueryExcerpt(text);
  const scanned = db.prepare(`SELECT id,revision,content,deleted,currentness FROM memories
    INDEXED BY capture_current_memories WHERE owner_id=? AND scope=? AND project_id=?
      AND deleted=0 AND review_state!='awaiting' AND currentness='current' ORDER BY id LIMIT ?`)
    .all(ns.ownerId, ns.scope, ns.projectId, 1025);
  const eligible = scanned.slice(0,1024).map(memory => {
    let candidateScore = score(memory.content), excerpt;
    if (sourceReceiptLimit) for (const receipt of db.prepare(`SELECT * FROM receipts
      INDEXED BY capture_memory_receipts WHERE memory_id=? ORDER BY id LIMIT ?`).all(memory.id, sourceReceiptLimit)) {
      const receiptScore = score(receipt.excerpt);
      if (receiptScore > candidateScore) { candidateScore = receiptScore; excerpt = receipt.excerpt; }
    }
    return { memory, score: candidateScore, excerpt };
  });
  eligible.sort((a,b) => b.score-a.score || (a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0));
  return { rows: eligible.map(({ memory, excerpt }) => ({ item: { type: 'unfiled',
    ref: { memoryId: memory.id, revision: memory.revision }, label: label(excerpt ?? memory.content) } })),
    scanExhausted: scanned.length <= 1024 };
}

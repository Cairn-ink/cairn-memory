import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../core/index.mjs';

// Synthetic, model-free host example. This function stands in for an already
// verified host user-intent channel; receiving a tool call must never call it.
const approved = new WeakMap(), issued = new WeakMap();
function approveSyntheticIntent(method, input, actionClass) {
  const token = Object.freeze({});
  approved.set(token, { method, input: structuredClone(input), actionClass });
  return token;
}
const authority = {
  authorize(request, token) {
    const intent = approved.get(token);
    if (!intent || request.method !== intent.method || request.actionClass !== intent.actionClass ||
        !isDeepStrictEqual(request.input, intent.input)) return null;
    const grant = Object.freeze({});
    const { input, ...binding } = request;
    issued.set(grant, { ...binding, accessGeneration: 1 });
    return grant;
  },
  isCurrent(grant) { return issued.get(grant) ?? null; },
};
const privateCards = { version: 'private-cards-local-v1', source: 'submitted-note-v1',
  storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-private-cards-')), 'memory.sqlite');
const namespace = { ownerId: 'synthetic-person', scope: 'personal', projectId: null };
let core = openMemoryCore({ path, privateCards });
function call(method, input, actionClass) {
  const result = core[method](input, approveSyntheticIntent(method, input, actionClass));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
try {
  const create = { namespace, actionId: 'synthetic-create', drafting: 'authored', input: {
    title: 'Tea notes', body: 'For my next tasting, compare two steeping times.',
    authoredInput: { text: '  Tasting note\nCompare 90 s and 120 s.\n', occurredAt: null },
  } };
  // One explicit disclosed submission atomically retains the note and draft.
  const draft = call('createCardDraft', create, 'explicit-user');
  const inspected = call('getCard', { namespace, cardId: draft.id }, 'read').card;
  const source = inspected.bindings[0].source;
  const exact = call('getSource', { namespace, source }, 'read');
  assert.equal(exact.parts.map(part => part.text).join(''), create.input.authoredInput.text);
  // A real host obtains a separate verified private-save decision after showing
  // this exact title/body/bindings/revision. This example uses synthetic intent.
  const confirmed = call('confirmCardDraft', { namespace, cardId: draft.id,
    expectedRevision: inspected.revision, actionId: 'synthetic-confirm' }, 'explicit-user');
  core.close();
  core = openMemoryCore({ path, privateCards });
  assert.equal(call('getCard', { namespace, cardId: draft.id }, 'read').card.body, create.input.body);
  call('deleteSourceNote', { namespace, sourceId: source.sourceId,
    expectedRevision: source.revision, actionId: 'synthetic-delete-note' }, 'explicit-user');
  const unsupported = call('getCard', { namespace, cardId: draft.id }, 'read').card;
  assert.equal(unsupported.support.status, 'unavailable');
  assert.equal(unsupported.support.applicability, 'unknown');
  assert.equal(unsupported.body, create.input.body);
  call('deleteKnowledgeCard', { namespace, cardId: draft.id,
    expectedRevision: unsupported.revision, actionId: 'synthetic-delete-card' }, 'explicit-user');
  assert.equal(call('getCard', { namespace, cardId: draft.id }, 'read').card, null);
  assert.deepEqual(call('createCardDraft', create, 'explicit-user'), draft);
  assert.equal(call('getPrivateCardUsage', { namespace }, 'read').submittedNoteBytes, 0);
  assert.ok(call('listCardEffects', { namespace, limit: 10 }, 'read').effects.length >= 2);
  assert.equal(confirmed.bodyRevision, 1);
  const memory = core.admit({ namespace, memory: { content: 'Compare short tea steeping times.', kind: 'context' },
    receipts: [{ client: 'synthetic-example', sessionId: 'tasting', eventId: 'memory-source', role: 'user',
      excerpt: 'Compare 90 s and 120 s.' }] });
  assert.equal(memory.ok, true);
  const memoryDraft = call('createCardDraft', { namespace, actionId: 'synthetic-memory-card', drafting: 'authored', input: {
    sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace,
      memoryId: memory.value.memory.id, revision: memory.value.memory.revision }],
    title: 'A curated tasting question', body: 'Compare the two steeping times during the next tasting.',
  } }, 'draft');
  const memoryDetail = call('getCard', { namespace, cardId: memoryDraft.id }, 'read').card;
  assert.equal(memoryDetail.bindings[0].dependency, 'memory-interpretation');
  assert.equal(call('getSource', { namespace, source: memoryDetail.bindings[0].source }, 'read').coverage.completeness, 'excerpt-only');
  call('confirmCardDraft', { namespace, cardId: memoryDraft.id, expectedRevision: 1,
    actionId: 'synthetic-confirm-memory-card' }, 'explicit-user');
  core.close(); core = openMemoryCore({ path, privateCards });
  assert.equal(core.correct({ namespace, memoryId: memory.value.memory.id, expectedRevision: memory.value.memory.revision,
    content: 'Compare longer tea steeping times.', kind: 'context', receipt: { client: 'synthetic-example',
      sessionId: 'tasting', eventId: 'revised-memory', role: 'user', excerpt: 'Compare 120 s and 180 s.' } }).ok, true);
  const retainedMemoryCard = call('getCard', { namespace, cardId: memoryDraft.id }, 'read').card;
  assert.equal(retainedMemoryCard.support.status, 'unavailable');
  assert.equal(retainedMemoryCard.body, memoryDetail.body);
  console.log('PASS: explicit note + draft → inspect → confirm → reopen → delete source → qualified private body → delete Card → content-free replay');
  console.log('PASS: retained Memory receipts → authored Card → reopen → Memory correction → unsupported private authored body');
  console.log('Synthetic host intent only; zero model/provider/network calls. No installed MCP, full Raw, common retrieval or publication claim.');
  console.log(`Synthetic SQLite database retained at ${path}`);
} finally { core.close(); }

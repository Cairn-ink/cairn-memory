// Test host only: import the installed archive's public core, never checkout code.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [phase, installed, databasePath, statePath] = process.argv.slice(2);
let modelCalls = 0, httpCalls = 0;
const forbiddenTransport = () => { httpCalls++; assert.fail('Private Card operations must not call HTTP/network'); };
globalThis.fetch = forbiddenTransport;
http.request = http.get = https.request = https.get = forbiddenTransport;
net.connect = net.createConnection = net.Socket.prototype.connect = forbiddenTransport;
syncBuiltinESMExports();
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'npm_config_userconfig']) {
  assert.equal(process.env[name], undefined, `${name} is excluded from the child environment`);
}

const importedCore = join(installed, 'core/index.mjs');
const { openMemoryCore } = await import(pathToFileURL(importedCore).href);
const namespace = { ownerId: 'synthetic-installed-private-card', scope: 'personal', projectId: null };
const otherNamespace = { ...namespace, scope: 'project', projectId: 'synthetic-other-project' };
const text = 'Synthetic provided note: I chose to inspect receipts before confirming a Card.';
const body = 'Inspect the provided note before confirming this synthetic Card.';
const memoryBody = 'A separately authored private Card supported by retained Memory receipts.';
const memoryExcerpts = ['Synthetic retained Memory receipt one.', 'Synthetic retained Memory receipt two.'];
const memoryReceipt = (eventId, excerpt) => ({ client: 'synthetic-installed', sessionId: 'memory-card', eventId,
  role: 'user', excerpt });
function retainedCard(id) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare('SELECT *,body_revision AS bodyRevision FROM private_cards WHERE id=?').get(id);
    row.bindings = [...db.prepare('SELECT source_ref FROM card_bindings WHERE card_id=? ORDER BY position').all(id),
      ...db.prepare('SELECT source_ref FROM card_memory_bindings WHERE card_id=? ORDER BY position').all(id)]
      .map(value => ({ source: JSON.parse(value.source_ref) }));
    const review = db.prepare('SELECT * FROM card_applicability_reviews WHERE card_id=?').get(id);
    row.support = { applicability: review?.reviewed_revision === row.revision ? review.applicability : 'unknown' };
    return row;
  } finally { db.close(); }
}
const tokens = new WeakMap(), grants = new WeakMap();
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
// Only this synthetic trusted host issues tokens, after selecting an exact
// method and payload. Tool data and serialized approval booleans cannot issue one.
function issue(method, input, mode = 'current') {
  const token = Object.freeze({});
  tokens.set(token, { method, input: canonical(input), mode });
  return token;
}
const receiptFields = ['method', 'namespace', 'actionClass', 'actionId', 'targetId', 'expectedRevision', 'payloadBinding'];
const authority = {
  authorize(request, token) {
    const access = tokens.get(token);
    if (!access || access.method !== request.method || access.input !== canonical(request.input)) return undefined;
    assert.deepEqual(Object.keys(request).sort(), [...receiptFields, 'input'].sort());
    assert.ok(Object.isFrozen(request));
    assert.ok(Object.isFrozen(request.input));
    assert.equal(typeof request.payloadBinding, 'string');
    assert.ok(request.payloadBinding.length > 0);
    const read = ['getSource', 'getCard', 'listCards', 'inspectCardOperation', 'listCardEffects', 'getPrivateCardUsage']
      .includes(request.method);
    const draft = ['createCardDraft', 'editCardDraft', 'cancelCardDraft'].includes(request.method);
    assert.equal(request.actionClass, read ? 'read' : draft ? 'draft' : 'explicit-user');
    const grant = Object.freeze({});
    grants.set(grant, { request, access, checks: 0 });
    return grant;
  },
  isCurrent(grant, request) {
    const issued = grants.get(grant);
    if (!issued || issued.request !== request) return undefined;
    issued.checks++;
    if (issued.access.mode === 'revoked' && issued.checks > 1) return undefined;
    const { input: _input, ...receipt } = request;
    return { ...receipt, accessGeneration: 1,
      ...(issued.access.mode === 'wrong-binding' ? { payloadBinding: 'wrong-payload-binding' } : {}) };
  },
};
const forbiddenModel = () => { modelCalls++; assert.fail('Private Cards must not call a model'); };
const model = new Proxy({}, { get: (_target, name) => name === 'onDiagnostic' ? undefined
  : name === 'contextWindow' ? 8192 : forbiddenModel });
const core = openMemoryCore({ path: databasePath, model, privateCards: {
  version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
  disclosure: 'explicit-submitted-note-v1', authority,
} });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const call = (method, input, access) => {
  const payload = { namespace, ...input };
  return core[method](payload, access ?? issue(method, payload));
};
const refused = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
let evidence;
try {
  const capabilities = ok(core.getPrivateCardCapabilities());
  assert.equal(capabilities.version, 'private-cards-local-v1');
  assert.deepEqual(capabilities.sourceTypes, ['submitted-note', 'receipt']);
  assert.deepEqual(capabilities.memorySourcePolicies, ['retained-receipts-v1']);
  assert.deepEqual(capabilities.drafting, ['authored']);
  for (const field of ['raw', 'modelAssisted', 'publication']) assert.equal(capabilities[field], false);
  assert.equal(capabilities.currentEvidence, true);
  assert.equal(capabilities.evidenceReads.version, 'exact-namespace-evidence-v1');
  assert.equal(capabilities.evidenceReads.semanticRelevance, false);
  assert.equal(capabilities.methods.some(name => /capture|raw|conversation/i.test(name)), false);
  const emptyUsage = ok(call('getPrivateCardUsage', {}));
  assert.equal(emptyUsage.raw, 'not-implemented');
  refused(call('getPrivateCardUsage', {}, {}), 'authority_required');
  refused(call('getPrivateCardUsage', {}, { authorized: true }), 'authority_required');
  const usageToken = issue('getPrivateCardUsage', { namespace });
  refused(call('getPrivateCardUsage', {}, JSON.parse(JSON.stringify(usageToken))), 'authority_required');
  refused(call('getPrivateCardUsage', {}, issue('getPrivateCardUsage', { namespace: otherNamespace })), 'authority_required');
  refused(call('getPrivateCardUsage', {}, issue('getPrivateCardUsage', { namespace }, 'wrong-binding')), 'authority_required');
  refused(call('getPrivateCardUsage', {}, issue('getPrivateCardUsage', { namespace }, 'revoked')), 'scope_changed');
  refused(call('submitSourceNote', { actionId: 'refused-note', text: 'Must never be retained.', occurredAt: null },
    { authorized: true }), 'authority_required');
  const approvedNote = { namespace, actionId: 'changed-note', text: 'Approved synthetic text.', occurredAt: null };
  refused(call('submitSourceNote', { ...approvedNote, text: 'Unapproved replacement text.' },
    issue('submitSourceNote', approvedNote)), 'authority_required');
  assert.deepEqual(ok(call('getPrivateCardUsage', {})), emptyUsage, 'refused writes do not retain notes');

  if (phase === 'create') {
    const source = ok(call('submitSourceNote', { actionId: 'submit-note', text, occurredAt: null })).source;
    assert.equal(source.type, 'submitted-note');
    assert.equal(source.completeness, 'provided-note');
    const draftInput = { drafting: 'authored', input: { sources: [source], title: 'Synthetic Card', body } };
    refused(call('createCardDraft', { actionId: 'raw-refused', drafting: 'authored', input: {
      sources: [{ ...source, type: 'raw-conversation' }], title: 'Unsupported raw source', body,
    } }), 'source_unavailable');
    const draft = ok(call('createCardDraft', { ...draftInput, actionId: 'draft-card' }));
    assert.equal(ok(call('getCard', { cardId: draft.id })).card.state, 'draft');
    const confirmed = ok(call('confirmCardDraft', {
      cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm-card',
    }));
    assert.equal(confirmed.state, 'confirmed');
    const dependentDraft = ok(call('createCardDraft', { ...draftInput, actionId: 'dependent-draft' }));
    let memory;
    for (const [index, excerpt] of memoryExcerpts.entries()) {
      memory = ok(core.admit({ namespace, memory: { content: 'Synthetic installed Memory interpretation.', kind: 'context' },
        receipts: [memoryReceipt(`receipt-${index}`, excerpt)] })).memory;
    }
    const memoryInput = { actionId: 'memory-draft', drafting: 'authored', input: {
      sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace,
        memoryId: memory.id, revision: memory.revision }], title: 'Synthetic Memory Card', body: memoryBody,
    } };
    const memoryDraft = ok(call('createCardDraft', memoryInput));
    assert.deepEqual(Object.keys(memoryDraft).sort(), ['bodyRevision', 'effectCount', 'id', 'revision', 'state'].sort());
    const memoryDetail = ok(call('getCard', { cardId: memoryDraft.id })).card;
    const actualReceipts = ok(core.get({ namespace, memoryId: memory.id })).receipts;
    assert.deepEqual(memoryDetail.bindings.map(binding => binding.receiptId).sort(), actualReceipts.map(row => row.id).sort());
    assert.equal(memoryDetail.bindings.length, 2);
    for (const binding of memoryDetail.bindings) {
      assert.equal(binding.dependency, 'memory-interpretation');
      assert.deepEqual(binding.memoryRef, memoryInput.input.memoryRefs[0]);
      assert.equal(binding.source.completeness, 'excerpt-only');
    }
    const memoryConfirmed = ok(call('confirmCardDraft', { cardId: memoryDraft.id,
      expectedRevision: memoryDraft.revision, actionId: 'confirm-memory-card' }));
    const memoryDependentDraft = ok(call('createCardDraft', { ...memoryInput, actionId: 'memory-dependent-draft' }));
    assert.equal(ok(call('getPrivateCardUsage', {})).submittedNoteBytes, Buffer.byteLength(text));
    writeFileSync(statePath, JSON.stringify({ source, confirmed, dependentDraft, memory: { id: memory.id, revision: memory.revision },
      memoryInput, memoryDraft, memoryConfirmed, memoryDependentDraft, memorySources: memoryDetail.bindings.map(binding => binding.source) }),
      { flag: 'wx', mode: 0o600 });
    evidence = { state: confirmed.state, memoryCardState: memoryConfirmed.state, actualReceiptCount: actualReceipts.length };
  } else if (phase === 'restart-delete') {
    const { source, confirmed, dependentDraft, memory, memoryInput, memoryDraft, memoryConfirmed,
      memoryDependentDraft, memorySources } = JSON.parse(readFileSync(statePath, 'utf8'));
    const coldCard = ok(call('getCard', { cardId: confirmed.id })).card;
    assert.equal(coldCard.state, 'confirmed');
    assert.equal(coldCard.body, body);
    assert.deepEqual(coldCard.bindings[0].source, source);
    const coldSource = ok(call('getSource', { source }));
    assert.equal(coldSource.parts.map(part => part.text).join(''), text);
    assert.equal(coldSource.coverage.completeness, 'provided-note');
    assert.equal(coldSource.coverage.conversationCoverage, 'unknown');
    refused(core.getCard({ namespace: otherNamespace, cardId: confirmed.id },
      issue('getCard', { namespace, cardId: confirmed.id })), 'authority_required');
    const deleted = ok(call('deleteSourceNote', {
      sourceId: source.sourceId, expectedRevision: source.revision, actionId: 'delete-note',
    }));
    assert.equal(deleted.state, 'deleted');
    refused(call('getSource', { source }), 'source_unavailable');
    assert.equal(ok(call('getCard', { cardId: dependentDraft.id })).card, null);
    assert.equal(ok(call('getCard', { cardId: confirmed.id })).card, null);
    const retained = retainedCard(confirmed.id);
    assert.equal(retained.state, 'confirmed');
    assert.equal(retained.body, body);
    const effects = ok(call('listCardEffects', { limit: 20 })).effects;
    assert.ok(effects.some(effect => effect.kind === 'evidence_invalidated' && effect.entity.id === confirmed.id));
    assert.ok(effects.some(effect => effect.kind === 'evidence_invalidated' && effect.entity.id === dependentDraft.id));
    assert.equal(ok(call('getPrivateCardUsage', {})).submittedNoteBytes, 0);
    ok(call('deleteKnowledgeCard', {
      cardId: retained.id, expectedRevision: retained.revision, actionId: 'delete-card',
    }));
    const deletedCard = ok(call('getCard', { cardId: retained.id })).card;
    assert.equal(deletedCard, null);
    assert.ok(ok(call('listCardEffects', { limit: 20 })).effects.some(effect =>
      effect.kind === 'card_deleted' && effect.entity.id === retained.id));
    const coldMemoryCard = ok(call('getCard', { cardId: memoryConfirmed.id })).card;
    assert.equal(coldMemoryCard.body, memoryBody);
    assert.equal(coldMemoryCard.state, 'confirmed');
    assert.equal(coldMemoryCard.support.status, 'eligible');
    assert.deepEqual(coldMemoryCard.bindings.map(binding => binding.source), memorySources);
    const coldExcerpts = memorySources.map(source => {
      const result = ok(call('getSource', { source }));
      assert.deepEqual(result.source, source);
      assert.equal(result.coverage.completeness, 'excerpt-only');
      assert.equal(result.coverage.conversationCoverage, 'unknown');
      return result.parts.map(part => part.text).join('');
    });
    assert.deepEqual(coldExcerpts.sort(), [...memoryExcerpts].sort());
    const featureOff = openMemoryCore({ path: databasePath, model });
    try {
      assert.equal(featureOff.getCard, undefined);
      const corrected = ok(featureOff.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'Changed installed Memory interpretation.', kind: 'context',
        receipt: memoryReceipt('corrected', 'Changed synthetic receipt.') })).memory;
      assert.equal(ok(call('getCard', { cardId: memoryConfirmed.id })).card, null);
      const unsupported = retainedCard(memoryConfirmed.id);
      assert.equal(unsupported.revision, memoryConfirmed.revision + 1);
      assert.equal(unsupported.body, memoryBody);
      assert.equal(unsupported.support.applicability, 'unknown');
      assert.deepEqual(unsupported.bindings.map(binding => binding.source), memorySources);
      assert.equal(ok(call('getCard', { cardId: memoryDependentDraft.id })).card, null);
      for (const source of memorySources) refused(call('getSource', { source }), 'source_unavailable');
      const invalidations = ok(call('listCardEffects', { limit: 20 })).effects.filter(effect =>
        effect.actionId === `memory-revision-${memory.id}-${corrected.revision}`);
      assert.deepEqual(invalidations.map(effect => effect.entity.id).sort(), [memoryConfirmed.id, memoryDependentDraft.id].sort());
      assert.equal(ok(featureOff.forget({ namespace, memoryId: corrected.id, expectedRevision: corrected.revision })).forgotten, true);
      assert.equal(ok(call('getCard', { cardId: memoryConfirmed.id })).card, null);
      const forgottenSupport = retainedCard(memoryConfirmed.id);
      assert.equal(forgottenSupport.revision, unsupported.revision + 1);
      assert.equal(forgottenSupport.body, memoryBody);
    } finally { featureOff.close(); }
    assert.deepEqual(ok(call('createCardDraft', memoryInput)), memoryDraft);
    evidence = { confirmedRetainedAfterSourceDelete: true, dependentDraftRemoved: true, deletedCard,
      receiptSourcesReadAfterRestart: true, featureOffCorrectionInvalidated: true, featureOffForgetInvalidated: true };
  } else {
    assert.equal(phase, 'restart-invalidated');
    const { confirmed, memoryInput, memoryDraft, memoryConfirmed, memoryDependentDraft, memorySources } =
      JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(ok(call('getCard', { cardId: confirmed.id })).card, null);
    assert.equal(ok(call('getCard', { cardId: memoryConfirmed.id })).card, null);
    const retained = retainedCard(memoryConfirmed.id);
    assert.equal(retained.state, 'confirmed');
    assert.equal(retained.revision, memoryConfirmed.revision + 2);
    assert.equal(retained.body, memoryBody);
    assert.equal(retained.bodyRevision, memoryConfirmed.bodyRevision);
    assert.equal(retained.support.applicability, 'unknown');
    assert.deepEqual(retained.bindings.map(binding => binding.source), memorySources);
    assert.equal(ok(call('getCard', { cardId: memoryDependentDraft.id })).card, null);
    for (const source of memorySources) refused(call('getSource', { source }), 'source_unavailable');
    const beforeReplay = ok(call('listCardEffects', { limit: 20 })).effects;
    for (const prose of [memoryBody, ...memoryExcerpts]) assert.equal(JSON.stringify(beforeReplay).includes(prose), false);
    assert.deepEqual(ok(call('createCardDraft', memoryInput)), memoryDraft);
    assert.deepEqual(ok(call('listCardEffects', { limit: 20 })).effects, beforeReplay);
    evidence = { unsupportedMemoryCardPersisted: true, cancelledMemoryDraftAbsent: true, contentFreeReplayStable: true };
  }
} finally { core.close(); }
assert.equal(modelCalls, 0);
assert.equal(httpCalls, 0);
console.log(JSON.stringify({ phase, pid: process.pid, importedCore, modelCalls, httpCalls, ...evidence }));

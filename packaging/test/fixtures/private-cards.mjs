// Test host only: import the installed archive's public core, never checkout code.
import assert from 'node:assert/strict';
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
  assert.deepEqual(capabilities.sourceTypes, ['submitted-note']);
  assert.deepEqual(capabilities.drafting, ['authored']);
  for (const field of ['raw', 'currentEvidence', 'modelAssisted', 'publication']) assert.equal(capabilities[field], false);
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
    assert.equal(ok(call('getPrivateCardUsage', {})).submittedNoteBytes, Buffer.byteLength(text));
    writeFileSync(statePath, JSON.stringify({ source, confirmed, dependentDraft }), { flag: 'wx', mode: 0o600 });
    evidence = { state: confirmed.state };
  } else {
    assert.equal(phase, 'restart-delete');
    const { source, confirmed, dependentDraft } = JSON.parse(readFileSync(statePath, 'utf8'));
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
    const retained = ok(call('getCard', { cardId: confirmed.id })).card;
    assert.equal(retained.state, 'confirmed');
    assert.equal(retained.body, body);
    assert.equal(retained.support.status, 'unavailable');
    assert.ok(retained.support.reasons.includes('source_deleted'));
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
    evidence = { confirmedRetainedAfterSourceDelete: true, dependentDraftRemoved: true, deletedCard };
  }
} finally { core.close(); }
assert.equal(modelCalls, 0);
assert.equal(httpCalls, 0);
console.log(JSON.stringify({ phase, pid: process.pid, importedCore, modelCalls, httpCalls, ...evidence }));

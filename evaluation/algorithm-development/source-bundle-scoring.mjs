import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { prepareSourceBundleCase, validateSourceBundleCases } from './source-bundle-profile.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../longmemeval/public-comparison.mjs';
import { BUNDLE_RANK_INSTRUCTION } from '../architecture/source-bundle-rank.mjs';
import { schemasFor } from '../../adapters/openai/schemas.mjs';
import { createSourceBundleJudgePackets, parseSourceBundleFirstJudgments } from './source-bundle-judging.mjs';

const RUNTIME = '6abed0ccdfe3815d42b25db04adb159483ded156';
const SOURCES = '74c3664e31d1d35a74a614345c273faa2c7f1845811030fd0868141c74a44e7c';
const RUBRIC = 'd3e34c207c927831c31e446e59f900d65c284cb29fc11ca242bc1302b896c8f3';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const ARMS = ['ordinary', 'source-bundle'];
const LIMITS = { cases: 24, answers: 48, probes: 24, physicalIntents: 192,
  reservedMicroUsd: 960000, reservationMicroUsd: 5000, inputTokens: 6000,
  rankOutputTokens: 1024, answerOutputTokens: 512, coreMs: 30000, physicalMs: 200000,
  caseMs: 1200000, runMs: 28800000 };
const FATAL = new Set(['invalid_manifest', 'invalid_preparation', 'cancelled', 'deadline_exceeded',
  'request_denied', 'wire_mismatch', 'rank_mismatch', 'store_drift', 'provenance_mismatch', 'ledger_failed',
  'budget_blocked', 'record_persistence_failed', 'credential_echo', 'authentication_failed',
  'redirect_rejected', 'invalid_usage', 'usage_overrun', 'model_mismatch', 'context_budget_exceeded']);
// Scalar aliases from the pinned coordinator's closed sourceBundleFailureCode
// projection. Healthy provider failures/timeouts are not globally fatal.
const ORDINARY_FAILURE_ALIASES = {
  algorithm_accounting_failure: 'ledger_failed', algorithm_checkpoint_mismatch: 'ledger_failed',
  algorithm_unaffordable: 'budget_blocked', algorithm_budget_exceeded: 'budget_blocked',
  algorithm_usage_anomaly: 'invalid_usage', algorithm_usage_overrun: 'usage_overrun',
  algorithm_auth_transport_failure: 'authentication_failed', algorithm_credential_echo: 'credential_echo',
  algorithm_persistence_failure: 'record_persistence_failed', algorithm_request_denied: 'request_denied',
  algorithm_method_denied: 'request_denied', algorithm_lifecycle: 'request_denied',
  algorithm_case_call_cap: 'request_denied', algorithm_phase_call_cap: 'request_denied',
  invalid_ledger: 'ledger_failed', ledger_closed: 'ledger_failed', ledger_missing: 'ledger_failed',
  configuration_mismatch: 'ledger_failed', unsafe_database_file: 'ledger_failed',
  invalid_input: 'rank_mismatch', request_mutated: 'rank_mismatch',
  invalid_bundle_sidecar: 'provenance_mismatch', invalid_bundle_evidence: 'provenance_mismatch',
  invalid_recall_provenance: 'provenance_mismatch', provenance_limit_exceeded: 'provenance_mismatch',
  bundle_answer_incomplete: 'provenance_mismatch', bundle_invocation_conflict: 'request_denied',
};
// Exact closed error taxonomy of the pinned QT transport, not new causes.
const PLANNER_FAILURES = new Set(['invalid_configuration', 'prerequisite_unavailable', 'invalid_request',
  'request_mutated', 'context_budget_exceeded', 'slot_consumed', 'transport_busy', 'transport_closed',
  'cancelled', 'deadline_exceeded', 'ledger_failed', 'budget_blocked', 'record_persistence_failed',
  'credential_echo', 'provider_failed', 'authentication_failed', 'redirect_rejected',
  'invalid_response', 'response_too_large', 'invalid_usage', 'usage_overrun', 'model_mismatch', 'invalid_model_output']);
const LIMITATIONS = [
  'Artifact consistency is not proof against fabrication of a complete transcript.',
  'Original history-prefix preservation and absolute per-phase deadlines rely on the pinned runtime and external execution provenance, not independently reconstructed old rows or dispatch times.',
  'Local token measurements are bound recorded measurements from the pinned runtime, not independently retokenized here.',
  'Firstness and independent judge execution require external execution provenance.',
  'Peak RSS and agent service costs are unmeasured; knownMicroUsd is partial known model pricing, not total spend.',
  'This authored complete-map/scripted-capture mechanism diagnostic is not semantic efficacy, natural long-history MOC, official parity, measured lightweight fit or readiness. D12 and Stage2/3 remain uncleared.',
];
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const error = code => { throw new TypeError(code); };
const check = (condition, code = 'retained_integrity_mismatch') => { if (!condition) error(code); };
// Inputs are already closed defensive JSON snapshots. Prototype identity is not
// JSON identity; literal request/body strings are compared independently below.
const same = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value)
  && !Object.is(value, -0) && value >= 0 && value <= maximum;
const fields = (value, names, code = 'invalid_scoring_shape') => {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), code);
  return value;
};
const freeze = value => { if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const ref = candidate => ({ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision });
const refKey = value => JSON.stringify([value.namespaceIndex, value.memoryId, value.revision]);

// No preliminary nested-field reads: each container is checked before descriptors
// are inspected. Only result.intents[i].final.responseBody receives body capacity.
function snapshot(root, bodies = false) {
  const state = { nodes: 0, metadata: 0, bodyBytes: 0, active: new WeakSet() };
  const charge = (value, body) => {
    const bytes = Buffer.byteLength(value);
    if (body) { check(bytes <= 262144 * 3, 'response_body_limit'); state.bodyBytes += bytes;
      check(state.bodyBytes <= 192 * 262144 * 3, 'response_body_limit'); }
    else { state.metadata += bytes; check(state.metadata <= 32 * 1024 * 1024, 'metadata_limit'); }
  };
  function visit(value, path) {
    check(++state.nodes <= 500000 && path.length <= 28, 'traversal_limit');
    if (typeof value === 'string') { check(value.isWellFormed(), 'invalid_scoring_json');
      charge(value, bodies && path.length === 4 && path[0] === 'intents'
        && /^(0|[1-9][0-9]*)$/u.test(path[1]) && path[2] === 'final' && path[3] === 'responseBody'); return value; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { check(Number.isFinite(value) && !Object.is(value, -0), 'invalid_scoring_json'); return value; }
    check(value && typeof value === 'object' && !types.isProxy(value) && !state.active.has(value), 'invalid_scoring_json');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    check(array ? proto === Array.prototype : proto === Object.prototype || proto === null, 'invalid_scoring_json');
    check(!Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
      && !Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'), 'invalid_scoring_json');
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    check(2 * keys.length - (array ? 1 : 0) <= 500000 - state.nodes, 'traversal_limit');
    const length = array ? descriptors.length?.value : 0;
    if (array) check(integer(length, 500000) && keys.length === length + 1, 'invalid_scoring_json');
    state.active.add(value); const result = array ? [] : Object.create(null);
    for (const key of keys) {
      check(typeof key === 'string' && !['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key), 'invalid_scoring_json');
      check(++state.nodes <= 500000, 'traversal_limit'); charge(key, false);
      if (array && key === 'length') continue;
      if (array) check(/^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < length, 'invalid_scoring_json');
      const d = descriptors[key]; check(d.enumerable && Object.hasOwn(d, 'value'), 'invalid_scoring_json');
      result[key] = visit(d.value, [...path, key]);
    }
    state.active.delete(value); return result;
  }
  return visit(root, []);
}
function options(options, scoring) {
  check(options && typeof options === 'object' && !types.isProxy(options), 'invalid_scoring_json');
  const proto = Object.getPrototypeOf(options); check(proto === Object.prototype || proto === null, 'invalid_scoring_json');
  const names = ['frozenSources', 'preparation', 'result', 'rubric', 'seedHex', ...(scoring ? ['packetBindings', 'rawFirstResponses'] : [])];
  const descriptors = Object.getOwnPropertyDescriptors(options);
  check(Reflect.ownKeys(descriptors).length === names.length, 'invalid_scoring_shape');
  const input = {};
  for (const name of names) { const d = descriptors[name];
    check(d && d.enumerable && Object.hasOwn(d, 'value'), 'invalid_scoring_json');
    // First raw strings are assessed separately by the frozen bounded parser.
    input[name] = name === 'rawFirstResponses' ? d.value : snapshot(d.value, name === 'result'); }
  check(typeof input.seedHex === 'string' && /^[a-fA-F0-9]{64}$/u.test(input.seedHex), 'invalid_seed');
  input.seedHex = input.seedHex.toLowerCase(); return input;
}

function rankCandidates(c, request) {
  if (request === null) return null;
  same(request, c.rankRequest, 'rank_binding_mismatch'); return request.input.candidates;
}
function sourceWires(request, method, bundle = false) {
  const payload = { model: MODEL, instructions: request.system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request.input) }] }],
    text: { format: { type: 'json_schema', name: bundle ? 'cairn_source_bundle_plan_rank_v1' : `cairn_${method}`,
      strict: true, schema: bundle ? request.outputSchema : schemasFor(method, request.input) } }, truncation: 'disabled' };
  return { countBody: JSON.stringify(payload), generationBody: JSON.stringify({ ...payload, max_output_tokens: 1024, store: false, stream: false }) };
}
function attestPhase(intents, wire) {
  for (const [index, intent] of intents.entries()) check(intent.final?.requestBody === (index ? wire.generationBody : wire.countBody), 'request_wire_mismatch');
}
function compile(c, proposal) {
  fields(proposal, ['bundles'], 'bundle_declaration_mismatch');
  check(Array.isArray(proposal.bundles) && proposal.bundles.length <= 6, 'bundle_declaration_mismatch');
  const catalog = c.bundlePrepared.request.input.catalog, union = new Map(), used = new Set();
  for (const bundle of proposal.bundles) {
    fields(bundle, ['sourceIndices', 'terminalSourceIndex'], 'bundle_declaration_mismatch');
    check(Array.isArray(bundle.sourceIndices) && bundle.sourceIndices.length > 0 && bundle.sourceIndices.length <= 6
      && new Set(bundle.sourceIndices).size === bundle.sourceIndices.length
      && bundle.sourceIndices.includes(bundle.terminalSourceIndex), 'bundle_declaration_mismatch');
    const cards = new Set();
    for (const index of bundle.sourceIndices) {
      check(integer(index, catalog.length - 1), 'bundle_declaration_mismatch'); const entry = catalog[index];
      const r = { namespaceIndex: entry.namespaceIndex, memoryId: entry.memoryId, revision: entry.revision };
      cards.add(refKey(r)); if (!union.has(refKey(r))) union.set(refKey(r), r);
    }
    check(cards.size <= 3 && [...cards].every(id => !used.has(id)), 'bundle_declaration_mismatch');
    cards.forEach(id => used.add(id));
  }
  check(union.size <= 6, 'bundle_declaration_mismatch'); return [...union.values()];
}
function responseOutput(intent, answer = false) {
  const raw = intent?.final;
  check(raw && typeof raw.responseBody === 'string', 'response_binding_mismatch');
  let body; try { body = JSON.parse(raw.responseBody); } catch { error('response_binding_mismatch'); }
  if (answer) {
    check(body.object === 'chat.completion' && body.model === MODEL && Array.isArray(body.choices)
      && body.choices.length === 1 && body.choices[0].finish_reason === 'stop'
      && body.choices[0].message?.role === 'assistant' && typeof body.choices[0].message.content === 'string', 'response_binding_mismatch');
    return body.choices[0].message.content;
  }
  const ordinary = intent.ownerKind === 'ordinary';
  check(body.model === MODEL && body.status === 'completed'
    && (ordinary ? body.object === 'response' && body.error === null && body.incomplete_details === null
      : body.error == null && body.incomplete_details == null)
    && Array.isArray(body.output) && body.output.length > 0 && (ordinary || body.output.length === 1), 'response_binding_mismatch');
  let text = '';
  for (const message of body.output) {
    check(message?.type === 'message' && message.role === 'assistant' && message.status === 'completed'
      && Array.isArray(message.content) && message.content.length > 0 && (ordinary || message.content.length === 1), 'response_binding_mismatch');
    for (const part of message.content) {
      check(part?.type === 'output_text' && typeof part.text === 'string' && (ordinary || part.text.isWellFormed()), 'response_binding_mismatch');
      text += part.text; check(text.length <= 40000, 'response_binding_mismatch');
    }
  }
  check(text.length > 0, 'response_binding_mismatch');
  // The accepted runtime enforces the tokenizer ceiling; this pure replay
  // reconstructs its literal concatenation without loading the adapter.
  let output; try { output = JSON.parse(text); } catch { error('response_binding_mismatch'); }
  check(output !== null && typeof output === 'object' && !Array.isArray(output), 'response_binding_mismatch'); return output;
}
function replayEvidence(c, artifacts) {
  const recall = artifacts.recall;
  check(recall?.ok === true, 'read_replay_mismatch');
  const reads = artifacts.authoritativeReads; check(Array.isArray(reads) && reads.length <= 6, 'read_replay_mismatch');
  let index = 0;
  const verified = verifiedRoleEvidence(recall.value, request => {
    const row = reads[index++]; check(row, 'read_replay_mismatch'); fields(row, ['input', 'returned']);
    same(row.input, request, 'read_replay_mismatch');
    const mapped = c.mapping.find(entry => entry.memoryId === request.memoryId);
    check(mapped && row.returned?.value?.receipts.length === 1, 'read_replay_mismatch');
    same(row.returned.value.receipts[0], mapped.receipt, 'read_replay_mismatch');
    return row.returned;
  }, c.plan, c.namespace);
  check(index === reads.length, 'read_replay_mismatch'); return verified;
}
function normalize(c, arm, artifacts) {
  const verified = replayEvidence(c, artifacts), evidence = artifacts.evidence;
  if (arm === 'ordinary') {
    fields(evidence, ['units', 'provenance'], 'evidence_mismatch'); same(evidence, verified, 'evidence_mismatch');
  } else {
    const sidecar = fields(artifacts.sidecar, ['version', 'request', 'originalInput', 'requestSha256', 'proposal', 'refs'], 'bundle_declaration_mismatch');
    check(sidecar.version === 'query-local-source-bundles-v1', 'bundle_declaration_mismatch');
    same(sidecar.request, c.bundlePrepared.request, 'bundle_declaration_mismatch');
    same(sidecar.originalInput, c.rankRequest.input, 'bundle_declaration_mismatch');
    check(sidecar.requestSha256 === c.hashes.bundlePreparedSha256, 'bundle_declaration_mismatch');
    same(sidecar.proposal, artifacts.plannerOutput, 'bundle_declaration_mismatch');
    const refs = compile(c, sidecar.proposal); same(sidecar.refs, refs, 'bundle_declaration_mismatch');
    same(artifacts.rankOutput, { refs }, 'bundle_declaration_mismatch');
    fields(evidence, ['units', 'provenance', 'verifiedUnits', 'refs', 'query', 'question', 'requestSha256', 'proposal', 'semanticSufficiency'], 'evidence_mismatch');
    same(evidence.provenance, verified.provenance, 'evidence_mismatch'); same(evidence.verifiedUnits, verified.units, 'evidence_mismatch');
    same(evidence.refs, refs, 'evidence_mismatch'); same(evidence.question, c.question, 'evidence_mismatch');
    check(evidence.query === c.plan.mem0Input.query && evidence.requestSha256 === sidecar.requestSha256
      && evidence.semanticSufficiency === 'unassessed', 'evidence_mismatch');
    same(evidence.proposal, sidecar.proposal, 'evidence_mismatch');
    const catalog = sidecar.request.input.catalog, declaration = source => Object.fromEntries(Object.entries(source).filter(([name]) => name !== 'excerpt'));
    const cards = new Map(artifacts.recall.value.memories.map(item => [item.memory.id, {
      memoryId: item.memory.id, revision: item.memory.revision,
      sources: item.receipts.map(source => ({ receiptId: source.id, recordedRole: source.role, text: source.excerpt })) }]));
    const units = sidecar.proposal.bundles.map(bundle => ({ text: JSON.stringify({ format: 'query-local-source-bundle-evidence-v1',
      organization: 'unverified-not-identity-truth-or-execution-authority',
      declaredSources: bundle.sourceIndices.map(index => declaration(catalog[index])),
      terminalSource: declaration(catalog[bundle.terminalSourceIndex]),
      cards: [...new Set(bundle.sourceIndices.map(index => catalog[index].memoryId))].map(id => cards.get(id)) }) }));
    same(evidence.units, units, 'evidence_mismatch');
  }
  const passages = evidence.units.flatMap(unit => {
    fields(unit, ['text'], 'evidence_mismatch'); const wrapper = JSON.parse(unit.text);
    if (arm === 'ordinary') { fields(wrapper, ['format', 'sources'], 'evidence_mismatch');
      check(wrapper.format === 'source-role-evidence-v1', 'evidence_mismatch'); return wrapper.sources; }
    fields(wrapper, ['format', 'organization', 'declaredSources', 'terminalSource', 'cards'], 'evidence_mismatch');
    return wrapper.cards.flatMap(card => card.sources.map(({ recordedRole, text }) => ({ recordedRole, text })));
  });
  for (const passage of passages) fields(passage, ['recordedRole', 'text'], 'evidence_mismatch');
  return passages;
}

function observation(rubric, entries) {
  if (entries === null) return { status: 'not-reached', anchors: rubric.anchors.map(a => ({ id: a.id, present: null })), sets: rubric.requiredEvidenceSets.map(s => ({ name: s.name, complete: null })), complete: null };
  const seen = new Set(entries.map(entry => entry.originalSessionId));
  const anchors = rubric.anchors.map(anchor => ({ id: anchor.id, present: seen.has(anchor.sessionId) }));
  const byId = new Map(anchors.map(a => [a.id, a.present]));
  const sets = rubric.requiredEvidenceSets.map(set => ({ name: set.name, complete: set.anchorIds.every(id => byId.get(id)) }));
  return { status: 'observed', anchors, sets, complete: sets.some(set => set.complete) };
}
function mapPassages(c, passages) {
  if (passages === null) return null;
  const used = new Set(); return passages.map(passage => {
    const entries = c.mapping.filter(entry => entry.window === passage.text && entry.role === passage.recordedRole);
    check(entries.length === 1 && !used.has(entries[0].receipt.id), 'passage_origin_mismatch'); used.add(entries[0].receipt.id); return entries[0];
  });
}
function ledgerHeader(header) {
  fields(header, ['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256'], 'resource_accounting_mismatch');
  check(header.schemaVersion === 2 && /^[a-f0-9-]{36}$/u.test(header.runId)
    && ['limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount'].every(k => integer(header[k]))
    && ['open', 'overrun'].includes(header.state) && /^[a-f0-9]{64}$/u.test(header.historySha256), 'resource_accounting_mismatch');
}
function validateResources(preparation, result) {
  const intents = result.intents, transitions = result.transitions;
  check(Array.isArray(intents) && intents.length <= 192 && Array.isArray(transitions) && transitions.length <= 120, 'resource_accounting_mismatch');
  const byId = new Map(), byPhase = new Map(); let known = 0, unknown = 0, missing = 0, latency = 0, overflow = false;
  for (const [index, intent] of intents.entries()) {
    fields(intent, ['ordinal', 'attemptId', 'caseId', 'slotId', 'phaseId', 'method', 'ownerKind', 'dispatched', 'final'], 'intent_mismatch');
    check(intent.ordinal === index + 1 && /^[a-f0-9-]{36}$/u.test(intent.attemptId) && !byId.has(intent.attemptId)
      && typeof intent.dispatched === 'boolean', 'intent_mismatch');
    const caseIndex = preparation.cases.findIndex(c => c.id === intent.caseId);
    check(caseIndex >= 0, 'intent_mismatch'); const schedule = result.manifest.schedule[caseIndex];
    const arm = Object.keys(schedule.slots).find(name => schedule.slots[name] === intent.slotId);
    check(arm && intent.phaseId === `${intent.caseId}_${arm.replaceAll('-', '_')}_${intent.method}`
      && (arm === 'probe' ? intent.method === 'select' : ['rank', 'plan', 'answer'].includes(intent.method))
      && intent.ownerKind === (intent.method === 'plan' ? 'planner' : 'ordinary'), 'intent_mismatch');
    byId.set(intent.attemptId, intent); const phase = byPhase.get(intent.phaseId) ?? []; phase.push(intent); byPhase.set(intent.phaseId, phase);
    const raw = intent.final;
    if (raw === null) { missing++; unknown++; continue; }
    check(raw.attemptId === intent.attemptId && raw.reservedMicroUsd === 5000
      && typeof raw.requestBody === 'string' && integer(raw.actualMicroUsd ?? 0, 5000)
      && ['succeeded', 'failed', 'unknown'].includes(raw.outcome)
      && typeof raw.latencyMs === 'number' && raw.latencyMs >= 0, 'resource_accounting_mismatch');
    latency += raw.latencyMs;
    if (raw.actualMicroUsd === null) unknown++; else known += raw.actualMicroUsd;
    const counting = intent.ownerKind === 'planner' ? raw.kind === 'count' : raw.endpoint === 'responses/input_tokens';
    const answer = intent.method === 'answer';
    if (counting) check(raw.actualMicroUsd === null, 'resource_accounting_mismatch');
    let body = null;
    if (raw.responseBody !== null) { check(typeof raw.responseBody === 'string', 'resource_accounting_mismatch');
      try { body = JSON.parse(raw.responseBody); } catch { /* A retained failed body is not a successful measurement. */ } }
    if (intent.ownerKind === 'ordinary') {
      fields(raw, ['id', 'ordinal', 'arm', 'method', 'endpoint', 'attemptId', 'requestBody', 'requestBytes', 'localInputTokens',
        'responseBody', 'responseBytes', 'httpStatus', 'reservedMicroUsd', 'actualMicroUsd', 'usage', 'outcome', 'failure', 'latencyMs',
        ...(Object.hasOwn(raw, 'providerInputTokens') ? ['providerInputTokens'] : [])], 'intent_mismatch');
      check(raw.id === intent.caseId && raw.ordinal === 1 && raw.arm === (arm === 'source-bundle' ? 'full' : 'baseline')
        && raw.method === intent.method && ['responses/input_tokens', 'responses', 'chat/completions'].includes(raw.endpoint)
        && (answer ? raw.endpoint === 'chat/completions' : raw.endpoint !== 'chat/completions')
        && integer(raw.localInputTokens, 6000) && raw.requestBytes === Buffer.byteLength(raw.requestBody), 'resource_accounting_mismatch');
      check(raw.responseBytes === null || raw.responseBytes === Buffer.byteLength(raw.responseBody), 'resource_accounting_mismatch');
      check(raw.outcome === 'succeeded' ? raw.failure === null : typeof raw.failure === 'string' && raw.failure.length > 0,
        'resource_accounting_mismatch');
      const cause = Object.hasOwn(ORDINARY_FAILURE_ALIASES, raw.failure) ? ORDINARY_FAILURE_ALIASES[raw.failure] : raw.failure;
      if (FATAL.has(cause)) check(result.status === 'stopped', 'resource_accounting_mismatch');
      if (counting && raw.providerInputTokens !== undefined) { check(integer(raw.providerInputTokens), 'resource_accounting_mismatch');
        check(body?.input_tokens === raw.providerInputTokens, 'resource_accounting_mismatch');
        if (raw.providerInputTokens > 7024) { check(raw.failure === 'context_budget_exceeded' && result.status === 'stopped'
          && result.stopReason === 'context_budget_exceeded', 'resource_accounting_mismatch'); overflow = true; } }
      if (raw.usage !== null) {
        fields(raw.usage, ['input_tokens', 'output_tokens', 'total_tokens'], 'resource_accounting_mismatch');
        check(integer(raw.usage.input_tokens, 7024) && integer(raw.usage.output_tokens, answer ? 512 : 1024)
          && raw.usage.total_tokens === raw.usage.input_tokens + raw.usage.output_tokens, 'resource_accounting_mismatch');
        same(raw.usage, { input_tokens: body?.usage?.[answer ? 'prompt_tokens' : 'input_tokens'],
          output_tokens: body?.usage?.[answer ? 'completion_tokens' : 'output_tokens'], total_tokens: body?.usage?.total_tokens }, 'resource_accounting_mismatch');
        check(raw.actualMicroUsd === Math.ceil(raw.usage.input_tokens * 0.4 + raw.usage.output_tokens * 1.6), 'resource_accounting_mismatch');
      }
      if (raw.outcome === 'succeeded') check(raw.failure === null && body && raw.httpStatus >= 200 && raw.httpStatus < 300
        && (counting ? integer(raw.providerInputTokens, 7024) : raw.usage !== null && body.model === MODEL), 'resource_accounting_mismatch');
    } else {
      fields(raw, ['version', 'slotId', 'preparedRequestSha256', 'attemptId', 'endpoint', 'kind', 'requestBody', 'requestSha256',
        'reservedMicroUsd', 'phase', 'dispatched', 'inputTokens', 'outputTokens', 'actualMicroUsd', 'outcome', 'responseBody',
        'responseSha256', 'requestId', 'latencyMs', 'failureCode', 'settlementPersisted'], 'intent_mismatch');
      check(raw.version === 'source-bundle-plan-rank-v1' && raw.slotId === intent.phaseId
        && ['count', 'generation'].includes(raw.kind) && raw.endpoint === `https://api.openai.com/v1/responses${counting ? '/input_tokens' : ''}`
        && raw.phase === 'post' && raw.dispatched === intent.dispatched
        && raw.preparedRequestSha256 === preparation.cases[caseIndex].hashes.bundlePreparedSha256
        && raw.requestSha256 === digest(raw.requestBody)
        && (raw.responseBody === null ? raw.responseSha256 === null : raw.responseSha256 === digest(raw.responseBody)), 'resource_accounting_mismatch');
      check(raw.outcome === 'succeeded' ? raw.failureCode === null
        : typeof raw.failureCode === 'string' && PLANNER_FAILURES.has(raw.failureCode), 'resource_accounting_mismatch');
      check(typeof raw.settlementPersisted === 'boolean'
        && (raw.settlementPersisted || raw.failureCode === 'ledger_failed' && result.status === 'stopped'),
      'resource_accounting_mismatch');
      let cause = raw.failureCode === 'request_mutated' ? 'rank_mismatch' : raw.failureCode;
      if (result.status === 'accounted' && ['cancelled', 'deadline_exceeded'].includes(cause)) {
        // Preserve only the existing coordinator's settled per-call timeout.
        // Timing/caller truth still requires external execution provenance.
        const slot = result.cases[caseIndex].answers['source-bundle'], a = slot.artifacts;
        const witness = fields(a.plannerFailure, ['rawCode', 'normalizedCode', 'health', 'callerAborted',
          'absoluteDeadlineLive', 'normalization'], 'resource_accounting_mismatch');
        fields(witness.health, ['state', 'fatalCode'], 'resource_accounting_mismatch');
        fields(a.rankFailure, ['code'], 'resource_accounting_mismatch');
        check(raw.settlementPersisted === true && witness.rawCode === raw.failureCode && witness.normalizedCode === 'model_timeout'
          && witness.normalization === 'healthy-settled-per-call-timeout' && witness.health.state === 'consumed'
          && witness.health.fatalCode === null && witness.callerAborted === false && witness.absoluteDeadlineLive === true
          && a.rankFailure.code === 'model_timeout' && slot.failure === 'model_timeout', 'resource_accounting_mismatch');
        cause = 'model_timeout';
      }
      if (FATAL.has(cause)) check(result.status === 'stopped', 'resource_accounting_mismatch');
      if (counting) {
        check(raw.outputTokens === null, 'resource_accounting_mismatch');
        if (raw.inputTokens !== null) check(integer(raw.inputTokens) && body?.input_tokens === raw.inputTokens, 'resource_accounting_mismatch');
      } else if (raw.inputTokens !== null || raw.outputTokens !== null) {
        check(integer(raw.inputTokens) && integer(raw.outputTokens) && body?.usage?.input_tokens === raw.inputTokens
          && body?.usage?.output_tokens === raw.outputTokens && body?.usage?.total_tokens === raw.inputTokens + raw.outputTokens,
        'resource_accounting_mismatch');
      }
      if (raw.inputTokens !== null && raw.inputTokens > 7024 || raw.outputTokens !== null && raw.outputTokens > 1024) {
        check(raw.outcome !== 'succeeded' && FATAL.has(raw.failureCode) && result.status === 'stopped', 'resource_accounting_mismatch');
        overflow = true;
      }
      if (raw.outcome === 'succeeded') check(raw.settlementPersisted === true && raw.failureCode === null
        && integer(raw.inputTokens, 7024) && (counting ? body?.input_tokens === raw.inputTokens
          : integer(raw.outputTokens, 1024) && body?.model === MODEL && body?.usage?.input_tokens === raw.inputTokens
            && body?.usage?.output_tokens === raw.outputTokens && body?.usage?.total_tokens === raw.inputTokens + raw.outputTokens), 'resource_accounting_mismatch');
      if (raw.actualMicroUsd !== null) check(integer(raw.inputTokens) && integer(raw.outputTokens)
        && raw.actualMicroUsd === Math.ceil((raw.inputTokens * 4 + raw.outputTokens * 16) / 10), 'resource_accounting_mismatch');
    }
  }
  let header = result.history.base?.header ?? null, start = header?.requestCount ?? 0;
  if (header) { ledgerHeader(header); check(result.history.base.complete === true && result.history.base.rows === start
    && /^[a-f0-9]{64}$/u.test(result.history.base.sha256) && integer(result.history.base.bytes, 128 * 1024 * 1024), 'resource_accounting_mismatch'); }
  const appended = [];
  for (const transition of transitions) {
    check(transition.closed === true && byPhase.has(transition.phaseId), 'resource_accounting_mismatch');
    const first = byPhase.get(transition.phaseId)[0], caseIndex = preparation.cases.findIndex(c => c.id === first.caseId);
    check(transition.caseId === first.caseId && transition.caseOrdinal === caseIndex + 1 && transition.slotId === first.slotId
      && transition.method === first.method && transition.kind === first.ownerKind
      && transition.runDeadline === result.deadlines.runDeadline
      && transition.caseDeadline === result.cases[caseIndex].caseDeadline, 'deadline_binding_mismatch');
    if (!transition.healthy) { check(result.status === 'stopped', 'resource_accounting_mismatch'); continue; }
    const state = transition.state; check(state.representation === 'base-plus-ordered-delta-v1' && state.prefixUnchanged === true && state.diagnostic === false, 'resource_accounting_mismatch');
    same(state.base, result.history.base, 'resource_accounting_mismatch'); ledgerHeader(state.header);
    check(state.deltaStart === start + appended.length, 'resource_accounting_mismatch');
    const phase = byPhase.get(transition.phaseId); check(state.appendedAttempts.length === phase.length, 'resource_accounting_mismatch');
    for (const [index, attempt] of state.appendedAttempts.entries()) {
      fields(attempt, ['attemptId', 'channel', 'reservedMicroUsd', 'outcome', 'actualMicroUsd'], 'resource_accounting_mismatch');
      const intent = phase[index]; check(attempt.attemptId === intent.attemptId && attempt.reservedMicroUsd === 5000
        && attempt.channel === (intent.method === 'answer' ? 'host-completion' : index === 0 ? 'cairn-count' : 'cairn-generation')
        && (intent.ownerKind !== 'planner' || intent.final?.settlementPersisted === true)
        && attempt.outcome === intent.final?.outcome && attempt.actualMicroUsd === intent.final?.actualMicroUsd, 'resource_accounting_mismatch'); appended.push(attempt);
    }
    check(state.header.requestCount === start + appended.length && state.header.reservedMicroUsd === result.history.base.header.reservedMicroUsd + appended.length * 5000
      && ['runId', 'limitMicroUsd', 'requestCap'].every(key => state.header[key] === header[key]), 'resource_accounting_mismatch'); header = state.header;
  }
  if (result.status === 'accounted') check(missing === 0 && appended.length === intents.length && transitions.every(t => t.healthy)
    && result.finalState && isDeepStrictEqual(result.finalState, transitions.at(-1)?.state), 'resource_accounting_mismatch');
  if (!intents.length) check(result.history.base === null && result.finalState === null && !transitions.length, 'resource_accounting_mismatch');
  const resources = result.resources;
  same(Object.keys(resources).sort(), ['physicalIntents', 'reservedMicroUsd', 'peakRss', 'preparedStoreBytes', 'transportLatencyMs', 'knownMicroUsd', 'knownMicroUsdCoverage', 'unknownUsageIntents', 'unknownUsageReservedMicroUsd', 'missingFinalRecords', 'elapsedMs'].sort(), 'resource_accounting_mismatch');
  check(resources.physicalIntents === intents.length && resources.reservedMicroUsd === intents.length * 5000
    && resources.knownMicroUsd === known && resources.knownMicroUsdCoverage === 'partial-known-only'
    && resources.unknownUsageIntents === unknown && resources.unknownUsageReservedMicroUsd === unknown * 5000
    && resources.missingFinalRecords === missing && resources.transportLatencyMs === latency
    && resources.preparedStoreBytes === preparation.cases.reduce((sum, c) => sum + c.state.fileBytes, 0)
    && typeof resources.elapsedMs === 'number' && resources.elapsedMs >= 0
    && result.deadlines.runDeadline === result.deadlines.began + LIMITS.runMs, 'resource_accounting_mismatch');
  return { ...resources, compliance: { status: missing || overflow || resources.elapsedMs > LIMITS.runMs ? 'not-satisfied' : 'satisfied',
    independentlyChecked: 'new intents, ordered deltas, headers, literal wires, recorded counts/usages, sums and run elapsed',
    acceptedRuntimeEnforcement: 'original history prefix, local token measurements, absolute phase/case deadlines',
    externalExecutionProvenanceRequired: true }, agentServiceCost: null,
    dispatchedIntents: intents.filter(intent => intent.dispatched).length,
    finalRecordIntents: intents.length - missing,
    deltaConfirmedSettledIntents: appended.length,
    settlementNotIndependentlyConfirmedIntents: intents.length - appended.length, byPhase };
}

async function retained(input) {
  const sources = validateSourceBundleCases(input.frozenSources);
  check(digest(sources) === SOURCES && digest(input.rubric) === RUBRIC, 'frozen_hash_mismatch');
  const rubric = input.rubric; fields(rubric, ['version', 'cases']);
  check(rubric.version === 'source-bundle-qa24-rubric-v1' && rubric.cases.length === 24, 'rubric_mismatch');
  check(rubric.cases.filter(c => c.answerability === 'answerable').length === 18
    && rubric.cases.flatMap(c => c.anchors).length === 67, 'rubric_mismatch');
  const p = fields(input.preparation, ['version', 'outputRoot', 'eligible', 'cases', 'manifest', 'manifestSha256']);
  check(p.version === 'source-bundle-comparison-preparation-v1' && p.eligible === true && p.cases.length === 24
    && p.manifestSha256 === digest(p.manifest) && p.manifest.sourceSha256 === SOURCES, 'preparation_mismatch');
  for (const [index, c] of p.cases.entries()) {
    fields(c, ['id', 'directory', 'storePath', 'source', 'plan', 'question', 'namespace', 'mapping', 'outcomes', 'extractionInputs',
      'classificationInputs', 'state', 'postPreflightStateSha256', 'publicMap', 'recallMap', 'recall', 'omissionCounters',
      'omissionCounterBasis', 'rankRequest', 'bundlePrepared', 'ordinaryWire', 'bundleWire', 'tokenCounts', 'hashes']);
    fields(c.hashes, ['sourceSha256', 'planSha256', 'stateSha256', 'mappingSha256', 'rankRequestSha256', 'bundlePreparedSha256',
      'ordinaryCountSha256', 'ordinaryGenerationSha256', 'bundleCountSha256', 'bundleGenerationSha256'], 'preflight_hash_mismatch');
    fields(p.manifest.cases[index], ['id', ...Object.keys(c.hashes)], 'preflight_hash_mismatch');
    fields(c.tokenCounts, ['ordinaryPrepared', 'bundlePrepared', 'ordinaryCount', 'ordinaryGeneration', 'bundleCount', 'bundleGeneration'], 'token_binding_mismatch');
    fields(c.omissionCounters, ['navigationItemsOmitted', 'candidatesOmitted', 'candidatesShortened', 'receiptListsCapped'], 'preflight_rank_mismatch');
    fields(c.rankRequest, ['system', 'input', 'maxOutputTokens'], 'preflight_rank_mismatch');
    fields(c.rankRequest.input, ['query', 'limit', 'candidates'], 'preflight_rank_mismatch');
    check(c.rankRequest.input.candidates.length === 12
      && new Set(c.rankRequest.input.candidates.map(candidate => candidate.memory.id)).size === 12, 'preflight_rank_mismatch');
    const source = sources[index], r = rubric.cases[index];
    check(c.id === source.id && r.id === c.id, 'roster_mismatch');
    same(c.source, { id: source.id, question: source.question, sessions: source.sessions }, 'source_mismatch');
    const regenerated = await prepareSourceBundleCase(sources, c.id);
    same(c.plan, regenerated.plan, 'source_plan_mismatch'); same(c.question, regenerated.question, 'question_mismatch');
    check(c.hashes.sourceSha256 === digest(source) && c.hashes.planSha256 === digest(c.plan)
      && c.hashes.stateSha256 === c.state.sha256 && c.state.sha256 === digest(c.state.snapshot)
      && c.postPreflightStateSha256 === c.state.sha256 && c.hashes.mappingSha256 === digest(c.mapping)
      && c.hashes.rankRequestSha256 === digest(c.rankRequest)
      && c.hashes.bundlePreparedSha256 === digest(c.bundlePrepared.request), 'preflight_hash_mismatch');
    for (const [prefix, wire] of [['ordinary', c.ordinaryWire], ['bundle', c.bundleWire]]) {
      check(c.hashes[`${prefix}CountSha256`] === digest(wire.countBody)
        && c.hashes[`${prefix}GenerationSha256`] === digest(wire.generationBody), 'preflight_hash_mismatch'); }
    same(p.manifest.cases[index], { id: c.id, ...c.hashes }, 'preflight_hash_mismatch');
    same(c.namespace, c.plan.cairnPlan.batches[0].captureInput.namespace, 'source_plan_mismatch');
    check(c.mapping.length === 12 && c.outcomes.length === 12 && c.extractionInputs.length === 12 && c.classificationInputs.length === 12
      && new Set(c.mapping.map(m => m.memoryId)).size === 12 && new Set(c.mapping.map(m => m.receipt.id)).size === 12, 'capture_mismatch');
    for (const [n, mapped] of c.mapping.entries()) {
      const session = source.sessions[n], batch = c.plan.cairnPlan.batches[n], window = batch.indexedWindows[0];
      fields(mapped, ['originalSessionId', 'eventTime', 'originalMessageIndex', 'originalContent', 'role', 'window', 'sourceIndex',
        'captureInput', 'memoryId', 'revision', 'receipt'], 'capture_mismatch');
      check(mapped.originalSessionId === session.id && mapped.originalMessageIndex === 0 && mapped.eventTime === session.eventTime
        && mapped.originalContent === session.messages[0].content && mapped.role === session.messages[0].role
        && mapped.window === window.content && mapped.sourceIndex === window.index
        && mapped.receipt.excerpt === mapped.window && mapped.receipt.role === mapped.role
        && mapped.receipt.eventId === batch.captureInput.messages[0].id
        && mapped.receipt.sessionId === batch.captureInput.sessionId && mapped.receipt.client === 'longmemeval-ingestion-v1', 'capture_mismatch');
      same(mapped.captureInput, batch.captureInput, 'capture_mismatch');
      const memoryRow = c.state.snapshot.tables.find(table => table.name === 'memories')?.rows.find(row => row.id === mapped.memoryId);
      const receiptRow = c.state.snapshot.tables.find(table => table.name === 'receipts')?.rows.find(row => row.id === mapped.receipt.id);
      check(memoryRow && memoryRow.content === mapped.window && memoryRow.revision === mapped.revision
        && memoryRow.deleted === 0 && memoryRow.currentness === 'current' && memoryRow.filing_status === 'unfiled'
        && memoryRow.owner_id === c.namespace.ownerId && memoryRow.scope === c.namespace.scope && memoryRow.project_id === c.namespace.projectId
        && receiptRow && receiptRow.memory_id === mapped.memoryId && receiptRow.role === mapped.role
        && receiptRow.excerpt === mapped.window && receiptRow.client === mapped.receipt.client
        && receiptRow.event_id === mapped.receipt.eventId && receiptRow.session_id === mapped.receipt.sessionId, 'capture_snapshot_mismatch');
      const outcome = c.outcomes[n]; check(outcome.duplicate === false && outcome.admission?.memories.length === 1
        && outcome.admission.memories[0].id === mapped.memoryId && outcome.admission.suppressedCount === 0
        && outcome.classification.status === 'applied' && !outcome.extractionTruncated && !outcome.qualificationTruncated, 'capture_mismatch');
      const origin = c.plan.originMap.turns.find(turn => turn.renderedTurnId === batch.sourceMap[0].turnId);
      check(origin && origin.originalSessionIndex === n && origin.originalTurnIndex === 0
        && window.start <= origin.bodyStart && window.end >= origin.bodyEnd, 'anchor_origin_mismatch');
      // The retained window includes a prefix; original-coordinate fields can
      // be null. Compare the exact full original body, not null-offset affine guesses.
      const renderedBody = window.content.slice(origin.bodyStart - window.start, origin.bodyEnd - window.start);
      check(renderedBody === mapped.originalContent.normalize('NFKC').replace(/\s+/gu, ' ').trim(), 'anchor_origin_mismatch');
      for (const anchor of r.anchors.filter(a => a.sessionId === session.id)) check(anchor.messageIndex === 0
        && integer(anchor.start, mapped.originalContent.length) && integer(anchor.end, mapped.originalContent.length)
        && anchor.end > anchor.start && mapped.originalContent.slice(anchor.start, anchor.end) === anchor.text
        && anchor.text.isWellFormed() && renderedBody.includes(anchor.text), 'anchor_origin_mismatch');
      const candidate = c.rankRequest.input.candidates.find(candidate => candidate.memory.id === mapped.memoryId);
      check(candidate, 'preflight_rank_mismatch');
      check(candidate.namespaceIndex === 0 && candidate.memory.id === mapped.memoryId && candidate.memory.revision === mapped.revision
        && candidate.memory.currentness === 'current' && candidate.receiptCount === 1
        && candidate.interpretationStatus === 'omitted' && candidate.sourceSelectionCoverage === 'unassessed', 'preflight_rank_mismatch');
      same(candidate.receipts, [{ id: mapped.receipt.id, role: mapped.role, excerpt: mapped.window }], 'preflight_rank_mismatch');
    }
    check(c.rankRequest.input.query === c.plan.mem0Input.query && c.rankRequest.input.limit === 6 && c.rankRequest.maxOutputTokens === 1024
      && c.publicMap.items.length === 12 && c.recallMap.items.length === 12
      && c.publicMap.exhausted && c.recallMap.exhausted && c.recallMap.nextCursor === null
      && c.recallMap.invalidRefs.length === 0 && Object.values(c.omissionCounters).every(n => n === 0)
      && Object.values(c.tokenCounts).every(n => integer(n, 6000)), 'preflight_rank_mismatch');
    same(c.bundlePrepared.originalInput, c.rankRequest.input, 'preflight_rank_mismatch');
    fields(c.bundlePrepared, ['request', 'originalInput', 'requestSha256']);
    const bundleIndex = { type: 'integer', minimum: 0, maximum: 11 };
    same(c.bundlePrepared.request, { system: BUNDLE_RANK_INSTRUCTION, input: { query: c.rankRequest.input.query, limit: 6, catalog: c.bundlePrepared.request.input.catalog },
      outputSchema: { type: 'object', additionalProperties: false, required: ['bundles'], properties: { bundles: { type: 'array', maxItems: 6,
        items: { type: 'object', additionalProperties: false, required: ['sourceIndices', 'terminalSourceIndex'], properties: {
          sourceIndices: { type: 'array', minItems: 1, maxItems: 6, items: bundleIndex }, terminalSourceIndex: bundleIndex } } } } }, maxOutputTokens: 1024 }, 'preflight_rank_mismatch');
    same(c.ordinaryWire, sourceWires(c.rankRequest, 'rank'), 'preflight_wire_mismatch');
    same(c.bundleWire, sourceWires(c.bundlePrepared.request, 'plan', true), 'preflight_wire_mismatch');
    check(c.bundlePrepared.requestSha256 === c.hashes.bundlePreparedSha256, 'preflight_rank_mismatch');
    same(c.bundlePrepared.request.input.catalog, c.rankRequest.input.candidates.flatMap(candidate => candidate.receipts.map((receipt, i) => ({
      sourceIndex: c.rankRequest.input.candidates.indexOf(candidate) + i, ...ref(candidate), receiptId: receipt.id, recordedRole: receipt.role, excerpt: receipt.excerpt }))), 'preflight_rank_mismatch');
  }
  same(p.manifest, { version: p.version, sourceVersion: 'source-bundle-qa24-v1', model: MODEL, sourceSha256: SOURCES,
    selectionMode: 'bounded-source-scan', contextMode: 'source-evidence', sourceCandidatePolicy: 'bounded-keyset-v1', limit: 6,
    orders: [['ordinary', 'source-bundle'], ['source-bundle', 'ordinary']], limits: { inputTokens: 6000, rankOutputTokens: 1024, contextWindow: 8192, mapTokens: 4000, cases: 24, cardsPerCase: 12 },
    resources: { cases: 24, cards: 288, receipts: 288, storeFileBytes: p.cases.reduce((sum, c) => sum + c.state.fileBytes, 0),
      maximumLocalTokens: Object.fromEntries(Object.keys(p.cases[0].tokenCounts).map(key => [key, Math.max(...p.cases.map(c => c.tokenCounts[key]))])) },
    qtWireContractSha256: 'f4f9a3b02fc87cae2c8306a51b31f3f1d6d5ee287b44d91580a65f15df91ebbc',
    cases: p.cases.map(c => ({ id: c.id, ...c.hashes })) }, 'preparation_manifest_mismatch');
  const result = fields(input.result, ['version', 'manifest', 'manifestSha256', 'status', 'stopReason', 'limits', 'deadlines', 'cases', 'history', 'resources', 'intents', 'transitions', 'finalState']);
  check(result.version === 'source-bundle-comparison-v1' && ['accounted', 'stopped'].includes(result.status)
    && (result.status === 'accounted' ? result.stopReason === null : FATAL.has(result.stopReason))
    && result.manifestSha256 === digest(result.manifest) && result.cases.length === 24, 'run_manifest_mismatch');
  same(result.limits, LIMITS, 'run_manifest_mismatch');
  const schedule = p.cases.map((c, index) => ({ id: c.id, ordinal: index + 1, armOrder: index % 2 ? ['source-bundle', 'ordinary'] : ['ordinary', 'source-bundle'],
    slots: { ordinary: `${c.id}_ordinary_qa`, 'source-bundle': `${c.id}_source_bundle_qa`, probe: `${c.id}_probe` } }));
  same(result.manifest, { version: result.version, preparationManifestSha256: p.manifestSha256, preparationManifest: p.manifest,
    dependencies: { corpus: '51bf373de67680d1fcf5ac0a7b29de1ae0f7055b', planner: '21f4bf0a512fa22f54bec637f5ef5a70c478b1f5', integration: '4423cd2bf91e3c479767bd1bebac3a6510846f07' }, limits: LIMITS, schedule }, 'run_manifest_mismatch');
  const resources = validateResources(p, result), items = [], stages = [], probes = [], excluded = [];
  for (const [index, report] of result.cases.entries()) {
    const c = p.cases[index], r = rubric.cases[index], row = schedule[index];
    check(report.id === c.id && report.ordinal === index + 1, 'roster_mismatch');
    fields(report, ['id', 'ordinal', 'question', 'armOrder', 'preparationHashes', 'answers', 'probe',
      ...(Object.hasOwn(report, 'caseDeadline') ? ['caseDeadline'] : [])]);
    if (Object.hasOwn(report, 'caseDeadline')) check(Number.isFinite(report.caseDeadline)
      && report.caseDeadline >= result.deadlines.began && report.caseDeadline <= result.deadlines.runDeadline
      && report.caseDeadline <= result.deadlines.began + result.resources.elapsedMs + LIMITS.caseMs, 'deadline_binding_mismatch');
    same(report.question, c.question, 'question_mismatch'); same(report.preparationHashes, c.hashes, 'preflight_hash_mismatch');
    same(report.armOrder, row.armOrder, 'run_manifest_mismatch'); fields(report.answers, ARMS);
    for (const arm of ARMS) {
      const slot = fields(report.answers[arm], ['status', 'execution', 'answerInvoked', 'answer', 'failure', 'artifacts']);
      check(['not-run', 'failed', 'completed'].includes(slot.execution) && ['answered', 'unresolved'].includes(slot.status)
        && typeof slot.answerInvoked === 'boolean', 'slot_mismatch');
      if (result.status === 'accounted') check(slot.execution !== 'not-run', 'slot_mismatch');
      if (slot.failure !== null) check(typeof slot.failure === 'string' && /^[a-z_]+$/u.test(slot.failure), 'slot_mismatch');
      if (FATAL.has(slot.failure)) check(result.status === 'stopped', 'slot_mismatch');
      const a = slot.artifacts, slotId = row.slots[arm], paid = result.intents.filter(intent => intent.slotId === slotId);
      fields(a, ['rankRequest', 'rankOutput', 'rankFailure', 'plannerRequest', 'plannerOutput', 'plannerFailure', 'recall', 'sidecar',
        'authoritativeReads', 'evidence', 'packed', 'answerResult', 'beforeStore', 'afterRecallStore', 'beforeAnswerStore', 'afterStore']);
      attestPhase(paid.filter(intent => intent.method !== 'answer'), arm === 'ordinary' ? c.ordinaryWire : c.bundleWire);
      if (arm === 'ordinary') for (const [n, intent] of paid.filter(intent => intent.method === 'rank').entries())
        check(intent.final?.localInputTokens === c.tokenCounts[n ? 'ordinaryGeneration' : 'ordinaryCount'], 'token_binding_mismatch');
      if (slot.execution === 'not-run') check(!paid.length && !slot.answerInvoked && slot.answer === null
        && slot.failure === result.stopReason && Object.values(a).every(value => value === null), 'slot_mismatch');
      for (const field of ['beforeStore', 'afterRecallStore', 'beforeAnswerStore', 'afterStore'])
        if (a[field] !== null) same(a[field], { sha256: c.state.sha256, fileBytes: c.state.fileBytes }, 'store_snapshot_mismatch');
      const candidates = rankCandidates(c, a.rankRequest), generation = paid.find(intent => intent.method !== 'answer'
        && (intent.ownerKind === 'planner' ? intent.final?.kind === 'generation' : intent.final?.endpoint === 'responses'));
      if (a.rankOutput !== null) {
        check(generation && a.rankRequest !== null, 'rank_binding_mismatch');
        if (arm === 'ordinary') same(a.rankOutput, responseOutput(generation), 'rank_binding_mismatch');
        else { same(a.plannerRequest, c.bundlePrepared.request, 'rank_binding_mismatch');
          same(a.plannerOutput, responseOutput(generation), 'rank_binding_mismatch'); }
      }
      if (a.recall?.ok === true) {
        same(a.recall.value.memories, (a.rankOutput?.refs ?? []).map(selected => {
          const candidate = c.rankRequest.input.candidates.find(candidate => refKey(ref(candidate)) === refKey(selected));
          check(candidate, 'recall_binding_mismatch'); return Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== 'namespaceIndex'));
        }), 'recall_binding_mismatch');
      }
      const passages = a.evidence === null ? null : normalize(c, arm, a);
      const answerIntent = paid.filter(intent => intent.method === 'answer'); check(answerIntent.length <= 1, 'answer_binding_mismatch');
      if (a.packed !== null) {
        check(passages !== null && integer(a.packed.inputTokens, 6000) && a.packed.reservedOutputTokens === 512
          && a.packed.totalEstimatedTokens === a.packed.inputTokens + 512, 'answer_binding_mismatch');
        same(a.packed.selectedIndices, a.evidence.units.map((_u, i) => i), 'answer_binding_mismatch');
        same(a.packed.omittedIndices, [], 'answer_binding_mismatch'); same(a.packed.duplicateIndices, [], 'answer_binding_mismatch');
        same(a.packed.request, { model: MODEL, messages: [{ role: 'system', content: PUBLIC_ANSWER_INSTRUCTION },
          { role: 'user', content: JSON.stringify({ evidence: a.evidence.units.map(unit => ({ text: unit.text })), currentQuestion: c.question }) }],
        temperature: 0, max_tokens: 512, n: 1 }, 'answer_binding_mismatch');
      }
      if (slot.answerInvoked) check(answerIntent.length === 1 && a.packed !== null
        && answerIntent[0].final?.requestBody === JSON.stringify(a.packed.request)
        && answerIntent[0].final?.localInputTokens === a.packed.inputTokens, 'answer_wire_mismatch');
      else check(!answerIntent.length && a.answerResult === null && slot.answer === null, 'answer_binding_mismatch');
      const actual = a.answerResult !== null;
      if (actual) { fields(a.answerResult, ['packed', 'answer'], 'answer_binding_mismatch');
        same(a.answerResult.packed, a.packed, 'answer_binding_mismatch');
        check(typeof a.answerResult.answer === 'string' && a.answerResult.answer.trim().length > 0
          && slot.answer === a.answerResult.answer && answerIntent[0]?.final?.outcome === 'succeeded'
          && responseOutput(answerIntent[0], true) === slot.answer, 'answer_binding_mismatch');
        items.push({ slotId, question: c.question, sources: sources[index].sessions, rubric: r, passages, answer: slot.answer });
      } else { check(slot.answer === null && slot.status !== 'answered', 'answer_binding_mismatch'); excluded.push({ slotId,
        execution: slot.execution, failure: slot.failure, answerInvoked: slot.answerInvoked, reason: 'no-actual-returned-first-answer' }); }
      if (slot.execution === 'completed') check(actual && slot.status === 'answered'
        && (slot.failure === null || result.status === 'stopped' && slot.failure === result.stopReason), 'slot_mismatch');
      const recallEntries = a.recall?.ok === true ? a.recall.value.memories.flatMap(item => item.receipts.map(receipt => ({ recordedRole: receipt.role, text: receipt.excerpt }))) : null;
      stages.push({ caseId: c.id, slotId, arm, answerability: r.answerability,
        capture: observation(r, c.mapping), rank: observation(r, candidates === null ? null : c.mapping),
        selected: observation(r, mapPassages(c, recallEntries)),
        preparedPacked: observation(r, a.packed !== null ? mapPassages(c, passages) : null),
        actualPacked: observation(r, slot.answerInvoked && answerIntent[0]?.dispatched ? mapPassages(c, passages) : null) });
    }
    const probe = report.probe, a = probe.artifacts;
    fields(probe, ['execution', 'failure', 'artifacts']);
    check(Object.keys(a).every(key => ['beforeStore', 'selectRequest', 'selected', 'selectFailure', 'rankRequest', 'recall', 'selectCalls', 'rankCalls', 'afterStore'].includes(key)), 'probe_mismatch');
    check(['not-run', 'failed', 'completed'].includes(probe.execution), 'probe_mismatch');
    check(probe.failure === null || typeof probe.failure === 'string' && /^[a-z_]+$/u.test(probe.failure), 'probe_mismatch');
    const has = key => Object.hasOwn(a, key), probeIntents = result.intents.filter(intent => intent.slotId === row.slots.probe);
    const settled = probe.execution === 'completed' || result.status === 'accounted';
    if (result.status === 'accounted') check(probe.execution !== 'not-run', 'probe_mismatch');
    if (probe.execution === 'not-run') check(Object.keys(a).length === 0 && !probeIntents.length && probe.failure === result.stopReason, 'probe_mismatch');
    else {
      check(probe.execution === 'completed' ? probe.failure === null : probe.failure !== null, 'probe_mismatch');
      if (FATAL.has(probe.failure)) check(result.status === 'stopped', 'probe_mismatch');
      if (settled) check(['beforeStore', 'afterStore', 'selectCalls', 'rankCalls', 'recall'].every(has), 'probe_mismatch');
      for (const key of Object.keys(a)) check(a[key] !== null, 'probe_mismatch');
      for (const key of ['beforeStore', 'afterStore']) if (has(key))
        same(a[key], { sha256: c.state.sha256, fileBytes: c.state.fileBytes }, 'store_snapshot_mismatch');
      for (const key of ['selectCalls', 'rankCalls']) if (has(key)) check(integer(a[key], 1), 'probe_mismatch');
      if (probe.execution === 'completed') check(a.selectCalls === 1 && has('selectRequest') && has('selected')
        && !has('selectFailure') && a.recall?.ok === true, 'probe_mismatch');
    }
    check(probeIntents.length <= 2 && (!probeIntents.length || has('selectRequest'))
      && probeIntents.every((intent, n) => intent.final === null || intent.final.endpoint === (n ? 'responses' : 'responses/input_tokens')), 'probe_mismatch');
    if (has('selectRequest')) {
      fields(a.selectRequest, ['system', 'input', 'maxOutputTokens'], 'probe_mismatch');
      fields(a.selectRequest.input, ['query', 'maps', 'maxRefs'], 'probe_mismatch');
      check(typeof a.selectRequest.system === 'string' && a.selectRequest.maxOutputTokens === 1024
        && a.selectRequest.input.query === c.plan.mem0Input.query && a.selectRequest.input.maxRefs === 24, 'probe_mismatch');
      same(a.selectRequest.input.maps, [{ namespaceIndex: 0, items: c.recallMap.items, exhausted: true }], 'probe_mismatch');
      if (has('selectCalls')) check(a.selectCalls === 1, 'probe_mismatch');
      attestPhase(probeIntents, sourceWires(a.selectRequest, 'select'));
    } else check(!has('selected') && !has('selectFailure') && !has('rankRequest')
      && (!settled || a.selectCalls === 0), 'probe_mismatch');
    if (has('recall') && has('selectCalls') && a.selectCalls === 1)
      check(has('selected') !== has('selectFailure'), 'probe_mismatch');
    let selectedEntries = null, selectedValid = false;
    if (has('selected')) {
      const generated = probeIntents[1];
      check(has('selectRequest') && generated?.dispatched && generated.final?.outcome === 'succeeded', 'probe_mismatch');
      same(a.selected, responseOutput(generated), 'probe_mismatch');
      const refs = a.selected.refs;
      selectedValid = Object.keys(a.selected).length === 1 && Array.isArray(refs) && refs.length <= 12
        && refs.every(ref => ref && Object.keys(ref).length === 3 && Object.hasOwn(ref, 'namespaceIndex')
          && Object.hasOwn(ref, 'memoryId') && Object.hasOwn(ref, 'revision') && ref.namespaceIndex === 0
          && c.mapping.some(entry => entry.memoryId === ref.memoryId && entry.revision === ref.revision))
        && new Set(refs.map(refKey)).size === refs.length;
      // A parsed HTTP success can still fail core's visible/unique-ref check.
      // Retain that observed output without crediting invalid selection.
      selectedEntries = selectedValid ? refs.map(ref => c.mapping.find(entry => entry.memoryId === ref.memoryId)) : [];
      if (!selectedValid) check(probe.execution === 'failed' && a.recall?.ok === false
        && a.recall.error?.code === 'invalid_model_output' && !has('rankRequest')
        && (probe.failure === 'invalid_model_output' || result.status === 'stopped'
          && FATAL.has(probe.failure) && probe.failure === result.stopReason), 'probe_mismatch');
    }
    if (has('selectFailure')) {
      fields(a.selectFailure, ['code'], 'probe_mismatch');
      check(has('selectRequest') && !has('selected') && !has('rankRequest') && probe.execution === 'failed'
        && typeof a.selectFailure.code === 'string' && /^[a-z_]+$/u.test(a.selectFailure.code), 'probe_mismatch');
      if (result.status === 'accounted' && a.selectFailure.code !== probe.failure) {
        // Core can win its local timer race while the settled ordinary adapter
        // reports AbortError as provider_failed. Bind this exact layer split;
        // neither a free-standing slot label nor arbitrary cause mismatch fits.
        const intent = probeIntents.at(-1), raw = intent?.final;
        const owner = result.transitions.find(transition => transition.phaseId === `${c.id}_probe_select`);
        const delta = owner?.state?.appendedAttempts?.find(attempt => attempt.attemptId === intent?.attemptId);
        check(a.selectFailure.code === 'provider_failed' && probe.failure === 'model_timeout'
          && a.recall?.ok === false && a.recall.error?.code === 'model_timeout'
          && intent?.dispatched === true && raw?.failure === 'model_timeout' && raw.outcome === 'unknown'
          && owner?.closed === true && owner.healthy === true && delta?.outcome === raw.outcome
          && delta.actualMicroUsd === raw.actualMicroUsd, 'probe_mismatch');
      }
    }
    if (has('rankRequest')) {
      check(selectedValid && selectedEntries.length > 0 && (!has('rankCalls') || a.rankCalls === 1), 'probe_mismatch');
      same(a.rankRequest, { ...c.rankRequest, input: { ...c.rankRequest.input,
        candidates: a.selected.refs.map(selected => c.rankRequest.input.candidates.find(candidate => refKey(selected) === refKey(ref(candidate)))) } }, 'probe_mismatch');
    }
    if (has('rankCalls')) check(a.rankCalls === (has('rankRequest') ? 1 : 0), 'probe_mismatch');
    if (has('recall')) {
      if (a.recall?.ok === true) {
        check(selectedValid && has('rankRequest') === (selectedEntries.length > 0), 'probe_mismatch');
        same(a.recall, { ok: true, value: { memories: [], namespaces: [{ namespace: c.namespace,
          mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } }, 'probe_mismatch');
        check(probe.execution === 'completed' || result.status === 'stopped', 'probe_mismatch');
      } else {
        fields(a.recall, ['ok', 'error'], 'probe_mismatch'); fields(a.recall.error, ['code', 'retryable'], 'probe_mismatch');
        check(a.recall.ok === false && typeof a.recall.error.code === 'string' && typeof a.recall.error.retryable === 'boolean'
          && probe.execution === 'failed', 'probe_mismatch');
        if (result.status === 'accounted' && a.recall.error.code === 'model_timeout')
          check(probe.failure === 'model_timeout', 'probe_mismatch');
      }
    }
    if (a.selectFailure?.code === 'context_budget_exceeded') check(result.status === 'stopped'
      && result.stopReason === 'context_budget_exceeded' && !a.rankRequest, 'probe_mismatch');
    probes.push({ caseId: c.id, execution: probe.execution, failure: probe.failure,
      map: observation(r, a.selectRequest ? c.mapping : null),
      selected: observation(r, selectedEntries),
      rank: observation(r, a.rankRequest ? mapPassages(c, a.rankRequest.input.candidates.flatMap(candidate => candidate.receipts.map(receipt => ({ recordedRole: receipt.role, text: receipt.excerpt })))) : null),
      recall: observation(r, a.recall?.ok === true ? mapPassages(c, a.recall.value.memories.flatMap(item => item.receipts.map(receipt => ({ recordedRole: receipt.role, text: receipt.excerpt })))) : null) });
  }
  const bindings = { sourcesSha256: SOURCES, rubricSha256: RUBRIC, preparationManifestSha256: p.manifestSha256,
    runManifestSha256: result.manifestSha256, resultSha256: digest(result), runtimeCommitSha: RUNTIME };
  const packetSet = createSourceBundleJudgePackets({ bindings, seedHex: input.seedHex, items });
  const { byPhase, ...resourceReport } = resources;
  return { version: 'source-bundle-scoring-preparation-v1', status: 'ready', issues: [], bindings,
    mechanical: { cases: 24, anchors: 67, answerable: 18, qualified: 6, stages, probes }, packets: packetSet.packets,
    privateMapping: packetSet.privateMapping, excludedAnswers: excluded, packetSet, resourceReport };
}

/** Pure retained-read validation. No stores, provider, files or capabilities. */
export async function prepareSourceBundleScoring(optionsInput) {
  try { const internal = await retained(options(optionsInput, false));
    return freeze(Object.fromEntries(['version', 'status', 'issues', 'bindings', 'mechanical', 'packets', 'privateMapping', 'excludedAnswers']
      .map(key => [key, internal[key]]))); }
  catch (failure) { const code = types.isNativeError(failure) && typeof failure.message === 'string'
    && /^[a-z_]+$/u.test(failure.message) ? failure.message : 'retained_integrity_mismatch';
    return freeze({ version: 'source-bundle-scoring-preparation-v1', status: 'denied', issues: [code],
      bindings: null, mechanical: null, packets: [], privateMapping: [], excludedAnswers: [] }); }
}

function supportedCorrect(actual, stage, judgment) {
  if (!actual || stage.actualPacked.complete === false || judgment?.fields.correctness.value === 'no'
    || judgment?.fields.support.value === 'no') return false;
  if (stage.actualPacked.complete === true && judgment?.fields.correctness.value === 'yes'
    && judgment?.fields.support.value === 'yes') return true;
  return null;
}
function summarize(rows) {
  const answers = rows.filter(row => row.actualAnswer);
  const counts = name => ({ knownQuestions: answers.filter(row => row.judgment.fields[name].value !== null).length,
    affectedQuestions: answers.filter(row => row.judgment.fields[name].value > 0).length,
    claims: answers.some(row => row.judgment.fields[name].value === null) ? null
      : answers.reduce((sum, row) => sum + row.judgment.fields[name].value, 0),
    knownClaims: answers.reduce((sum, row) => sum + (row.judgment.fields[name].value ?? 0), 0),
    coverage: answers.some(row => row.judgment.fields[name].value === null) ? 'partial-known-only' : 'complete-actual-answers',
    unknownQuestions: answers.filter(row => row.judgment.fields[name].value === null).length });
  return { cases: rows.length, actualAnswers: answers.length, completed: rows.filter(r => r.execution === 'completed').length,
    consumedFailures: rows.filter(r => r.execution === 'failed').length, notRun: rows.filter(r => r.execution === 'not-run').length,
    supportedCorrect: { true: rows.filter(r => r.supportedCorrect === true).length, false: rows.filter(r => r.supportedCorrect === false).length, unknown: rows.filter(r => r.supportedCorrect === null).length },
    correctness: Object.fromEntries(['yes', 'no', 'unknown'].map(value => [value, answers.filter(r => r.judgment.fields.correctness.value === value).length])),
    support: Object.fromEntries(['yes', 'no', 'unknown'].map(value => [value, answers.filter(r => r.judgment.fields.support.value === value).length])),
    retainedCompleteCases: rows.filter(r => r.stage.actualPacked.complete === true).length,
    unsupported: counts('unsupportedClaims'), stale: counts('staleClaims') };
}

/** Regenerate blind packet identities; never trust an imported private mapping. */
export async function scoreSourceBundleComparison(optionsInput) {
  let input, prepared;
  try { input = options(optionsInput, true); prepared = await retained(input);
    same(input.packetBindings, prepared.packets.map(({ judgeId, packetSha256 }) => ({ judgeId, packetSha256 })), 'packet_binding_mismatch'); }
  catch (failure) { return freeze({ version: 'source-bundle-scoring-report-v1', status: 'denied', integrity: { status: 'denied', issues: [types.isNativeError(failure) ? failure.message : 'retained_integrity_mismatch'] },
    bindings: null, denominators: { casesPerArm: 24, qaSlots: 48, probes: 24, answerable: 18, qualified: 6, anchors: 67 },
    cases: [], stages: [], probes: [], judgments: null, summaries: null, paired: null, harms: null, resources: null,
    gate: { promising: false, reasons: ['integrity-denied'] }, limitations: [...LIMITATIONS] }); }
  let judgments;
  try { judgments = parseSourceBundleFirstJudgments({ packetSet: prepared.packetSet, rawFirstResponses: input.rawFirstResponses }); }
  catch { return freeze({ version: 'source-bundle-scoring-report-v1', status: 'denied', integrity: { status: 'denied', issues: ['invalid_first_response_inputs'] },
    bindings: prepared.bindings, denominators: { casesPerArm: 24, qaSlots: 48, probes: 24, answerable: 18, qualified: 6, anchors: 67 },
    cases: [], stages: prepared.mechanical.stages, probes: prepared.mechanical.probes, judgments: null, summaries: null, paired: null, harms: null,
    resources: prepared.resourceReport, gate: { promising: false, reasons: ['first-response-inputs-denied'] }, limitations: [...LIMITATIONS] }); }
  const bySlot = new Map(judgments.items.map(item => [item.slotId, item]));
  const cases = input.result.cases.map((c, index) => ({ caseId: c.id, answerability: input.rubric.cases[index].answerability,
    arms: Object.fromEntries(ARMS.map(arm => { const slot = c.answers[arm], slotId = input.result.manifest.schedule[index].slots[arm];
      const stage = prepared.mechanical.stages.find(stage => stage.slotId === slotId), judgment = bySlot.get(slotId) ?? null;
      const actualAnswer = slot.artifacts.answerResult !== null;
      return [arm, { slotId, actualAnswer, execution: slot.execution, failure: slot.failure, stage, judgment,
        supportedCorrect: supportedCorrect(actualAnswer, stage, judgment) }]; })) }));
  const summaries = Object.fromEntries(ARMS.map(arm => [arm, { all: summarize(cases.map(c => c.arms[arm])),
    answerable: summarize(cases.filter(c => c.answerability === 'answerable').map(c => c.arms[arm])),
    qualified: summarize(cases.filter(c => c.answerability === 'qualified').map(c => c.arms[arm])) }]));
  const paired = { lower: 0, upper: 0, wins: 0, losses: 0, ties: 0, uncertain: 0 };
  const severe = [];
  for (const c of cases) {
    const baseline = c.arms.ordinary.supportedCorrect, bundle = c.arms['source-bundle'].supportedCorrect;
    paired.lower += (bundle === true ? 1 : 0) - (baseline === false ? 0 : 1);
    paired.upper += (bundle === false ? 0 : 1) - (baseline === true ? 1 : 0);
    if (baseline === null || bundle === null) paired.uncertain++;
    else if (baseline === bundle) paired.ties++; else if (bundle) paired.wins++; else paired.losses++;
    input.rubric.cases.find(r => r.id === c.caseId).severeConditions.forEach((condition, conditionIndex) => {
      const value = arm => c.arms[arm].actualAnswer ? c.arms[arm].judgment.severe[conditionIndex].value : 'no';
      const b = value('ordinary'), t = value('source-bundle');
      severe.push({ caseId: c.caseId, conditionIndex, condition, ordinary: b, sourceBundle: t,
        newlyPositive: t === 'yes' && b !== 'yes', sharedPositive: t === 'yes' && b === 'yes', known: b !== 'unknown' && t !== 'unknown' });
    });
  }
  const baseline = summaries.ordinary.all, bundle = summaries['source-bundle'].all;
  const difference = (a, b) => a === null || b === null ? null : a - b;
  const harms = { unsupported: { addedQuestions: bundle.unsupported.affectedQuestions - baseline.unsupported.affectedQuestions,
    addedClaims: difference(bundle.unsupported.claims, baseline.unsupported.claims) },
  stale: { addedQuestions: bundle.stale.affectedQuestions - baseline.stale.affectedQuestions, addedClaims: difference(bundle.stale.claims, baseline.stale.claims) },
  severe, known: ARMS.every(arm => !summaries[arm].all.unsupported.unknownQuestions && !summaries[arm].all.stale.unknownQuestions)
    && severe.every(row => row.known), D12Cleared: false };
  const reasons = [];
  if (input.result.status !== 'accounted') reasons.push('stopped-run');
  if (paired.lower < 3) reasons.push('paired-lower-below-three');
  if (bundle.retainedCompleteCases <= baseline.retainedCompleteCases) reasons.push('no-complete-set-case-gain');
  if (!harms.known) reasons.push('unknown-safety');
  if ([harms.unsupported, harms.stale].some(row => row.addedQuestions > 0 || row.addedClaims > 0)) reasons.push('added-unsupported-or-stale');
  if (severe.some(row => row.newlyPositive)) reasons.push('new-severe-condition');
  if (prepared.resourceReport.compliance.status !== 'satisfied') reasons.push('resource-compliance-not-satisfied');
  return freeze({ version: 'source-bundle-scoring-report-v1', status: 'assessed', integrity: { status: 'valid', issues: [] }, bindings: prepared.bindings,
    denominators: { casesPerArm: 24, qaSlots: 48, probes: 24, answerable: 18, qualified: 6, anchors: 67 },
    cases, stages: prepared.mechanical.stages, probes: prepared.mechanical.probes, judgments, summaries, paired, harms,
    resources: prepared.resourceReport, gate: { promising: reasons.length === 0, reasons }, limitations: [...LIMITATIONS] });
}

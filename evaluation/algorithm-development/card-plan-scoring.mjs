import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { posix } from 'node:path';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { schemasFor } from '../../adapters/openai/schemas.mjs';
import { prepareCardPlanQaCase, validateCardPlanQaCases } from './card-plan-profile.mjs';
import { prepareCardPlanRankRequest, compileCardPlan } from '../architecture/card-plan-rank.mjs';
import { compileOrdinaryCardSelection } from '../architecture/card-plan-projection.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { createSourceBundleJudgePackets, parseSourceBundleFirstJudgments } from './source-bundle-judging.mjs';

const RUNTIME = '4309ff396834f60c237910493c2dc837e11de4dc', MODEL = 'gpt-4.1-mini-2025-04-14';
const SOURCE_RAW = '9a426a536efd97c8b61a7aed9890a399f7e6f8cb72758cc2c1fbc2c78605a48f';
const SOURCE_VALUE = '09ecd9710ea980d8ac228ad55858e4a757de4dc006eb8451a30707142b102cb5';
const RUBRIC_RAW = 'c0aea913f90bd8437a455f5d9048dfd26364120b15822dccd0ff452ed4447d8c';
const RUBRIC_VALUE = '58ba116268bac50ce69bd8ca4598a31e1c3bcd9eaa6836345c86da6845f840c8';
const ORDINARY_PROMPT = 'c9cb1fbf0bee20a0e8568d405cc3ac9fb81ceb65926f47389ad13975d96326da';
// Reviewed-code provenance constants, not a claim of runtime file attestation.
const CONTROL_HASHES = {
  'architecture/card-plan-rank.mjs': '4a5b40fcc925b8a6ac0bdcc003862400fcb99ac5fdf47e0685a5f2989b5cbd58',
  'architecture/card-plan-evidence.mjs': '4dff6162bdbee1052ef415244f0971c2a7bbb14d4d7bfd7693353c571cf9107a',
  'architecture/card-plan-projection.mjs': 'b723805993bd57b82cb6b946b0ea148e63ab65fdaf077994799c11b0425685a6',
  'algorithm-development/source-bundle-judging.mjs': '9e960ecfc90a8b63a1aeb46766679983478dd0324c59d9713dc5309ae376a8df',
  'algorithm-development/card-plan-runner.mjs': '1a9a7fe77f79566f23c14972eae6474b52f118761d0202236355eafa0d404821',
  'algorithm-development/card-plan-store.mjs': '7791ef1c08f198713902d4bab18b91a05392633aaa90b0575fe4bff598ab1691',
  'algorithm-development/card-plan-profile.mjs': '53092d65ac9fa3b787af219e2cc04621a0d8d013ad9c6c9562aa449f3d63649e',
};
const DENOMINATORS = { casesPerArm: 24, selectionSlots: 48, answerSlots: 72,
  answerable: 18, qualified: 6, sourceMessages: 288, anchors: 102 };
const LIMITS = { cases: 24, selections: 48, answers: 72, httpRequests: 168,
  reservationMicroUsd: 5000, reservedMicroUsd: 840000, inputTokens: 6000,
  providerInputTokens: 7024, rankOutputTokens: 1024, answerOutputTokens: 512,
  logicalMs: 30000, physicalMs: 200000, caseMs: 1200000, runMs: 28800000 };
const ORDERS = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'], ARMS = ['A', 'B', 'C'];
const HEX = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const LIMITATIONS = [
  'Artifact consistency is not proof against wholesale transcript fabrication.',
  'Runtime execution, old history prefix, deadlines, firstness and independent judges require separately reviewed external provenance.',
  'Recorded roles identify submitted source receipts, not authenticated subjects or instructions.',
  'C organization is unverified and diagnostic only; B selection is shared, not a third ranking call.',
  'Peak RSS, service cost and common preparation latency are unmeasured.',
  'Scripted complete-map arithmetic is not measured algorithm efficacy, natural-history MOC, lightweight product fit or readiness; D12 and Stage2/3 remain uncleared.',
];
const sha = value => createHash('sha256').update(value).digest('hex'), hash = value => sha(JSON.stringify(value));
// Ordinary boundedBody retains Buffer UTF-8 text, then its fatal TextDecoder
// consumes exactly one leading UTF-8 BOM. Keep literal identity separate from
// the derived decoded body; this is not whitespace trimming or JSON repair.
const ordinaryDecodedText = text => text.startsWith('\uFEFF') ? text.slice(1) : text;
const denialReasons = new WeakMap();
const fail = code => { const error = new TypeError(code); denialReasons.set(error, code); throw error; };
const check = (condition, code) => { if (!condition) fail(code); };
const same = (a, b, code) => check(isDeepStrictEqual(a, b), code);
const literal = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);
const integer = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= 0 && n <= max;
// Provider transports accept signed zero. Retained canonical metadata still
// uses integer(); this replay rule does not relax runtime observation copying.
const providerInteger = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const duration = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// Reflection follows proxy/prototype checks. Literal artifact/first-response
// strings are not copied into a generic small metadata snapshot.
function fields(value, names, code = 'invalid_input_shape') {
  check(value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
  const ds = Object.getOwnPropertyDescriptors(value), ks = Reflect.ownKeys(ds);
  check(ks.length === names.length && names.every(k => ds[k]?.enumerable && Object.hasOwn(ds[k], 'value')), code);
  return Object.fromEntries(names.map(k => [k, ds[k].value]));
}
function dense(value, maximum, code = 'invalid_input_shape') {
  check(Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype, code);
  const ds = Object.getOwnPropertyDescriptors(value), ks = Reflect.ownKeys(ds), length = ds.length?.value;
  check(integer(length, maximum) && ks.length === length + 1, code);
  return Array.from({ length }, (_, i) => {
    const d = ds[String(i)]; check(d?.enumerable && Object.hasOwn(d, 'value'), code); return d.value;
  });
}
function json(text, state, name) {
  let value; try { value = JSON.parse(text); } catch { fail('invalid_metadata_json'); }
  check(JSON.stringify(value) === text, 'noncanonical_metadata_json');
  function walk(item, path = []) {
    check(++state.nodes <= 4000000 && path.length <= 32, 'metadata_traversal_limit');
    if (typeof item === 'string') {
      const answerField = /^CQ\d\d-answer-[ABC]\.json$/u.test(name)
        && (path.join('.') === 'answer' || path.join('.') === 'result.answer');
      check(answerField || item.isWellFormed(), 'invalid_metadata_unicode'); return;
    }
    if (typeof item === 'number') check(Number.isFinite(item) && !Object.is(item, -0), 'invalid_metadata_json');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      check(++state.nodes <= 4000000, 'metadata_traversal_limit');
      check(!['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key) && key.isWellFormed(), 'invalid_metadata_key');
      walk(child, [...path, key]);
    }
  }
  walk(value); return value;
}
function inputOf(options, scoring) {
  check(!Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
    && !Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'), 'inherited_json_hook');
  const input = fields(options, ['sourceRaw', 'rubricRaw', 'artifacts', 'execution', 'judgeSeeds', ...(scoring ? ['firstResponses'] : [])]);
  const execution = fields(input.execution, ['runtimeCommitSha', 'artifactIndexSha256', 'originalHistoryHeader', 'provenanceRecordSha256']);
  check(execution.runtimeCommitSha === RUNTIME, 'runtime_pin_mismatch');
  check(typeof execution.artifactIndexSha256 === 'string' && HEX.test(execution.artifactIndexSha256)
    && typeof execution.provenanceRecordSha256 === 'string' && HEX.test(execution.provenanceRecordSha256), 'invalid_execution_identity');
  if (execution.originalHistoryHeader !== null) {
    execution.originalHistoryHeader = fields(execution.originalHistoryHeader, ['schemaVersion', 'runId', 'limitMicroUsd',
      'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256'], 'history_header_shape');
    check(Object.values(execution.originalHistoryHeader).every(v => v === null || ['string', 'number', 'boolean'].includes(typeof v)), 'history_header_shape');
  }
  const seeds = fields(input.judgeSeeds, ['AB', 'C']);
  check(typeof seeds.AB === 'string' && typeof seeds.C === 'string' && HEX.test(seeds.AB) && HEX.test(seeds.C) && seeds.AB !== seeds.C, 'invalid_judge_seeds');
  for (const [key, size, digest] of [['sourceRaw', 90785, SOURCE_RAW], ['rubricRaw', 76804, RUBRIC_RAW]])
    check(typeof input[key] === 'string' && input[key].isWellFormed() && Buffer.byteLength(input[key]) === size
      && sha(input[key]) === digest, `${key === 'sourceRaw' ? 'source' : 'rubric'}_identity_mismatch`);
  const sources = validateCardPlanQaCases(JSON.parse(input.sourceRaw)), rubric = JSON.parse(input.rubricRaw);
  check(hash(sources) === SOURCE_VALUE && hash(rubric) === RUBRIC_VALUE, 'corpus_value_mismatch');
  const artifacts = dense(input.artifacts, 939, 'artifact_count_or_shape');
  const entries = new Map(), state = { nodes: 0 }, counts = { request: 0, response: 0 };
  let total = 0, metadata = 0;
  for (const row of artifacts) {
    const { name, text } = fields(row, ['name', 'text'], 'artifact_pair_shape');
    check(typeof name === 'string' && name.isWellFormed() && !entries.has(name), 'artifact_name_or_duplicate');
    const metadataName = /^(?:preparation|run-start|comparison-report|CQ(?:0[1-9]|1\d|2[0-4])-(?:preparation|selection-[AB]|answer-[ABC]))\.json$/u.test(name)
      || /^record-\d{4}\.json$/u.test(name) && Number(name.slice(7, 11)) >= 1 && Number(name.slice(7, 11)) <= 336
      || /^checkpoint-\d{4}\.json$/u.test(name) && Number(name.slice(11, 15)) >= 1 && Number(name.slice(11, 15)) <= 120;
    const body = name.match(/^([a-f0-9-]+)-(request|response)\.txt$/u);
    check(metadataName || body && UUID.test(body[1]), 'artifact_name_or_duplicate');
    check(typeof text === 'string' && text.isWellFormed(), 'invalid_artifact_text');
    const bytes = Buffer.byteLength(text), maximum = metadataName ? 8388608 : body[2] === 'request' ? 262144 : 786432;
    check(bytes <= maximum, 'artifact_file_limit'); total += bytes; check(total <= 268435456, 'artifact_aggregate_limit');
    if (metadataName) { metadata += bytes; check(metadata <= 67108864, 'metadata_aggregate_limit'); }
    else check(++counts[body[2]] <= 168, 'body_count_limit');
    entries.set(name, { name, text, bytes, sha256: sha(text), value: metadataName ? json(text, state, name) : null });
  }
  const index = [...entries.values()].map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  check(hash(index) === execution.artifactIndexSha256, 'artifact_index_mismatch');
  let firstResponses;
  if (scoring) {
    firstResponses = fields(input.firstResponses, ['AB', 'C'], 'first_response_shape');
    for (const domain of ['AB', 'C']) {
      const rows = dense(firstResponses[domain], 2, 'first_response_shape'); check(rows.length === 2, 'first_response_shape');
      firstResponses[domain] = rows.map((row, i) => {
        const r = fields(row, ['judgeId', 'rawResponse'], 'first_response_shape');
        check(r.judgeId === ['A', 'B'][i] && (r.rawResponse === null || typeof r.rawResponse === 'string'), 'first_response_shape');
        return r;
      });
    }
  }
  return { ...input, execution, judgeSeeds: seeds, sources, rubric, entries, firstResponses };
}
function denied(scoring, reason) {
  const output = { version: scoring ? 'card-plan-scoring-report-v1' : 'card-plan-scoring-preparation-v1',
    status: 'denied', integrity: { status: 'denied', reason }, bindings: null, provenance: null,
    denominators: { ...DENOMINATORS }, runtime: null, mechanical: null, resources: null, limitations: [...LIMITATIONS] };
  if (scoring) Object.assign(output, { cases: [], judgments: null, summaries: null, paired: null, harms: null,
    gate: { mechanismPromising: false, reasons: ['integrity-denied'], Stage2Passed: false, productDefaultAdvancement: false } });
  else output.judgeDomains = null;
  return freeze(output);
}
function wires(request, card = false) {
  const body = { model: MODEL, instructions: request.system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request.input) }] }],
    text: { format: { type: 'json_schema', name: card ? 'cairn_card_budgeted_plan_rank_v1' : 'cairn_rank',
      strict: true, schema: card ? request.outputSchema : schemasFor('rank', request.input) } }, truncation: 'disabled' };
  return [JSON.stringify(body), JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false })];
}
const ref = card => ({ namespaceIndex: card.namespaceIndex, memoryId: card.memory.id, revision: card.memory.revision });
const refKey = row => JSON.stringify([row.namespaceIndex, row.memoryId, row.revision]);

async function validatePreparation(input, get, resolve) {
  const roster = get('preparation.json').value;
  fields(roster, ['version', 'outputRoot', 'rootIdentity', 'sourceValueSha256', 'sourceFileSha256', 'cases', 'cardCount',
    'receiptCount', 'extraction', 'classification', 'semanticSufficiency'], 'preparation_shape');
  check(roster.version === 'card-plan-comparison-preparation-v1' && roster.sourceValueSha256 === SOURCE_VALUE
    && roster.sourceFileSha256 === SOURCE_RAW && roster.cardCount === 288 && roster.receiptCount === 288
    && roster.extraction === 'scripted-exact-window-v1' && roster.classification === 'scripted-unfiled-v1'
    && roster.semanticSufficiency === 'unassessed', 'preparation_identity_mismatch');
  check(typeof roster.outputRoot === 'string' && /^\/(?!$)/u.test(roster.outputRoot) && posix.resolve(roster.outputRoot) === roster.outputRoot
    && !roster.outputRoot.endsWith('/') && !roster.outputRoot.split('/').some(p => p === '.' || p === '..'), 'output_root_shape');
  fields(roster.rootIdentity, ['dev', 'ino', 'uid'], 'root_identity_shape');
  check(Object.values(roster.rootIdentity).every(n => integer(n)), 'root_identity_shape');
  check(Array.isArray(roster.cases) && roster.cases.length === 24, 'preparation_roster_mismatch');
  const memoryIds = new Set(), receiptIds = new Set(), cases = [];
  for (const [i, row] of roster.cases.entries()) {
    fields(row, ['id', 'path', 'stateSha256', 'artifact'], 'preparation_roster_mismatch');
    const source = input.sources[i], c = resolve(row.artifact, `${source.id}-preparation.json`).value;
    check(row.id === source.id && row.path === `${roster.outputRoot}/${source.id}.sqlite` && c.id === source.id
      && c.path === row.path && row.stateSha256 === c.stateAfter?.sha256, 'preparation_roster_mismatch');
    fields(c, ['id', 'path', 'fileIdentity', 'plan', 'namespace', 'question', 'sourceProvenance', 'captures', 'map',
      'actualRecallMap', 'recallMapOrder', 'rankRequest', 'recall', 'rankCalls', 'selectCalls', 'candidateReceiptOrder',
      'stateBefore', 'stateAfter', 'preparedCardRequestSha256', 'tokenWitnesses'], 'case_preparation_shape');
    const expected = await prepareCardPlanQaCase(input.sources, source.id);
    literal(c.plan, expected.plan, 'prepared_source_mismatch'); literal(c.question, expected.question, 'prepared_source_mismatch');
    literal(c.sourceProvenance, expected.sourceProvenance, 'prepared_source_mismatch');
    literal(c.namespace, expected.plan.cairnPlan.batches[0].captureInput.namespace, 'prepared_namespace_mismatch');
    fields(c.fileIdentity, ['dev', 'ino', 'uid'], 'store_identity_shape');
    check(Object.values(c.fileIdentity).every(n => integer(n)), 'store_identity_shape');
    for (const state of [c.stateBefore, c.stateAfter]) {
      fields(state, ['sha256', 'bytes', 'logical'], 'snapshot_shape');
      fields(state.logical, ['applicationId', 'userVersion', 'schema', 'tables'], 'snapshot_shape');
      check(state.sha256 === hash(state.logical) && integer(state.bytes) && state.bytes > 0
        && state.logical.applicationId === 0x43414952 && state.logical.userVersion === 18, 'snapshot_identity_mismatch');
      const tables = state.logical.schema.filter(s => s.type === 'table').map(s => s.name);
      same(Object.keys(state.logical.tables), tables, 'snapshot_table_mismatch');
      check(new Set(state.logical.schema.map(s => `${s.type}:${s.name}`)).size === state.logical.schema.length, 'snapshot_schema_mismatch');
      const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
      same(state.logical.schema, [...state.logical.schema].sort((a, b) => ascii(a.type, b.type) || ascii(a.name, b.name)), 'snapshot_schema_mismatch');
      for (const rows of Object.values(state.logical.tables)) {
        check(Array.isArray(rows), 'snapshot_table_mismatch');
        literal(rows, [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), 'snapshot_table_mismatch');
      }
    }
    literal(c.stateBefore, c.stateAfter, 'prepared_state_drift');
    check(Array.isArray(c.captures) && c.captures.length === 12, 'capture_count_mismatch');
    for (const [j, capture] of c.captures.entries()) {
      const batch = expected.plan.cairnPlan.batches[j], window = batch.indexedWindows[0];
      literal(capture.batch, batch, 'capture_source_mismatch');
      const value = capture.result?.value, memory = capture.memory, receipts = capture.receipts;
      check(capture.result?.ok === true && value?.admission?.memories?.length === 1
        && value.admission.suppressedCount === 0 && value.duplicate === false && value.classification?.status === 'applied'
        && memory?.state === 'active' && memory.revision === 1 && memory.receiptCount === 1
        && Array.isArray(receipts) && receipts.length === 1, 'capture_observation_mismatch');
      literal(memory.namespace, c.namespace, 'capture_observation_mismatch');
      const receipt = receipts[0];
      check(receipt.role === window.role && receipt.excerpt === window.content
        && receipt.sessionId === batch.captureInput.sessionId && receipt.eventId === batch.captureInput.messages[0].id
        && !memoryIds.has(memory.id) && !receiptIds.has(receipt.id), 'capture_source_mismatch');
      check(value.admission.memories[0].id === memory.id && value.admission.memories[0].revision === memory.revision, 'capture_observation_mismatch');
      memoryIds.add(memory.id); receiptIds.add(receipt.id);
      const storedMemory = c.stateAfter.logical.tables.memories?.find(r => r.id === memory.id);
      const storedReceipt = c.stateAfter.logical.tables.receipts?.find(r => r.id === receipt.id);
      check(storedMemory && storedReceipt && storedMemory.revision === memory.revision && storedMemory.content === window.content
        && storedMemory.owner_id === c.namespace.ownerId && storedMemory.project_id === c.namespace.projectId
        && storedMemory.scope === c.namespace.scope && storedMemory.deleted === 0
        && storedReceipt.memory_id === memory.id && storedReceipt.role === receipt.role && storedReceipt.excerpt === receipt.excerpt
        && storedReceipt.client === receipt.client && storedReceipt.session_id === receipt.sessionId
        && storedReceipt.event_id === receipt.eventId, 'capture_snapshot_mismatch');
    }
    check(c.stateAfter.logical.tables.memories.length === 12 && c.stateAfter.logical.tables.receipts.length === 12, 'capture_snapshot_mismatch');
    check(c.rankCalls === 1 && c.selectCalls === 0 && c.recall?.ok === true && c.recall.value.memories.length === 0
      && c.recall.value.coverage === 'complete' && c.recall.value.selection.strategy === 'complete-map'
      && !c.recall.value.recallTruncated, 'cold_recall_mismatch');
    const candidates = c.rankRequest?.input?.candidates;
    fields(c.rankRequest, ['system', 'input', 'maxOutputTokens'], 'rank_request_shape');
    fields(c.rankRequest.input, ['query', 'limit', 'candidates'], 'rank_request_shape');
    check(c.rankRequest.input.query === c.plan.mem0Input.query && c.rankRequest.input.limit === 6
      && c.rankRequest.maxOutputTokens === 1024, 'frozen_rank_query_or_limits_mismatch');
    check(Array.isArray(candidates) && candidates.length === 12 && sha(c.rankRequest.system) === ORDINARY_PROMPT, 'ordinary_prompt_or_candidates_mismatch');
    for (const map of [c.map, c.actualRecallMap]) {
      check(map?.ok === true && map.value.items.length === 12 && map.value.exhausted === true
        && map.value.nextCursor === null && map.value.items.every(item => item.type === 'unfiled'), 'cold_map_mismatch');
      same([...map.value.items.map(item => item.ref.memoryId)].sort(), c.captures.map(row => row.memory.id).sort(), 'cold_map_mismatch');
    }
    same(c.recallMapOrder, c.actualRecallMap.value.items.map(item => item.ref.memoryId), 'cold_map_mismatch');
    same(candidates.map(card => card.memory.id), c.recallMapOrder, 'cold_candidate_mismatch');
    same(c.candidateReceiptOrder, candidates.map(card => card.receipts[0]?.id), 'cold_candidate_mismatch');
    for (const card of candidates) {
      const capture = c.captures.find(row => row.memory.id === card.memory.id);
      check(capture && card.namespaceIndex === 0 && card.memory.revision === capture.memory.revision
        && card.memory.currentness === 'current' && card.receiptCount === 1 && card.receipts.length === 1
        && card.interpretationStatus === 'omitted' && card.sourceSelectionCoverage === 'unassessed', 'cold_candidate_mismatch');
      for (const key of ['id', 'role', 'excerpt']) check(card.receipts[0][key] === capture.receipts[0][key], 'cold_candidate_mismatch');
    }
    const request = { ...c.rankRequest, signal: new AbortController().signal };
    const prepared = prepareCardPlanRankRequest(request, countOpenAITokens);
    const ordinary = compileOrdinaryCardSelection(request, { refs: [] }, countOpenAITokens);
    check(c.preparedCardRequestSha256 === prepared.requestSha256, 'prepared_request_mismatch');
    const ordinaryWires = wires(c.rankRequest), cardWires = wires(prepared.request, true);
    const texts = { ordinaryPrepared: JSON.stringify(c.rankRequest), ordinaryCount: ordinaryWires[0], ordinaryGeneration: ordinaryWires[1],
      cardPrepared: JSON.stringify(prepared.request), cardCount: cardWires[0], cardGeneration: cardWires[1],
      ordinaryAssemblyPrepared: JSON.stringify(ordinary.compiled.request) };
    fields(c.tokenWitnesses, Object.keys(texts), 'token_witness_mismatch');
    for (const [key, text] of Object.entries(texts)) {
      const witness = c.tokenWitnesses[key]; fields(witness, ['text', 'sha256', 'inputTokens'], 'token_witness_mismatch');
      check(witness.text === text && witness.sha256 === sha(text) && witness.inputTokens === countOpenAITokens(text)
        && integer(witness.inputTokens, 6000) && witness.inputTokens > 0, 'token_witness_mismatch');
    }
    cases.push(c);
  }
  check(memoryIds.size === 288 && receiptIds.size === 288, 'capture_count_mismatch');
  return { ...roster, cases };
}

function expectedManifest(preparation) {
  return { version: 'card-plan-first-answer-comparison-v1', preparationSha256: hash(preparation),
    sourceValueSha256: SOURCE_VALUE, sourceFileSha256: SOURCE_RAW, outputRoot: preparation.outputRoot,
    rootIdentity: preparation.rootIdentity, limits: LIMITS, cases: preparation.cases.map((c, i) => ({
      id: c.id, ordinal: i + 1, stateSha256: c.stateAfter.sha256,
      ordinaryRankRequestSha256: hash(c.rankRequest), cardPreparedRequestSha256: c.preparedCardRequestSha256,
      selectionOrder: i % 2 ? ['B', 'A'] : ['A', 'B'], answerOrder: [...ORDERS[i % 6]],
      selectionSlots: ['A', 'B'].map(arm => `${c.id}-selection-${arm}`), answerSlots: ARMS.map(arm => `${c.id}-answer-${arm}`) })) };
}
function progress(slot, c, answer) {
  check(['completed', 'failed', 'not-run'].includes(slot.status), 'slot_progress_mismatch');
  if (slot.status === 'not-run') {
    check(!slot.attempts?.length && !slot.stateChecks?.length && (!answer || slot.answer === null), 'slot_progress_mismatch'); return;
  }
  check(duration(slot.latencyMs) && Array.isArray(slot.stateChecks) && slot.stateChecks.length <= 2, 'slot_progress_mismatch');
  const phases = slot.stateChecks.map(row => row.phase);
  check(phases.length === new Set(phases).size && (!phases.length || phases[0] === 'before')
    && phases.slice(1).every(phase => ['after', 'after-failure'].includes(phase)), 'state_witness_mismatch');
  const expected = { sha256: c.stateAfter.sha256, bytes: c.stateAfter.bytes, tables: Object.keys(c.stateAfter.logical.tables).length };
  for (const row of slot.stateChecks) {
    fields(row, ['phase', 'sha256', 'bytes', 'tables'], 'state_witness_mismatch');
    literal({ sha256: row.sha256, bytes: row.bytes, tables: row.tables }, expected, 'state_witness_mismatch');
  }
  if (slot.status === 'completed') {
    same(phases, ['before', 'after'], 'state_witness_mismatch');
    check(slot.failure === null && !slot.stateFailure && !slot.cleanupFailure && !slot.failureEvidence, 'slot_progress_mismatch');
  } else check(slot.failure && typeof slot.failure.code === 'string', 'slot_progress_mismatch');
  // A genuine drift throws before pushing a mismatched after-witness. Retained
  // before-only witnesses plus stateFailure remain failure, never success credit.
  if (slot.stateFailure) check(slot.status === 'failed' && slot.stateFailure.code === 'card_plan_store_drift'
    && !phases.includes('after'), 'state_witness_mismatch');
}
// Mirror the pinned CW parser, including decoded duplicate-key rejection and
// its exact value-node/depth limits. Ordinary transport keeps JSON.parse.
function cwJson(text, code = 'cw_response_json_mismatch') {
  let at = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\r\n]/u.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
      if (text[at - 1] === '\\') at++;
    }
    fail(code);
  }
  function value(depth) {
    if (++nodes > 100000 || depth > 32) fail(code);
    whitespace(); const c = text[at];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      const object = c === '{', result = object ? Object.create(null) : [], seen = new Set();
      at++; whitespace(); if (text[at] === (object ? '}' : ']')) { at++; return result; }
      while (at < text.length) {
        whitespace(); let key;
        if (object) { if (text[at] !== '"') fail(code); key = string();
          if (seen.has(key)) fail(code); seen.add(key); whitespace(); if (text[at++] !== ':') fail(code); }
        const child = value(depth + 1); if (object) result[key] = child; else result.push(child);
        whitespace(); const end = text[at++]; if (end === (object ? '}' : ']')) return result;
        if (end !== ',') fail(code);
      }
      fail(code);
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(at));
    if (!match) fail(code); at += match[0].length; return JSON.parse(match[0]);
  }
  try { const result = value(0); whitespace(); if (at !== text.length) fail(code); return result; }
  catch { fail(code); }
}
function rankOutput(text, ordinary) {
  let body;
  if (ordinary) { try { body = JSON.parse(text); } catch { fail('rank_response_mismatch'); } }
  else body = cwJson(text);
  check(body.model === MODEL && body.status === 'completed' && body.error == null && body.incomplete_details == null
    && (ordinary ? body.object === 'response' && body.error === null && body.incomplete_details === null : true)
    && Array.isArray(body.output) && body.output.length > 0 && (ordinary || body.output.length === 1), 'rank_response_mismatch');
  let output = '';
  for (const message of body.output) {
    check(message.type === 'message' && message.role === 'assistant' && message.status === 'completed'
      && Array.isArray(message.content) && message.content.length > 0 && (ordinary || message.content.length === 1), 'rank_response_mismatch');
    for (const part of message.content) {
      check(part.type === 'output_text' && typeof part.text === 'string' && (ordinary || part.text.isWellFormed()), 'rank_response_mismatch');
      output += part.text;
    }
  }
  check(output.length > 0 && output.length <= 40000 && countOpenAITokens(output) <= 1024, 'rank_response_mismatch');
  if (!ordinary) return cwJson(output);
  try { return JSON.parse(output); } catch { fail('rank_response_mismatch'); }
}
function validateSelection(slot, c, intents, response) {
  if (slot.rankRequest !== null) literal(slot.rankRequest, c.rankRequest, 'rank_request_mismatch');
  if (slot.recallMapText !== null) check(slot.recallMapText === JSON.stringify(c.actualRecallMap), 'recall_map_text_mismatch');
  const request = { ...c.rankRequest, signal: new AbortController().signal };
  let compiled, prepared, output, expectedAssembly;
  // CW compiles before recording generation success. Replay that guarantee
  // even when a later observation failure prevented assembly retention.
  // Ordinary transport records success before its adapter parses/compiles.
  if (slot.arm === 'B' && intents[1]?.dispatched && intents[1].post?.outcome === 'succeeded') {
    prepared = prepareCardPlanRankRequest(request, countOpenAITokens);
    output = rankOutput(response(intents[1]), false);
    compiled = compileCardPlan(prepared, output);
  }
  if (slot.assembly === null) {
    check(slot.status !== 'completed' && slot.evidence === null && slot.authoritativeReads.length === 0, 'selection_evidence_mismatch'); return null;
  }
  check(slot.rankRequest && slot.recallMapText && slot.recall?.ok === true && slot.recall.value.coverage === 'complete'
    && slot.recall.value.selection.strategy === 'complete-map' && !slot.recall.value.recallTruncated
    && intents.length === 2 && intents.every(row => row.dispatched && row.post?.outcome === 'succeeded'), 'selection_evidence_mismatch');
  if (slot.arm === 'A') {
    const output = rankOutput(response(intents[1]), true); literal(slot.rankOutput, output, 'rank_output_mismatch');
    const result = compileOrdinaryCardSelection(request, output, countOpenAITokens); compiled = result.compiled;
    expectedAssembly = { origin: result.origin, ordinaryRefsSha256: result.ordinaryRefsSha256,
      syntheticAssemblyRequestSha256: result.syntheticAssemblyRequestSha256,
      actualOrdinaryRequestArtifact: intents[0].requestArtifact, proposal: compiled.proposal, refs: compiled.refs };
    check(slot.plannerRequest === null && slot.plannerOutput === null && slot.plannerFailure === null, 'ordinary_planner_mismatch');
  } else {
    literal(slot.plannerRequest, prepared.request, 'planner_request_mismatch'); literal(slot.plannerOutput, output, 'planner_output_mismatch');
    literal(slot.rankOutput, { refs: compiled.refs }, 'rank_output_mismatch');
    expectedAssembly = { origin: 'genuine-card-plan-v1', requestSha256: compiled.requestSha256,
      proposal: compiled.proposal, refs: compiled.refs };
  }
  literal(slot.assembly, expectedAssembly, 'compiled_selection_mismatch');
  same(slot.recall.value.namespaces.map(row => row.namespace), [c.namespace], 'selection_recall_mismatch');
  literal(slot.recall.value.memories, compiled.proposal.selectedCards.map(index => Object.fromEntries(
    Object.entries(c.rankRequest.input.candidates[index]).filter(([key]) => key !== 'namespaceIndex'))), 'selection_recall_mismatch');
  if (slot.evidence === null) {
    check(slot.status === 'failed' && slot.authoritativeReads.length <= compiled.refs.length, 'partial_selection_mismatch');
    slot.authoritativeReads.forEach((row, index) => {
      fields(row, ['input', 'result'], 'authoritative_read_mismatch');
      literal(row.input, { namespace: c.namespace, memoryId: compiled.refs[index].memoryId, receiptLimit: 100 }, 'authoritative_read_mismatch');
    });
    return null;
  }
  let next = 0;
  const verified = verifiedRoleEvidence(slot.recall.value, input => {
    const row = slot.authoritativeReads[next++]; check(row, 'authoritative_read_mismatch');
    fields(row, ['input', 'result'], 'authoritative_read_mismatch'); literal(row.input, input, 'authoritative_read_mismatch');
    const capture = c.captures.find(row => row.memory.id === input.memoryId);
    check(capture && row.result?.ok === true && row.result.value?.exhausted === true
      && row.result.value.nextReceiptCursor === null, 'authoritative_read_mismatch');
    literal(row.result.value.memory, capture.memory, 'authoritative_read_mismatch');
    literal(row.result.value.receipts, capture.receipts, 'authoritative_read_mismatch');
    return row.result;
  }, c.plan, c.namespace);
  check(next === slot.authoritativeReads.length, 'authoritative_read_mismatch');
  const units = slot.recall.value.memories.map(item => ({ text: JSON.stringify({ format: 'card-plan-flat-source-evidence-v1',
    memoryId: item.memory.id, revision: item.memory.revision,
    sources: item.receipts.map(source => ({ receiptId: source.id, recordedRole: source.role, text: source.excerpt })) }) }));
  const evidence = { units, refs: compiled.refs, provenance: verified.provenance, question: c.question,
    query: c.rankRequest.input.query, requestSha256: compiled.requestSha256, proposal: compiled.proposal, semanticSufficiency: 'unassessed' };
  literal(slot.evidence, evidence, 'selection_evidence_mismatch'); return evidence;
}
function groupedUnits(evidence) {
  return evidence.units.map((unit, index) => {
    if (index) return { text: unit.text };
    const card = JSON.parse(unit.text);
    card.unverifiedOrganization = { version: 'card-plan-organization-v1', status: 'unverified',
      indexMeaning: { members: 'selected-card-index', sourceMember: 'chain-member-index',
        receipt: 'receipt-index-within-card', terminal: 'chain-source-index' }, chains: evidence.proposal.chains };
    return { text: JSON.stringify(card) };
  });
}
function validateAnswer(slot, c, evidence, intents, response) {
  const expectedSelection = `${c.id}-selection-${slot.arm === 'A' ? 'A' : 'B'}`;
  check(slot.selectionSlotId === expectedSelection, 'shared_selection_mismatch');
  if (slot.packed === null) {
    check(slot.status !== 'completed' && slot.requestBody === null && slot.answer === null && slot.result === null
      && intents.length === 0, 'answer_progress_mismatch'); return;
  }
  check(evidence && slot.disposition !== 'unanswered-selection-failed', 'answer_evidence_mismatch');
  const units = slot.arm === 'C' ? groupedUnits(evidence) : evidence.units;
  const packed = packMixedAnswer({ question: c.question, units, countTokens: countOpenAITokens });
  check(packed.inputTokens <= 6000 && !packed.omittedIndices.length && !packed.duplicateIndices.length
    && packed.selectedIndices.length === units.length, 'answer_projection_mismatch');
  literal(slot.packed, packed, 'answer_projection_mismatch');
  check(slot.requestBody === JSON.stringify(packed.request), 'answer_request_mismatch');
  if (slot.result !== null || slot.answer !== null || slot.status === 'completed') {
    check(intents.length === 1 && intents[0].dispatched && intents[0].post?.outcome === 'succeeded', 'answer_response_mismatch');
    let body; try { body = JSON.parse(response(intents[0])); } catch { fail('answer_response_mismatch'); }
    const choice = body.choices?.[0], text = choice?.message?.content;
    check(body.object === 'chat.completion' && body.model === MODEL && body.choices.length === 1
      && choice.finish_reason === 'stop' && choice.message.role === 'assistant' && typeof text === 'string'
      && text.trim() && countOpenAITokens(text) <= 512 && text === slot.answer, 'answer_response_mismatch');
    literal(slot.result, { packed, answer: text }, 'answer_response_mismatch');
    if (slot.status === 'completed') check(slot.disposition === 'answered', 'answer_progress_mismatch');
  } else check(slot.status !== 'completed', 'answer_progress_mismatch');
}

function evidenceObservation(c, r, evidence, successful, source) {
  // A verified window can contain both wrapper and source body. Nullable pure-
  // source verifier coordinates do not imply the body is absent. Derive only
  // its exact body intersection from the independently regenerated frozen plan;
  // no substring search, wrapper credit or mutation of verifier provenance.
  const covered = evidence && successful ? evidence.provenance.flatMap(row => row.coordinates).flatMap(p => {
    const origin = c.plan.originMap.turns.find(turn => turn.renderedTurnId === p.renderedTurnId);
    const batch = c.plan.cairnPlan.batches.find(b => b.batchIndex === p.batchIndex);
    const window = batch?.indexedWindows.find(w => w.index === p.windowIndex);
    const provenance = c.sourceProvenance[p.originalSessionIndex];
    const session = source?.sessions[p.originalSessionIndex], message = session?.messages[p.originalTurnIndex];
    check(source?.id === c.id && origin && window && provenance && message
      && origin.originalSessionIndex === p.originalSessionIndex && origin.originalTurnIndex === p.originalTurnIndex
      && provenance.originalSessionId === session.id && provenance.eventTime === session.eventTime
      && provenance.originalMessageIndex === p.originalTurnIndex && provenance.role === message.role
      && provenance.renderedTurnId === origin.renderedTurnId && provenance.renderedSessionId === origin.originalSessionId
      && window.role === message.role, 'prepared_source_mismatch');
    if (origin.normalizationChanged) return [];
    const start = Math.max(window.start, origin.bodyStart), end = Math.min(window.end, origin.bodyEnd);
    if (start >= end) return [];
    const originalStart = origin.normalizedStart + start - origin.bodyStart;
    const originalEnd = origin.normalizedStart + end - origin.bodyStart;
    check(message.content.slice(originalStart, originalEnd) === window.content.slice(start - window.start, end - window.start),
      'prepared_source_mismatch');
    return [{ originalSessionIndex: p.originalSessionIndex, originalTurnIndex: p.originalTurnIndex,
      originalStartUtf16: originalStart, originalEndUtf16: originalEnd }];
  }) : [];
  const anchors = r.anchors.map(anchor => {
    const sessionIndex = c.sourceProvenance.findIndex(row => row.originalSessionId === anchor.sessionId);
    return { id: anchor.id, present: covered.some(p => p.originalSessionIndex === sessionIndex
      && p.originalTurnIndex === anchor.messageIndex && p.originalStartUtf16 <= anchor.start
      && p.originalEndUtf16 >= anchor.end) };
  });
  const sets = r.requiredEvidenceSets.map(set => ({ name: set.name, complete: set.anchorIds.every(id => anchors.find(a => a.id === id)?.present) }));
  return { status: successful ? 'observed' : 'unobserved', anchors, sets, completeRequired: sets.every(set => set.complete) };
}

function allowedFields(value, required, optional, code) {
  check(value && typeof value === 'object' && !Array.isArray(value) && required.every(k => Object.hasOwn(value, k))
    && Object.keys(value).every(k => required.includes(k) || optional.includes(k)), code);
}
function ledgerHeader(value) {
  const h = fields(value, ['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256'], 'history_header_shape');
  check(h.schemaVersion === 2 && typeof h.runId === 'string' && UUID.test(h.runId)
    && integer(h.limitMicroUsd, 400000000) && integer(h.requestCap) && integer(h.reservedMicroUsd, h.limitMicroUsd)
    && integer(h.requestCount, h.requestCap) && h.state === 'open' && typeof h.historySha256 === 'string'
    && HEX.test(h.historySha256) && h.limitMicroUsd - h.reservedMicroUsd >= 40000000
    && h.requestCap - h.requestCount >= 1968, 'history_affordability_mismatch'); return h;
}
const checkpoint = h => ({ requestCount: h.requestCount, reservedMicroUsd: h.reservedMicroUsd, historySha256: h.historySha256 });
function accounting(input, preparation, report, slots, get, resolve) {
  check(Array.isArray(report.attempts) && report.attempts.length <= 168 && Array.isArray(report.checkpoints)
    && report.checkpoints.length <= 120, 'accounting_shape');
  const records = [...input.entries.values()].filter(row => /^record-/u.test(row.name)).sort((a, b) => a.name.localeCompare(b.name));
  const recordById = new Map(), attempts = new Map();
  let priorSequence = 0, priorSlotPosition = -1;
  const orderedSlots = report.cases.flatMap(c => c.selectionOrder.map(a => `${c.id}-selection-${a}`)
    .concat(c.answerOrder.map(a => `${c.id}-answer-${a}`)));
  for (const entry of records) {
    const row = get(entry.name).value, sequence = Number(entry.name.slice(7, 11));
    check(row.sequence === sequence && sequence > priorSequence && ['pre', 'post'].includes(row.phase)
      && slots.has(row.slotId) && row.caseId === row.slotId.slice(0, 4)
      && row.caseOrdinal === Number(row.caseId.slice(2)), 'record_identity_mismatch');
    const common = ['slotId', 'caseId', 'caseOrdinal', 'sequence', 'phase', 'requestArtifact'];
    const card = slots.get(row.slotId).kind === 'card-plan';
    allowedFields(row, card ? [...common, 'version', 'preparedRequestSha256', 'attemptId', 'endpoint', 'kind', 'requestSha256',
      'reservedMicroUsd', 'dispatched', 'inputTokens', 'outputTokens', 'actualMicroUsd', 'outcome', 'responseSha256',
      'requestId', 'latencyMs', 'failureCode'] : [...common, 'id', 'ordinal', 'arm', 'method', 'endpoint', 'attemptId',
      'requestBytes', 'localInputTokens', 'responseBytes', 'httpStatus', 'reservedMicroUsd', 'actualMicroUsd', 'usage', 'outcome', 'failure',
      ...(row.phase === 'post' ? ['latencyMs'] : [])], card ? ['responseArtifact', 'settlementPersisted']
      : ['responseArtifact', 'providerInputTokens'], 'record_shape');
    priorSequence = sequence;
    const pair = recordById.get(row.attemptId) ?? {};
    check(!pair[row.phase] && (row.phase !== 'post' || pair.pre || report.status === 'halted'), 'record_progress_mismatch');
    pair[row.phase] = row; recordById.set(row.attemptId, pair);
  }
  let partialKnown = 0, transportLatency = 0, unknownCost = 0, missing = 0, physicalCalls = 0;
  let expectedRecordSequence = 0;
  for (const intent of report.attempts) {
    fields(intent, ['attemptId', 'slotId', 'reservedMicroUsd', 'requestArtifact', 'post', 'dispatched'], 'intent_shape');
    check(typeof intent.attemptId === 'string' && UUID.test(intent.attemptId) && !attempts.has(intent.attemptId)
      && slots.has(intent.slotId) && intent.reservedMicroUsd === 5000 && typeof intent.dispatched === 'boolean', 'reservation_mismatch');
    const position = orderedSlots.indexOf(intent.slotId); check(position >= priorSlotPosition, 'intent_order_mismatch'); priorSlotPosition = position;
    attempts.set(intent.attemptId, intent);
    const pair = recordById.get(intent.attemptId) ?? {}, slot = slots.get(intent.slotId), c = preparation.cases[Number(intent.slotId.slice(2, 4)) - 1];
    expectedRecordSequence++;
    if (pair.pre) check(pair.pre.sequence === expectedRecordSequence, 'record_owner_order_mismatch');
    else check(!intent.dispatched && report.status === 'halted', 'dispatch_without_durable_pre');
    if (intent.post !== null) {
      expectedRecordSequence++; check(pair.post?.sequence === expectedRecordSequence, 'record_owner_order_mismatch');
    }
    if (intent.dispatched) { physicalCalls++; check(pair.pre && intent.requestArtifact, 'dispatch_without_durable_pre'); }
    else check(report.status === 'halted', 'nondispatched_completed_run');
    let request = null;
    if (intent.requestArtifact) request = resolve(intent.requestArtifact, `${intent.attemptId}-request.txt`).text;
    if (pair.pre) {
      literal(pair.pre.requestArtifact, intent.requestArtifact, 'record_request_mismatch');
      check(pair.pre.slotId === intent.slotId && pair.pre.reservedMicroUsd === 5000, 'record_request_mismatch');
    }
    if (intent.post === null) { check(!pair.post && report.status === 'halted', 'missing_post_mismatch'); missing++; unknownCost++; continue; }
    check(pair.post, 'missing_post_record'); literal(pair.post, intent.post, 'post_record_mismatch');
    const post = intent.post;
    check(post.slotId === intent.slotId && post.reservedMicroUsd === 5000 && ['succeeded', 'failed', 'unknown'].includes(post.outcome)
      && duration(post.latencyMs), 'post_accounting_mismatch');
    literal(post.requestArtifact, intent.requestArtifact, 'post_request_mismatch');
    transportLatency += post.latencyMs;
    let response = null, body = null;
    const card = slot.kind === 'card-plan', counting = card ? post.kind === 'count' : post.endpoint === 'responses/input_tokens';
    if (post.responseArtifact) {
      response = resolve(post.responseArtifact, `${intent.attemptId}-response.txt`).text;
    }
    if (post.outcome === 'succeeded') {
      if (card) {
        // CW hashes original raw bytes but retains generic-redacted text. A
        // transformed successful envelope lacks original grammar/size proof;
        // deny assessment, not the actual runtime completion or its literals.
        check(response !== null && typeof post.responseSha256 === 'string' && HEX.test(post.responseSha256)
          && post.responseSha256 === sha(response), 'insufficient_original_cw_proof');
      }
      if (response !== null) {
        const bytes = Buffer.byteLength(response);
        check(bytes <= (counting ? 65536 : 262144), 'successful_response_bounds_mismatch');
        if (!card) check(integer(post.responseBytes) && post.responseBytes === Buffer.byteLength(ordinaryDecodedText(response)),
          'successful_response_bytes_mismatch');
      }
    }
    if (response !== null) {
      if (card && post.outcome === 'succeeded') body = cwJson(response);
      else try { body = JSON.parse(card ? response : ordinaryDecodedText(response)); }
      catch { /* Failed transport text is retained, not repaired. */ }
    }
    const endpoint = counting ? 'responses/input_tokens' : slot.slotId.includes('-selection-') ? 'responses' : 'chat/completions';
    if (card) {
      check(post.version === 'card-budgeted-plan-rank-v1' && post.endpoint === `https://api.openai.com/v1/${endpoint}`
        && post.preparedRequestSha256 === c.preparedCardRequestSha256 && post.dispatched === intent.dispatched
        && (request === null || post.requestSha256 === sha(request)), 'planner_record_mismatch');
      if (pair.pre) {
        check(pair.pre.phase === 'pre' && pair.pre.dispatched === false && pair.pre.outcome === null
          && pair.pre.preparedRequestSha256 === c.preparedCardRequestSha256 && (request === null || pair.pre.requestSha256 === sha(request))
          && pair.pre.kind === post.kind && pair.pre.endpoint === post.endpoint, 'planner_record_mismatch');
      }
    } else {
      check(post.id === c.id && post.ordinal === 1 && post.arm === 'baseline' && post.endpoint === endpoint
        && post.method === (slot.slotId.includes('-selection-') ? 'rank' : 'answer')
        && (request === null || post.requestBytes === Buffer.byteLength(request) && post.localInputTokens === countOpenAITokens(request)), 'ordinary_record_mismatch');
      if (pair.pre) check(pair.pre.outcome === 'unknown' && !Object.hasOwn(pair.pre, 'latencyMs')
        && pair.pre.endpoint === post.endpoint && pair.pre.localInputTokens === post.localInputTokens, 'ordinary_record_mismatch');
    }
    const ownerIntents = report.attempts.filter(row => row.slotId === intent.slotId), ownerIndex = ownerIntents.indexOf(intent);
    check(ownerIntents.length <= (slot.slotId.includes('-selection-') ? 2 : 1), 'owner_call_count_mismatch');
    const expectedRequest = slot.slotId.includes('-selection-')
      ? c.tokenWitnesses[`${card ? 'card' : 'ordinary'}${ownerIndex ? 'Generation' : 'Count'}`].text : slot.requestBody;
    check((request === null ? !intent.dispatched && report.status === 'halted'
      : request === expectedRequest && countOpenAITokens(request) <= 6000)
      && counting === (slot.slotId.includes('-selection-') && ownerIndex === 0), 'literal_request_mismatch');
    if (ownerIndex) check(ownerIntents[ownerIndex - 1].post?.outcome === 'succeeded', 'count_generation_order_mismatch');
    if (post.actualMicroUsd === null) unknownCost++;
    else {
      check(integer(post.actualMicroUsd), 'known_cost_mismatch');
      const usage = body?.usage, answer = endpoint === 'chat/completions';
      const inTokens = usage?.[answer ? 'prompt_tokens' : 'input_tokens'], outTokens = usage?.[answer ? 'completion_tokens' : 'output_tokens'];
      check(!counting && providerInteger(inTokens) && providerInteger(outTokens) && providerInteger(usage.total_tokens)
        && usage.total_tokens === inTokens + outTokens, 'usage_response_mismatch');
      const rational = (BigInt(inTokens) * 4n + BigInt(outTokens) * 16n + 9n) / 10n;
      // Preserve both pinned estimators exactly. Ordinary floating-point ceil
      // can differ by one from CW's rational arithmetic; neither is an invoice.
      const price = card ? Number(rational) : Math.ceil(inTokens * 0.4 + outTokens * 1.6);
      check(rational <= BigInt(Number.MAX_SAFE_INTEGER) && providerInteger(price) && post.actualMicroUsd === price, 'known_cost_mismatch');
      if (card) check(post.inputTokens === inTokens && post.outputTokens === outTokens, 'usage_response_mismatch');
      else literal(post.usage, { input_tokens: inTokens, output_tokens: outTokens, total_tokens: usage.total_tokens }, 'usage_response_mismatch');
      partialKnown += post.actualMicroUsd;
      if (post.outcome === 'succeeded') check(body.model === MODEL && inTokens <= 7024 && outTokens <= (answer ? 512 : 1024)
        && post.actualMicroUsd <= 5000, 'successful_usage_mismatch');
    }
    if (post.outcome === 'succeeded') {
      check(intent.dispatched && response !== null && body && (card || integer(post.httpStatus, 299) && post.httpStatus >= 200), 'successful_transport_mismatch');
      if (counting) {
        if (card) fields(body, ['object', 'input_tokens'], 'count_response_mismatch');
        check(body.object === 'response.input_tokens' && providerInteger(body.input_tokens, 7024)
          && (card ? post.inputTokens : post.providerInputTokens) === body.input_tokens
          && post.actualMicroUsd === null, 'count_response_mismatch');
      } else check(post.actualMicroUsd !== null, 'successful_usage_mismatch');
    }
  }
  check([...recordById.keys()].every(id => attempts.has(id)), 'unowned_record');
  for (const slot of slots.values()) {
    const owner = report.attempts.filter(row => row.slotId === slot.slotId);
    same(slot.attempts ?? [], owner.map(row => row.attemptId), 'slot_attempt_mismatch');
  }
  let header = null;
  if (report.originalHistory === null) {
    check(input.execution.originalHistoryHeader === null && report.attempts.length === 0 && report.checkpoints.length === 0
      && !report.ledgerReconciliation, 'unretained_history_mismatch');
  } else {
    header = ledgerHeader(input.execution.originalHistoryHeader);
    const descriptor = report.originalHistory;
    fields(descriptor, ['path', 'bytes', 'sha256', 'requestCount', 'reservedMicroUsd', 'historySha256'], 'history_descriptor_shape');
    check(descriptor.path === `${preparation.outputRoot}/original-ledger-history.json` && integer(descriptor.bytes, 134217728)
      && typeof descriptor.sha256 === 'string' && HEX.test(descriptor.sha256), 'history_descriptor_mismatch');
    literal(checkpoint(descriptor), checkpoint(header), 'history_descriptor_mismatch');
    let previous = checkpoint(header), expectedPosition = -1;
    const transitioned = [];
    for (const [i, row] of report.checkpoints.entries()) {
      literal(get(`checkpoint-${String(i + 1).padStart(4, '0')}.json`).value, row, 'checkpoint_artifact_mismatch');
      fields(row, ['sequence', 'slotId', 'before', 'after', 'deltas'], 'checkpoint_shape');
      check(row.sequence === i + 1 && slots.has(row.slotId) && orderedSlots.indexOf(row.slotId) > expectedPosition, 'checkpoint_order_mismatch');
      expectedPosition = orderedSlots.indexOf(row.slotId);
      literal(row.before, previous, 'checkpoint_transition_mismatch');
      fields(row.after, ['requestCount', 'reservedMicroUsd', 'historySha256'], 'checkpoint_shape');
      check(Array.isArray(row.deltas) && row.after.requestCount === previous.requestCount + row.deltas.length
        && row.after.reservedMicroUsd === previous.reservedMicroUsd + row.deltas.length * 5000
        && typeof row.after.historySha256 === 'string' && HEX.test(row.after.historySha256), 'checkpoint_transition_mismatch');
      same(row.deltas.map(delta => delta.attemptId), slots.get(row.slotId).attempts ?? [], 'checkpoint_owner_mismatch');
      for (const delta of row.deltas) {
        fields(delta, ['attemptId', 'channel', 'reservedMicroUsd', 'outcome', 'actualMicroUsd'], 'ledger_delta_shape');
        const intent = attempts.get(delta.attemptId), post = intent?.post;
        check(intent && delta.reservedMicroUsd === 5000 && ['succeeded', 'failed', 'unknown'].includes(delta.outcome)
          && (post ? delta.outcome === post.outcome && delta.actualMicroUsd === post.actualMicroUsd : report.status === 'halted'), 'ledger_settlement_mismatch');
        const index = slots.get(row.slotId).attempts.indexOf(delta.attemptId);
        const count = post ? post.kind === 'count' || post.endpoint === 'responses/input_tokens'
          : row.slotId.includes('-selection-') && index === 0;
        check(delta.channel === (count ? 'cairn-count' : intent.slotId.includes('-answer-') ? 'host-completion' : 'cairn-generation'), 'ledger_channel_mismatch');
        transitioned.push(delta);
      }
      previous = row.after;
    }
    if (report.ledgerReconciliation) {
      const final = report.ledgerReconciliation;
      check(final.schemaVersion === 2 && final.runId === header.runId && final.limitMicroUsd === header.limitMicroUsd
        && final.requestCap === header.requestCap && final.prefixUnchanged === true
        && Array.isArray(final.appendedAttempts) && Array.isArray(final.unobservedAttemptIds), 'final_ledger_identity_mismatch');
      check(final.requestCount === header.requestCount + final.appendedAttempts.length
        && final.reservedMicroUsd === header.reservedMicroUsd + final.appendedAttempts.length * 5000
        && final.appendedAttempts.length <= 168 && typeof final.historySha256 === 'string' && HEX.test(final.historySha256), 'final_ledger_total_mismatch');
      literal(final.appendedAttempts.slice(0, transitioned.length), transitioned, 'final_ledger_delta_mismatch');
      same(final.unobservedAttemptIds, final.appendedAttempts.filter(delta => !attempts.has(delta.attemptId)).map(delta => delta.attemptId), 'final_ledger_delta_mismatch');
      for (const delta of final.appendedAttempts) {
        check(delta.reservedMicroUsd === 5000, 'final_ledger_delta_mismatch');
        const intent = attempts.get(delta.attemptId);
        if (intent?.post) check(delta.outcome === intent.post.outcome && delta.actualMicroUsd === intent.post.actualMicroUsd, 'final_ledger_delta_mismatch');
      }
      if (final.appendedAttempts.length === transitioned.length) literal(checkpoint(final), previous, 'final_checkpoint_mismatch');
      if (report.status === 'completed') check(final.state === 'open' && !final.unobservedAttemptIds.length
        && transitioned.length === attempts.size, 'completed_ledger_mismatch');
      missing += final.unobservedAttemptIds.length; unknownCost += final.unobservedAttemptIds.length;
    } else check(report.status === 'halted' && report.ledgerReconciliationFailure, 'missing_final_ledger');
  }
  const reservedIntents = report.ledgerReconciliation?.appendedAttempts.length ?? attempts.size;
  const resource = report.resources;
  fields(resource, ['physicalCalls', 'reservedIntents', 'reservedMicroUsd', 'partialKnownMicroUsd', 'unknownCostCalls', 'missingFinalCalls',
    'selectionsCompleted', 'answersCompleted', 'selectionDenominator', 'answerDenominator', 'caseDenominator', 'latencyMs',
    'storeBytes', 'rssBytes', 'serviceCostMicroUsd', 'initialRequestCount'], 'resource_shape');
  const selections = [...slots.values()].filter(s => s.slotId.includes('-selection-'));
  const answers = [...slots.values()].filter(s => s.slotId.includes('-answer-'));
  const storeBytes = preparation.cases.reduce((n, c) => n + c.stateAfter.bytes, 0);
  check(resource.physicalCalls === physicalCalls && resource.reservedIntents === reservedIntents
    && resource.reservedMicroUsd === reservedIntents * 5000 && resource.partialKnownMicroUsd === partialKnown
    && resource.unknownCostCalls === unknownCost && resource.missingFinalCalls === missing
    && resource.selectionsCompleted === selections.filter(s => s.status === 'completed').length
    && resource.answersCompleted === answers.filter(s => s.status === 'completed').length
    && resource.selectionDenominator === 48 && resource.answerDenominator === 72 && resource.caseDenominator === 24
    && resource.storeBytes === storeBytes && resource.rssBytes === null && resource.serviceCostMicroUsd === null
    && (resource.initialRequestCount === null || integer(resource.initialRequestCount))
    && (!header || resource.initialRequestCount === header.requestCount) && duration(resource.latencyMs), 'resource_reconciliation_mismatch');
  check(transportLatency <= resource.latencyMs + 1 && [...slots.values()].filter(s => s.latencyMs !== undefined)
    .every(s => duration(s.latencyMs) && s.latencyMs <= resource.latencyMs + 1), 'latency_reconciliation_mismatch');
  const byArm = Object.fromEntries(ARMS.map(arm => {
    const owner = [...slots.values()].filter(slot => slot.arm === arm);
    return [arm, { selectionCalls: report.attempts.filter(r => r.slotId.endsWith(`selection-${arm}`) && r.dispatched).length,
      answerCalls: report.attempts.filter(r => r.slotId.endsWith(`answer-${arm}`) && r.dispatched).length,
      latencyMs: owner.reduce((n, slot) => n + (slot.latencyMs ?? 0), 0) }];
  }));
  const reasons = [];
  if (report.status !== 'completed') reasons.push('runtime-halted');
  if (!header) reasons.push('initial-accounting-unretained');
  if (missing || !report.ledgerReconciliation) reasons.push('accounting-coverage-incomplete');
  if (physicalCalls > 168 || reservedIntents > 168 || reservedIntents * 5000 > 840000) reasons.push('reservation-bound-exceeded');
  if (resource.latencyMs > LIMITS.runMs || [...attempts.values()].some(r => r.post?.latencyMs > LIMITS.physicalMs)
    || [...slots.values()].some(s => s.latencyMs > LIMITS.physicalMs)) reasons.push('recorded-deadline-exceeded');
  return { physicalCalls, reservedIntents, reservedMicroUsd: reservedIntents * 5000, partialKnownMicroUsd: partialKnown,
    unknownCostCalls: unknownCost, missingFinalCalls: missing, initialRequestCount: resource.initialRequestCount,
    initialReservedMicroUsd: header?.reservedMicroUsd ?? null, latencyMs: resource.latencyMs, transportLatencyMs: transportLatency,
    storeBytes, rssBytes: null, serviceCostMicroUsd: null, byArm,
    sharedBSelection: { calls: byArm.B.selectionCalls, latencyMs: selections.filter(s => s.arm === 'B').reduce((n, s) => n + (s.latencyMs ?? 0), 0) },
    commonPreparation: { latencyMs: null, storeBytes }, compliance: { status: reasons.length ? 'unverified' : 'satisfied',
      reasons, runtimeAttestationRequired: true } };
}

async function retained(input) {
  const used = new Set();
  const get = name => {
    const entry = input.entries.get(name); check(entry, 'missing_referenced_artifact'); used.add(name); return entry;
  };
  const root = get('preparation.json').value?.outputRoot;
  const resolve = (descriptor, name) => {
    fields(descriptor, ['path', 'bytes', 'sha256'], 'artifact_descriptor_shape');
    check(descriptor.path === `${root}/${name}`, 'artifact_path_mismatch');
    const entry = get(name);
    check(descriptor.bytes === entry.bytes && descriptor.sha256 === entry.sha256, 'artifact_descriptor_mismatch'); return entry;
  };
  const preparation = await validatePreparation(input, get, resolve), reportEntry = get('comparison-report.json'), report = reportEntry.value;
  allowedFields(report, ['version', 'manifest', 'preparationSha256', 'status', 'failure', 'cases', 'attempts', 'checkpoints',
    'resources', 'originalHistory', 'semanticSufficiency', 'liveGrant', 'representation'],
  ['ledgerReconciliation', 'ledgerReconciliationFailure'], 'report_shape');
  const manifest = expectedManifest(preparation);
  literal(report.manifest, manifest, 'manifest_identity_mismatch');
  check(report.preparationSha256 === manifest.preparationSha256 && report.version === manifest.version
    && report.representation === 'slot-artifacts-v1' && ['completed', 'halted'].includes(report.status)
    && report.semanticSufficiency === 'unassessed' && report.liveGrant === false
    && (report.status === 'completed' ? report.failure === null : report.failure && typeof report.failure.code === 'string'), 'report_identity_mismatch');
  if (input.entries.has('run-start.json')) {
    const started = get('run-start.json').value;
    fields(started, ['version', 'manifest', 'startedAt'], 'run_start_shape');
    literal(started.manifest, manifest, 'run_start_mismatch');
    check(started.version === manifest.version && typeof started.startedAt === 'string'
      && new Date(started.startedAt).toISOString() === started.startedAt, 'run_start_mismatch');
  } else check(report.status === 'halted' && report.originalHistory === null && !report.attempts.length
    && report.resources.initialRequestCount === null, 'missing_run_start');
  check(Array.isArray(report.cases) && report.cases.length === 24, 'run_roster_mismatch');
  const slots = new Map(), full = new Set();
  const selectionFields = ['slotId', 'arm', 'kind', 'status', 'failure', 'rankRequest', 'rankOutput', 'rankFailure',
    'plannerRequest', 'plannerOutput', 'plannerFailure', 'recall', 'recallMapText', 'authoritativeReads', 'evidence',
    'assembly', 'stateChecks', 'attempts'];
  const answerFields = ['slotId', 'arm', 'kind', 'selectionSlotId', 'status', 'disposition', 'requestBody', 'packed',
    'answer', 'result', 'failure', 'stateChecks', 'attempts'];
  for (const [i, c] of report.cases.entries()) {
    fields(c, ['id', 'ordinal', 'selectionOrder', 'answerOrder', 'selections', 'answers'], 'run_roster_mismatch');
    const expected = manifest.cases[i];
    check(c.id === expected.id && c.ordinal === expected.ordinal && c.selections?.length === 2 && c.answers?.length === 3, 'run_roster_mismatch');
    same(c.selectionOrder, expected.selectionOrder, 'run_roster_mismatch'); same(c.answerOrder, expected.answerOrder, 'run_roster_mismatch');
    for (const [kind, rows] of [['selection', c.selections], ['answer', c.answers]]) for (const [j, summary] of rows.entries()) {
      const answer = kind === 'answer', arm = ARMS[j], slotId = `${c.id}-${kind}-${arm}`;
      const keys = ['slotId', 'arm', 'kind', ...(answer ? ['selectionSlotId'] : []), 'status', ...(answer ? ['disposition'] : []), 'failure', 'artifact'];
      fields(summary, keys, 'slot_summary_shape');
      check(summary.slotId === slotId && summary.arm === arm && summary.kind === (answer
        ? ['ordinary', 'card-flat', 'card-grouped'][j] : ['ordinary', 'card-plan'][j]), 'slot_identity_mismatch');
      if (answer) check(summary.selectionSlotId === `${c.id}-selection-${arm === 'A' ? 'A' : 'B'}`, 'shared_selection_mismatch');
      let slot = summary;
      if (summary.artifact !== null) {
        slot = resolve(summary.artifact, `${slotId}.json`).value; full.add(slotId);
        allowedFields(slot, answer ? answerFields : selectionFields,
          ['latencyMs', 'failureEvidence', 'stateFailure', 'cleanupFailure'], 'full_slot_shape');
        for (const key of keys.filter(key => key !== 'artifact')) literal(slot[key], summary[key], 'slot_summary_mismatch');
        progress(slot, preparation.cases[i], answer);
      } else check(summary.status === 'not-run', 'missing_executed_slot');
      slots.set(slotId, slot);
    }
  }
  const ordered = report.cases.flatMap(c => c.selectionOrder.map(a => slots.get(`${c.id}-selection-${a}`))
    .concat(c.answerOrder.map(a => slots.get(`${c.id}-answer-${a}`))));
  let unretained = false, fatal = false;
  for (const slot of ordered) {
    const retainedSlot = full.has(slot.slotId);
    if (!retainedSlot) unretained = true;
    else {
      check(!unretained, 'executed_slot_order_mismatch'); check(!fatal, 'fatal_stop_mismatch');
      if (slot.status === 'failed' && (slot.stateFailure || slot.cleanupFailure
        || slot.failure.category !== 'settled-model-failure')) fatal = true;
      if (slot.status === 'not-run') {
        check(slot.slotId.includes('-answer-') && slot.disposition === 'unanswered-selection-failed'
          && slots.get(slot.selectionSlotId).status === 'failed', 'dependent_slot_mismatch');
      }
    }
  }
  if (report.status === 'completed') check(!unretained && !fatal, 'completed_progress_mismatch');
  const resources = accounting(input, preparation, report, slots, get, resolve);
  const response = intent => {
    const descriptor = intent.post?.responseArtifact; check(descriptor, 'missing_response_artifact');
    const text = resolve(descriptor, `${intent.attemptId}-response.txt`).text;
    return slots.get(intent.slotId).kind === 'card-plan' ? text : ordinaryDecodedText(text);
  };
  const mechanical = { selections: [], answers: [] }, items = { AB: [], C: [] }, answerTexts = new Map();
  for (const [i, c] of preparation.cases.entries()) {
    const rubric = input.rubric.cases[i], evidenceByArm = {}, observations = {};
    for (const arm of ['A', 'B']) {
      const slot = slots.get(`${c.id}-selection-${arm}`), intents = report.attempts.filter(r => r.slotId === slot.slotId);
      const evidence = full.has(slot.slotId) ? validateSelection(slot, c, intents, response) : null;
      evidenceByArm[arm] = evidence;
      const observation = evidenceObservation(c, rubric, evidence, slot.status === 'completed', input.sources[i]); observations[arm] = observation;
      mechanical.selections.push({ caseId: c.id, slotId: slot.slotId, arm, execution: slot.status, failure: slot.failure,
        recallSuccessful: slot.recall?.ok === true, selectionOrigin: slot.assembly?.origin ?? null,
        selectionSha256: slot.assembly ? hash(slot.assembly) : null, sharedBy: arm === 'B' ? ['B', 'C'] : ['A'], evidence: observation });
    }
    for (const arm of ARMS) {
      const slot = slots.get(`${c.id}-answer-${arm}`), evidence = evidenceByArm[arm === 'A' ? 'A' : 'B'];
      const intents = report.attempts.filter(r => r.slotId === slot.slotId);
      if (full.has(slot.slotId)) validateAnswer(slot, c, evidence, intents, response);
      const text = typeof slot.answer === 'string' ? slot.answer : null, actualAnswer = text !== null;
      let reason = null;
      if (slot.status !== 'completed' || slot.disposition !== 'answered') reason = 'runtime-not-completed-answered';
      else if (!actualAnswer) reason = 'no-actual-returned-first-answer';
      else if (!text.isWellFormed()) reason = 'ill-formed-answer-text';
      else if (text.length > 16384) reason = 'answer-text-over-judge-limit';
      const row = { caseId: c.id, slotId: slot.slotId, arm, selectionSlotId: slot.selectionSlotId,
        execution: slot.status, disposition: slot.disposition, evidence: observations[arm === 'A' ? 'A' : 'B'],
        actualAnswer, answerSerializedSha256: actualAnswer ? hash(text) : null,
        responseArtifactSha256: intents.at(-1)?.post?.responseArtifact?.sha256 ?? null,
        judgeEligibility: { status: reason === null ? 'eligible' : 'excluded', reason } };
      mechanical.answers.push(row); answerTexts.set(slot.slotId, text);
      if (reason === null) items[arm === 'C' ? 'C' : 'AB'].push({ slotId: slot.slotId, question: c.question,
        sources: input.sources[i].sessions, rubric, answer: text,
        passages: evidence.units.flatMap(unit => JSON.parse(unit.text).sources.map(({ recordedRole, text }) => ({ recordedRole, text }))) });
    }
  }
  check(used.size === input.entries.size, 'unreferenced_artifact');
  const bindings = { sourcesSha256: SOURCE_VALUE, rubricSha256: RUBRIC_VALUE,
    preparationManifestSha256: manifest.preparationSha256, runManifestSha256: hash(report.manifest),
    resultSha256: reportEntry.sha256, runtimeCommitSha: RUNTIME };
  const judgeDomains = Object.fromEntries(['AB', 'C'].map(domain => [domain,
    createSourceBundleJudgePackets({ bindings, seedHex: input.judgeSeeds[domain], items: items[domain] })]));
  const output = { version: 'card-plan-scoring-preparation-v1', status: 'ready', integrity: { status: 'valid', reason: null },
    bindings, provenance: { sourceRawSha256: SOURCE_RAW, rubricRawSha256: RUBRIC_RAW,
      artifactIndexSha256: input.execution.artifactIndexSha256, provenanceRecordSha256: input.execution.provenanceRecordSha256,
      runtimeControlHashes: { ...CONTROL_HASHES },
      externalAttestation: 'required-not-code-verified', originalHistory: report.originalHistory === null ? null
        : { descriptor: report.originalHistory, header: input.execution.originalHistoryHeader, verification: 'descriptor-header-and-new-deltas-only' } },
    denominators: { ...DENOMINATORS }, runtime: { status: report.status, failure: report.failure },
    mechanical, judgeDomains, resources, limitations: [...LIMITATIONS] };
  return { output, input, slots, answerTexts };
}

const known = field => field?.status === 'known';
const yes = field => known(field) ? field.value === 'yes' : null;
const conjunction = values => values.includes(false) ? false : values.every(v => v === true) ? true : null;
const interval = value => value === null ? [0, 1] : value ? [1, 1] : [0, 0];
function claimSummary(rows, name) {
  const fields = rows.map(row => row.judgment?.fields[name]);
  const knownQuestions = fields.filter(known).length, knownClaims = fields.reduce((n, f) => n + (known(f) ? f.value : 0), 0);
  const unobservedQuestions = rows.filter(row => row.safety.status === 'unobserved').length;
  return { knownQuestions, affectedQuestions: fields.filter(f => known(f) && f.value > 0).length,
    claims: knownQuestions === rows.length ? knownClaims : null, knownClaims,
    unknownJudgmentQuestions: rows.length - knownQuestions - unobservedQuestions, unobservedQuestions,
    coverage: knownQuestions === rows.length ? 'known' : 'incomplete' };
}
function summary(rows, severeCounts) {
  const fields = rows.map(row => row.judgment?.fields.support);
  const conditions = rows.flatMap((row, i) => row.judgment?.severe ?? Array.from({ length: severeCounts[i] }, () => null));
  const unobservedConditions = rows.reduce((n, row, i) => n + (row.safety.status === 'unobserved' ? severeCounts[i] : 0), 0);
  const knownConditions = conditions.filter(known).length;
  const anchors = rows.flatMap(row => row.evidence.anchors.map(anchor => ({ ...anchor, observed: row.evidence.status === 'observed' })));
  return { cases: rows.length, actualAnswers: rows.filter(row => row.actualAnswer).length,
    completed: rows.filter(row => row.execution === 'completed').length,
    failed: rows.filter(row => row.execution === 'failed').length, notRun: rows.filter(row => row.execution === 'not-run').length,
    correctness: { correct: rows.filter(row => yes(row.judgment?.fields.correctness) === true).length,
      incorrect: rows.filter(row => yes(row.judgment?.fields.correctness) === false).length,
      unresolved: rows.filter(row => !known(row.judgment?.fields.correctness)).length },
    support: { yes: fields.filter(f => known(f) && f.value === 'yes').length,
      no: fields.filter(f => known(f) && f.value === 'no').length,
      unknown: rows.filter(row => row.safety.status === 'observed' && !known(row.judgment?.fields.support)).length,
      unobserved: rows.filter(row => row.safety.status === 'unobserved').length },
    supportedCorrect: { true: rows.filter(row => row.supportedCorrect === true).length,
      false: rows.filter(row => row.supportedCorrect === false).length, unknown: rows.filter(row => row.supportedCorrect === null).length },
    completeRequiredCases: rows.filter(row => row.evidence.completeRequired).length,
    anchors: { present: anchors.filter(a => a.observed && a.present).length, absent: anchors.filter(a => a.observed && !a.present).length,
      unknown: anchors.filter(a => !a.observed).length, total: anchors.length },
    unsupported: claimSummary(rows, 'unsupportedClaims'), stale: claimSummary(rows, 'staleClaims'),
    severe: { knownQuestions: rows.filter(row => row.judgment && row.judgment.severe.every(known)).length,
      affectedQuestions: rows.filter(row => row.judgment?.severe.some(f => known(f) && f.value === 'yes')).length,
      knownConditions, positiveConditions: conditions.filter(f => known(f) && f.value === 'yes').length,
      unknownJudgmentConditions: conditions.length - knownConditions - unobservedConditions,
      unobservedConditions, coverage: knownConditions === conditions.length ? 'known' : 'incomplete' } };
}
function pairedMetric(cases, baselineArm, treatmentArm, key) {
  const pairs = cases.map(row => {
    const baseline = interval(row.arms[baselineArm][key]), treatment = interval(row.arms[treatmentArm][key]);
    return { caseId: row.caseId, baseline, treatment, lower: treatment[0] - baseline[1], upper: treatment[1] - baseline[0] };
  });
  const lower = pairs.reduce((n, row) => n + row.lower, 0), upper = pairs.reduce((n, row) => n + row.upper, 0);
  return { lower, upper, lowerReachesThree: lower >= 3, wins: pairs.filter(p => p.lower === 1).length,
    losses: pairs.filter(p => p.upper === -1).length, ties: pairs.filter(p => p.lower === 0 && p.upper === 0).length,
    uncertain: pairs.filter(p => p.lower !== p.upper).length, pairs };
}
function pairComparison(cases, baselineArm, treatmentArm) {
  const gains = cases.filter(row => !row.arms[baselineArm].evidence.completeRequired && row.arms[treatmentArm].evidence.completeRequired).map(r => r.caseId);
  const losses = cases.filter(row => row.arms[baselineArm].evidence.completeRequired && !row.arms[treatmentArm].evidence.completeRequired).map(r => r.caseId);
  return { diagnosticOnly: treatmentArm === 'C', rawCorrectness: pairedMetric(cases, baselineArm, treatmentArm, 'rawCorrectness'),
    supportedCorrect: pairedMetric(cases, baselineArm, treatmentArm, 'supportedCorrect'),
    completeRequiredNet: gains.length - losses.length, completeRequiredGains: gains, completeRequiredLosses: losses,
    qualified: cases.filter(row => row.answerability === 'qualified').map(row => {
      const baseline = interval(row.arms[baselineArm].supportedCorrect), treatment = interval(row.arms[treatmentArm].supportedCorrect);
      return { caseId: row.caseId, baseline, treatment, nonRegression: treatment[0] >= baseline[1] };
    }) };
}
function safetyComparison(cases, baselineArm, treatmentArm, rubric) {
  const unobservedCases = cases.filter(row => [baselineArm, treatmentArm].some(arm => row.arms[arm].safety.status === 'unobserved')).map(row => row.caseId);
  const unknownJudgmentCases = cases.filter(row => [baselineArm, treatmentArm].some(arm => {
    const r = row.arms[arm]; return r.safety.status === 'observed' && (!known(r.judgment.fields.unsupportedClaims)
      || !known(r.judgment.fields.staleClaims) || !r.judgment.severe.every(known));
  })).map(row => row.caseId);
  const allKnown = !unobservedCases.length && !unknownJudgmentCases.length;
  const claims = name => {
    const perCase = cases.map(row => {
      const a = row.arms[baselineArm].judgment?.fields[name], b = row.arms[treatmentArm].judgment?.fields[name];
      const complete = known(a) && known(b);
      return { caseId: row.caseId, baseline: known(a) ? a.value : null, treatment: known(b) ? b.value : null,
        addedQuestions: complete ? Number(b.value > 0) - Number(a.value > 0) : null,
        addedClaims: complete ? b.value - a.value : null, known: complete };
    });
    return { addedQuestions: allKnown ? perCase.reduce((n, row) => n + row.addedQuestions, 0) : null,
      addedClaims: allKnown ? perCase.reduce((n, row) => n + row.addedClaims, 0) : null, perCase };
  };
  const severe = cases.flatMap((row, i) => rubric.cases[i].severeConditions.map((_, conditionIndex) => {
    const a = row.arms[baselineArm].judgment?.severe[conditionIndex], b = row.arms[treatmentArm].judgment?.severe[conditionIndex];
    return { caseId: row.caseId, conditionIndex, baseline: known(a) ? a.value : 'unknown', treatment: known(b) ? b.value : 'unknown',
      added: known(b) && b.value === 'yes' && (!known(a) || a.value !== 'yes'), known: known(a) && known(b) };
  }));
  return { known: allKnown, unsupported: claims('unsupportedClaims'), stale: claims('staleClaims'), severe, unobservedCases, unknownJudgmentCases };
}
function assessed(context) {
  const { output, input, slots } = context;
  const judgments = Object.fromEntries(['AB', 'C'].map(domain => [domain, parseSourceBundleFirstJudgments({
    packetSet: output.judgeDomains[domain], rawFirstResponses: input.firstResponses[domain] })]));
  const bySlot = new Map([...judgments.AB.items, ...judgments.C.items].map(row => [row.slotId, row]));
  const cases = input.rubric.cases.map(rubric => ({ caseId: rubric.id, answerability: rubric.answerability,
    arms: Object.fromEntries(ARMS.map(arm => {
      const evidence = output.mechanical.answers.find(row => row.slotId === `${rubric.id}-answer-${arm}`);
      const slot = slots.get(evidence.slotId), judgment = bySlot.get(evidence.slotId) ?? null;
      const completed = evidence.execution === 'completed' && evidence.disposition === 'answered' && evidence.actualAnswer;
      const rawCorrectness = conjunction([completed, yes(judgment?.fields.correctness)]);
      const unsupported = judgment?.fields.unsupportedClaims;
      const supportedCorrect = conjunction([completed, evidence.evidence.completeRequired, yes(judgment?.fields.correctness),
        yes(judgment?.fields.support), known(unsupported) ? unsupported.value === 0 : null]);
      const { caseId: _, arm: __, ...rest } = evidence;
      return [arm, { ...rest, failure: slot.failure, judgment, rawCorrectness, supportedCorrect,
        safety: { status: evidence.judgeEligibility.status === 'eligible' ? 'observed' : 'unobserved' } }];
    })) }));
  const summaries = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(['all', 'answerable', 'qualified'].map(group => {
    const selected = cases.filter(c => group === 'all' || c.answerability === group);
    return [group, summary(selected.map(c => c.arms[arm]), selected.map(c => input.rubric.cases.find(r => r.id === c.caseId).severeConditions.length))];
  }))]));
  const paired = { BminusA: pairComparison(cases, 'A', 'B'), CminusB: pairComparison(cases, 'B', 'C') };
  const harms = { AB: safetyComparison(cases, 'A', 'B', input.rubric), CB: safetyComparison(cases, 'B', 'C', input.rubric), D12Cleared: false };
  const reasons = [];
  if (summaries.B.all.completed < 23) reasons.push('b-completion-below-23');
  if (paired.BminusA.supportedCorrect.lower < 3) reasons.push('supported-correct-lower-gain-below-three');
  if (paired.BminusA.completeRequiredNet < 1) reasons.push('net-complete-required-gain-below-one');
  if (paired.BminusA.qualified.some(row => !row.nonRegression)) reasons.push('qualified-supported-correct-regression');
  if (!harms.AB.known) reasons.push('ab-safety-unknown');
  if (harms.AB.severe.some(row => row.added)) reasons.push('added-severe-condition');
  for (const name of ['unsupported', 'stale']) if (harms.AB[name].addedQuestions > 0 || harms.AB[name].addedClaims > 0)
    reasons.push(`${name}-harm-increased`);
  if (output.resources.compliance.status !== 'satisfied') reasons.push('resource-compliance-unverified');
  if (output.runtime.status !== 'completed') reasons.push('runtime-halted');
  const { judgeDomains: _, ...base } = output;
  return freeze({ ...base, version: 'card-plan-scoring-report-v1', status: 'assessed', cases, judgments, summaries, paired, harms,
    gate: { mechanismPromising: !reasons.length, reasons, Stage2Passed: false, productDefaultAdvancement: false } });
}

/** Pure retained-data preparation. Fresh validators are not runtime capabilities. */
export async function prepareCardPlanScoring(options) {
  try { return freeze((await retained(inputOf(options, false))).output); }
  catch (error) { return denied(false, denialReasons.get(error) ?? 'derived_validation_failure'); }
}
/** Assess only the literal first responses, after all retained-data validation. */
export async function scoreCardPlanComparison(options) {
  try { return assessed(await retained(inputOf(options, true))); }
  catch (error) { return denied(true, denialReasons.get(error) ?? 'derived_validation_failure'); }
}

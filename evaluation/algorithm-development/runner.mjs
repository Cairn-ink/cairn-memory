import { createHash } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../../core/contract.mjs';
import { createFullLabelSelectionModel } from '../architecture/full-label-model.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { verifiedEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { freezeObservation } from './transport.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const frozen = value => !value || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(frozen);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unwrap = result => { if (!result.ok) fail(result.error.code); return result.value; };
const reason = error => error.code ?? (error.name === 'AbortError' ? 'model_timeout' : 'algorithm_failure');
function emit(callback, observation) {
  try { if (callback(freezeObservation(structuredClone(observation))) !== undefined) fail('algorithm_persistence_failure'); }
  catch { fail('algorithm_persistence_failure'); }
}
// Date is source metadata. The existing renderer uses a floating minute label;
// ISO source instants are consistently represented in UTC, never by rewriting
// the core's ingestion-time createdAt fields.
function sourceDate(value, endOfDay = false) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T${endOfDay ? '23:59' : '00:00'}:00Z` : value);
  if (!Number.isFinite(date.valueOf())) fail('invalid_source_date');
  const iso = date.toISOString(), day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  return `${iso.slice(0, 10).replaceAll('-', '/')} (${day}) ${iso.slice(11, 16)}`;
}
function prepare(row) {
  const caseId = `lme-case-${hash(row.id)}`;
  const namespace = { ownerId: 'algorithm-development-synthetic', scope: 'project', projectId: caseId };
  const history = { question_id: caseId, sessions: row.sessions.map((session, index) => ({
    session_index: index, session_id: `lme-session-${hash([row.id, session.id])}`,
    date: sourceDate(session.eventTime), turns: session.messages.map((message, turn) => ({
      turn_id: `lme-turn-${hash([row.id, session.id, turn])}`, role: message.role, content: message.content })) })) };
  return { namespace, plan: prepareMixedSourceCase({ history, namespace,
    question: { question_id: caseId, text: row.question.text, date: sourceDate(row.question.date, true) } }, 'indexed-evidence-v1') };
}
function logicalState(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    return hash(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
      .all().map(row => JSON.stringify(row)).sort()]));
  } finally { db.close(); }
}
const candidateIdentity = input => input.maps?.map(map => ({ namespaceIndex: map.namespaceIndex,
  items: map.items.map(({ label, ...item }) => item), exhausted: map.exhausted })) ?? null;
function tracedModel(model, trace) {
  const result = { contextWindow: model.contextWindow, countTokens: model.countTokens };
  for (const method of ['extract', 'classify', 'select', 'rank']) result[method] = async request => {
    const row = { method, system: request.system, input: structuredClone(request.input),
      maxOutputTokens: request.maxOutputTokens, inputBytes: Buffer.byteLength(JSON.stringify(request.input)),
      localRequestTokens: countOpenAITokens(JSON.stringify({ system: request.system, input: request.input,
        maxOutputTokens: request.maxOutputTokens })), output: null, failure: null };
    if (method === 'select') {
      row.candidateIdentity = candidateIdentity(request.input);
      row.labelBytes = request.input.maps.reduce((n, map) => n + map.items.reduce(
        (sum, item) => sum + Buffer.byteLength(item.label ?? ''), 0), 0);
    }
    trace.push(row);
    try { const output = await model[method](request); row.output = structuredClone(output); return output; }
    catch (error) { row.failure = reason(error); throw error; }
  };
  return result;
}
const emptyArm = (name, failure = 'not_run') => ({ name, status: 'unresolved', failure,
  failureStage: 'not_run', coreInputs: [], modelCalls: [], recalled: null, evidence: null,
  packed: null, answer: null, records: [], latencyMs: null, stateBefore: null, stateAfter: null });

/** Caller owns retained databases and formal observations. No rubric/gold import. */
export async function runAlgorithmDevelopmentComparison({ cases, transport, outputDirectory,
  onCase = () => {} } = {}) {
  if (!Array.isArray(cases) || cases.length !== 24 || !frozen(cases)
    || new Set(cases.map(row => row.id)).size !== 24 || cases.some(row => !/^D(?:0[1-9]|1[0-9]|2[0-4])$/u.test(row.id))
    || typeof onCase !== 'function'
    || typeof outputDirectory !== 'string' || !statSync(outputDirectory).isDirectory()) fail('invalid_algorithm_cases');
  const began = performance.now(), observations = []; let fatal = null;
  for (const [index, source] of cases.entries()) {
    const ordinal = index + 1, order = index % 2 ? ['full', 'baseline'] : ['baseline', 'full'];
    const observation = { id: source.id, family: source.family, ordinal, order,
      source: structuredClone(source), capture: { status: 'unresolved', failure: null,
        inputs: [], modelCalls: [], outcomes: [], receipts: [], stateSha256: null, databaseBytes: null },
      arms: Object.fromEntries(order.map(name => [name, emptyArm(name)])), navigation: null, records: [] };
    if (fatal) {
      observation.capture.failure = fatal;
      for (const arm of Object.values(observation.arms)) arm.failure = fatal;
      observations.push(observation); emit(onCase, observation); continue;
    }
    const beforeRecords = transport.records().length, caseBegan = performance.now();
    let core, path, namespace, plan;
    try {
      transport.assertHealthy(); transport.beginCase({ id: source.id, ordinal });
      ({ namespace, plan } = prepare(source));
      const folder = join(outputDirectory, `${String(ordinal).padStart(2, '0')}-${source.id}`);
      mkdirSync(folder); path = join(folder, 'memory.sqlite');
      core = openMemoryCore({ path, model: tracedModel(transport.model, observation.capture.modelCalls),
        captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1' });
      const memoryIds = new Set();
      for (const batch of plan.cairnPlan.batches) {
        observation.capture.inputs.push(structuredClone(batch.captureInput));
        const outcome = await core.capture(batch.captureInput); observation.capture.outcomes.push(outcome);
        if (outcome.ok) for (const memory of outcome.value.admission?.memories ?? []) memoryIds.add(memory.id);
        if (!outcome.ok || outcome.value.classification?.status === 'failed') {
          observation.capture.failure = outcome.error?.code ?? outcome.value.classification.error.code;
          break;
        }
      }
      for (const memoryId of memoryIds) observation.capture.receipts.push(unwrap(core.get({ namespace, memoryId, receiptLimit: 100 })));
      core.close(); core = null;
      observation.capture.stateSha256 = logicalState(path); observation.capture.databaseBytes = statSync(path).size;
      if (observation.capture.failure) {
        for (const arm of Object.values(observation.arms)) { arm.failure = observation.capture.failure; arm.failureStage = 'capture'; }
      } else {
        observation.capture.status = 'completed';
        for (const name of order) {
          const arm = observation.arms[name], armBegan = performance.now(), armRecordStart = transport.records().length;
          let stage = 'recall';
          try {
            transport.assertHealthy(); transport.beginArm(name);
            arm.stateBefore = logicalState(path);
            if (arm.stateBefore !== observation.capture.stateSha256) fail('captured_state_changed');
            const baseModel = tracedModel(transport.model, arm.modelCalls);
            const selection = name === 'full' ? createFullLabelSelectionModel(baseModel,
              { readSet: [namespace], getMemory: input => core.get(input) }) : baseModel;
            core = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1',
              model: { ...selection, select(request) {
                arm.coreInputs.push({ system: request.system, input: structuredClone(request.input), maxOutputTokens: request.maxOutputTokens });
                return selection.select(request);
              } } });
            arm.recalled = unwrap(await core.recall({ readSet: [namespace], query: plan.mem0Input.query,
              limit: 6, contextMode: 'source-evidence' }));
            stage = 'packing';
            arm.evidence = verifiedEvidence(arm.recalled, input => core.get(input), plan, namespace);
            arm.packed = packMixedAnswer({ question: source.question, units: arm.evidence.units, countTokens: countOpenAITokens });
            stage = 'answer';
            const answer = await transport.answer({ question: source.question, units: arm.evidence.units });
            arm.answer = answer.answer; arm.status = 'completed'; arm.failure = null; arm.failureStage = null;
          } catch (error) { arm.failure = reason(error); arm.failureStage = stage; }
          finally {
            core?.close(); core = null;
            arm.stateAfter = logicalState(path); arm.databaseBytes = statSync(path).size;
            if (arm.stateAfter !== observation.capture.stateSha256) { arm.status = 'unresolved'; arm.failure = 'captured_state_changed'; fatal = arm.failure; }
            arm.records = transport.records().slice(armRecordStart); arm.latencyMs = performance.now() - armBegan;
          }
          try { transport.assertHealthy(); } catch (error) { fatal = reason(error); }
          if (fatal) break;
        }
        const baseline = observation.arms.baseline, full = observation.arms.full;
        const left = baseline.modelCalls.filter(row => row.method === 'select'), right = full.modelCalls.filter(row => row.method === 'select');
        observation.navigation = { firstCandidateIdentityEqual: left.length && right.length
          ? isDeepStrictEqual(left[0].candidateIdentity, right[0].candidateIdentity) : null,
          coreInputSequenceEqual: isDeepStrictEqual(baseline.coreInputs, full.coreInputs),
          candidateSequenceEqual: isDeepStrictEqual(left.map(row => row.candidateIdentity), right.map(row => row.candidateIdentity)),
          rankInputSequenceEqual: isDeepStrictEqual(baseline.modelCalls.filter(row => row.method === 'rank').map(row => row.input),
            full.modelCalls.filter(row => row.method === 'rank').map(row => row.input)) };
      }
    } catch (error) {
      observation.capture.failure ??= reason(error);
      for (const arm of Object.values(observation.arms)) if (arm.failureStage === 'not_run') arm.failure = observation.capture.failure;
    } finally {
      core?.close();
      observation.capture.latencyMs ??= performance.now() - caseBegan - Object.values(observation.arms).reduce((n, arm) => n + (arm.latencyMs ?? 0), 0);
      observation.records = transport.records().slice(beforeRecords); observation.latencyMs = performance.now() - caseBegan;
    }
    try { transport.assertHealthy(); transport.endCase(); } catch (error) { fatal ??= reason(error); }
    observations.push(observation); emit(onCase, observation);
  }
  let finalBudget = null;
  if (!fatal) {
    try { const state = transport.state(); finalBudget = Object.fromEntries(['schemaVersion', 'runId',
      'limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256'].map(key => [key, state[key]])); }
    catch (error) { fatal = reason(error); }
  }
  return freezeObservation({ schemaVersion: 'algorithm-development-comparison-v1', model: DEFAULT_MODEL,
    profile: { captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1',
      contextMode: 'source-evidence', selectionMode: 'default-select', limit: 6, coreLogicalCallMs: 30_000 },
    denominator: 24, attemptsPerArm: 24, fatal, observations, records: transport.records(),
    finalBudget, latencyMs: performance.now() - began });
}

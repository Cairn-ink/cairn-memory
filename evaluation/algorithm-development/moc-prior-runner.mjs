import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../../core/contract.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { verifiedRoleEvidence } from '../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../longmemeval/mixed-answer.mjs';
import { MOC_NATURAL_VERSION, mocNaturalRoster, mocNaturalOrders, mocNaturalPolicies,
  mocNaturalLimits, freezeNatural, naturalHash, naturalFail, naturalErrorCode, naturalFatalCode,
  prepareMocNaturalCases } from './moc-prior-profile.mjs';

const unwrap = result => { if (!result.ok) naturalFail(naturalErrorCode(result.error)); return result.value; };
export function mocNaturalLogicalState(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    return naturalHash(JSON.stringify(tables.map(({ name }) => [name,
      db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort()])));
  } finally { db.close(); }
}
function tracedPorts(model, trace) {
  const ports = { contextWindow: model.contextWindow, countTokens: model.countTokens };
  for (const method of ['extract', 'classify', 'select', 'rank']) ports[method] = async request => {
    const row = { method, system: request.system, input: structuredClone(request.input),
      maxOutputTokens: request.maxOutputTokens, output: null, failure: null };
    trace.push(row);
    try { const output = await model[method](request); row.output = structuredClone(output); return output; }
    catch (error) { row.failure = naturalErrorCode(error); throw error; }
  };
  return ports;
}
const emptyArm = name => ({ name, policy: mocNaturalPolicies[name], status: 'unresolved',
  failure: 'natural_slot_not_run', failureStage: 'not_run', recallInput: null, modelCalls: [],
  recalled: null, verifiedReads: [], evidence: null, packed: null, answer: null, records: [],
  stateBefore: null, stateAfterReopen: null, stateAfter: null, databaseBytes: null, latencyMs: null });
export function emptyMocNaturalReport(cases, failure = 'natural_slot_not_run') {
  return { schemaVersion: `${MOC_NATURAL_VERSION}-comparison`, model: DEFAULT_MODEL,
    armPolicies: { ...mocNaturalPolicies }, evidenceFormat: 'source-role-evidence-v1',
    profile: { captureSourcePolicy: 'indexed-evidence-v1', contextMode: 'source-evidence',
      selectionMode: 'default-select', limit: 6, coreLogicalCallMs: 30_000 },
    denominator: 4, attemptsPerArm: 4, outcomesDenominator: 8, allFirstAnswersSettled: false,
    productPromotion: false, stage3: false, limits: { ...mocNaturalLimits }, fatal: null,
    firstAnswerSlots: { planned: 8, executed: 0, completed: 0, unresolved: 8 }, initialBudget: null,
    observations: cases.map((source, index) => ({ id: source.id, family: source.family, ordinal: index + 1,
      order: [...mocNaturalOrders[index % 2]], source: structuredClone(source), databaseFile: null,
      capture: { status: 'unresolved', failure, inputs: [], outcomes: [], modelCalls: [], receipts: [],
        admissions: 0, stateBefore: null, stateAfter: null, databaseBytes: null, records: [], latencyMs: null },
      arms: Object.fromEntries(mocNaturalOrders[index % 2].map(name => [name, { ...emptyArm(name), failure }])),
      records: [], latencyMs: null })), records: [], finalBudget: null, resources: null, latencyMs: null };
}
export function mocNaturalResources(report) {
  const records = report.records;
  const describe = rows => ({ httpRequests: rows.length,
    reservedMicroUsd: rows.reduce((n, row) => n + row.reservedMicroUsd, 0),
    knownProfilePriceMicroUsd: rows.reduce((n, row) => n + (row.actualMicroUsd ?? 0), 0),
    inputTokens: rows.reduce((n, row) => n + (row.usage?.input_tokens ?? 0), 0),
    outputTokens: rows.reduce((n, row) => n + (row.usage?.output_tokens ?? 0), 0),
    unknownUsageRequests: rows.filter(row => row.endpoint !== 'responses/input_tokens' && row.usage === null).length });
  return { costInterpretation: 'common-capture-once-paired-execution-not-standalone-arm-bill',
    priceInterpretation: 'known-model-profile-estimate-not-invoice', ...describe(records),
    capture: { ...describe(records.filter(row => row.arm === 'capture')),
      logicalCalls: report.observations.reduce((n, row) => n + row.capture.modelCalls.length, 0) },
    arms: Object.fromEntries(['baseline', 'prior'].map(name => [name, {
      ...describe(records.filter(row => row.arm === name)),
      logicalCalls: report.observations.reduce((n, row) => n + row.arms[name].modelCalls.length, 0) }])),
    databaseBytes: report.observations.reduce((n, row) => n + (row.capture.databaseBytes ?? 0), 0) };
}
/** One natural capture, two independent ordinary cold recalls. No evaluator imports. */
export async function runMocNaturalComparison({ cases, transport, outputDirectory, onCase = () => {} } = {}) {
  const prepared = await prepareMocNaturalCases(cases);
  if (typeof onCase !== 'function' || typeof outputDirectory !== 'string'
    || !statSync(outputDirectory).isDirectory()) naturalFail('natural_output_unsafe');
  const sources = freezeNatural(structuredClone(cases)), report = emptyMocNaturalReport(sources);
  const began = performance.now(); let fatal = null, persistenceFailed = false;
  for (const [index, observation] of report.observations.entries()) {
    const beforeRecords = transport.records().length, caseBegan = performance.now();
    let core, path;
    if (fatal) {
      observation.capture.failure = fatal;
      for (const arm of Object.values(observation.arms)) arm.failure = fatal;
    } else try {
      transport.assertHealthy();
      if (index === 0) {
        const state = transport.state(); report.initialBudget = Object.fromEntries(['schemaVersion', 'runId', 'limitMicroUsd',
          'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256'].map(key => [key, state[key]]));
      }
      transport.beginCase({ id: observation.id, ordinal: index + 1 });
      const { namespace, plan } = prepared[index], source = sources[index];
      observation.databaseFile = `${String(index + 1).padStart(2, '0')}-${source.id}/memory.sqlite`;
      const folder = join(outputDirectory, `${String(index + 1).padStart(2, '0')}-${source.id}`);
      try {
        mkdirSync(folder, { mode: 0o700 }); path = join(folder, 'memory.sqlite');
        core = openMemoryCore({ path, model: tracedPorts(transport.model, observation.capture.modelCalls),
          captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: mocNaturalPolicies.baseline });
      } catch { naturalFail('natural_persistence_failure'); }
      observation.capture.stateBefore = mocNaturalLogicalState(path);
      const memoryIds = new Set();
      for (const batch of plan.cairnPlan.batches) {
        observation.capture.inputs.push(structuredClone(batch.captureInput));
        const outcome = await core.capture(batch.captureInput); observation.capture.outcomes.push(structuredClone(outcome));
        const memories = outcome.ok ? outcome.value.admission?.memories ?? [] : [];
        if (memories.length > 5) naturalFail('natural_admission_cap');
        for (const memory of memories) {
          memoryIds.add(memory.id);
          observation.capture.admissions = memoryIds.size;
          observation.capture.receipts.push(structuredClone(unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 100 }))));
        }
        if (memoryIds.size > 95) naturalFail('natural_admission_cap');
        if (!outcome.ok || outcome.value.classification?.status === 'failed') {
          observation.capture.failure = naturalErrorCode(outcome.ok ? outcome.value.classification.error : outcome.error,
            'natural_capture_failure'); break;
        }
        transport.assertHealthy();
      }
      observation.capture.admissions = memoryIds.size;
      observation.capture.receipts = [...memoryIds].map(memoryId =>
        structuredClone(unwrap(core.get({ namespace, memoryId, receiptLimit: 100 }))));
      core.close(); core = null;
      observation.capture.stateAfter = mocNaturalLogicalState(path);
      observation.capture.databaseBytes = statSync(path).size;
      observation.capture.records = transport.records().slice(beforeRecords);
      observation.capture.latencyMs = performance.now() - caseBegan;
      if (observation.capture.failure !== 'natural_slot_not_run' && observation.capture.failure !== null) {
        if (naturalFatalCode(observation.capture.failure)) fatal = observation.capture.failure;
        for (const arm of Object.values(observation.arms)) { arm.failure = observation.capture.failure; arm.failureStage = 'capture'; }
      } else {
        if (observation.capture.inputs.length !== 19 || observation.capture.outcomes.length !== 19) naturalFail('natural_batch_count');
        observation.capture.status = 'completed'; observation.capture.failure = null;
        for (const name of observation.order) {
          const arm = observation.arms[name], armBegan = performance.now(), recordStart = transport.records().length;
          let stage = 'recall';
          try {
            transport.assertHealthy(); transport.beginArm(name);
            arm.stateBefore = mocNaturalLogicalState(path);
            if (arm.stateBefore !== observation.capture.stateAfter) naturalFail('natural_state_changed');
            try { core = openMemoryCore({ path, model: tracedPorts(transport.model, arm.modelCalls), sourceCandidatePolicy: mocNaturalPolicies[name] }); }
            catch { naturalFail('natural_persistence_failure'); }
            arm.stateAfterReopen = mocNaturalLogicalState(path);
            if (arm.stateAfterReopen !== arm.stateBefore) naturalFail('natural_state_changed');
            arm.recallInput = { readSet: [namespace], query: plan.mem0Input.query, limit: 6, contextMode: 'source-evidence' };
            arm.recalled = unwrap(await core.recall(arm.recallInput));
            stage = 'packing';
            arm.evidence = verifiedRoleEvidence(arm.recalled, input => {
              const response = core.get(input); arm.verifiedReads.push({ input: structuredClone(input), response: structuredClone(response) });
              return response;
            }, plan, namespace);
            arm.packed = packMixedAnswer({ question: source.question, units: arm.evidence.units, countTokens: countOpenAITokens });
            stage = 'answer';
            const answer = await transport.answer({ question: source.question, units: arm.evidence.units });
            const dispatched = transport.records().slice(recordStart).filter(row => row.method === 'answer');
            if (!isDeepStrictEqual(answer.packed, arm.packed) || dispatched.length !== 1
              || dispatched[0].requestBody !== JSON.stringify(arm.packed.request)) naturalFail('natural_trace_failure');
            arm.answer = answer.answer; arm.status = 'completed'; arm.failure = null; arm.failureStage = null;
          } catch (error) {
            arm.failure = naturalErrorCode(error, stage === 'answer' ? 'natural_answer_failure' : 'natural_recall_failure');
            arm.failureStage = stage; if (naturalFatalCode(arm.failure)) fatal ??= arm.failure;
          } finally {
            try { core?.close(); core = null; arm.stateAfter = mocNaturalLogicalState(path); arm.databaseBytes = statSync(path).size;
              if (arm.stateAfter !== observation.capture.stateAfter) naturalFail('natural_state_changed');
            } catch { arm.status = 'unresolved'; arm.failure = 'natural_state_changed'; fatal ??= arm.failure; }
            arm.records = transport.records().slice(recordStart); arm.latencyMs = performance.now() - armBegan;
          }
          try { transport.assertHealthy(); } catch (error) { fatal ??= naturalErrorCode(error); }
          if (fatal) break;
        }
      }
    } catch (error) {
      const code = naturalErrorCode(error, 'natural_persistence_failure'); observation.capture.failure = code;
      if (naturalFatalCode(code)) fatal ??= code;
      for (const arm of Object.values(observation.arms)) if (arm.failureStage === 'not_run') arm.failure = code;
    } finally {
      try { core?.close(); } catch { fatal ??= 'natural_state_changed'; }
      observation.capture.latencyMs ??= performance.now() - caseBegan;
      observation.records = transport.records().slice(beforeRecords); observation.latencyMs = performance.now() - caseBegan;
      if (!fatal) try { transport.assertHealthy(); transport.endCase(); } catch (error) { fatal = naturalErrorCode(error); }
    }
    if (!persistenceFailed) try {
      if (onCase(freezeNatural(structuredClone(observation))) !== undefined) naturalFail('natural_persistence_failure');
    } catch { fatal ??= 'natural_persistence_failure'; persistenceFailed = true; }
  }
  report.allFirstAnswersSettled = true; report.fatal = fatal; report.records = transport.records();
  report.firstAnswerSlots.executed = report.records.filter(row => row.method === 'answer').length;
  report.firstAnswerSlots.completed = report.observations.reduce((n, row) => n + Object.values(row.arms).filter(arm => arm.status === 'completed').length, 0);
  report.firstAnswerSlots.unresolved = 8 - report.firstAnswerSlots.completed;
  if (!fatal) try {
    const state = transport.state(); report.finalBudget = Object.fromEntries(['schemaVersion', 'runId', 'limitMicroUsd',
      'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256'].map(key => [key, state[key]]));
  } catch (error) { report.fatal = naturalErrorCode(error); }
  report.latencyMs = performance.now() - began; report.resources = mocNaturalResources(report);
  return freezeNatural(report);
}

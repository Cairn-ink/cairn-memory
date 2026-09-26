import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { lstatSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

import { countOpenAITokens, createOpenAIModel } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, modelProfile } from '../../adapters/openai/profiles.mjs';
import { openMemoryCore } from '../../core/contract.mjs';
import { checkedMem0NativeArtifact } from '../experiment-budget/mem0-native-artifact.mjs';
import { checkedMem0NativeConfiguration, runMem0NativeCase } from '../experiment-budget/mem0-native-gateway.mjs';
import { mem0WireProfile } from '../experiment-budget/mem0-wire.mjs';
import { benchmarkStagePolicy } from '../live/public-pilot.mjs';
import { experimentPolicy } from '../live/session.mjs';
import { ingestIndexedWindowLongMemEvalCase } from './ingestion.mjs';
import { verifiedEvidence } from './mixed-evidence.mjs';
import { verifyMixedCapturePlan } from './mixed-plan.mjs';
import { MIXED_ANSWER_CONTEXT_WINDOW, MIXED_ANSWER_MODEL, MIXED_ANSWER_OUTPUT_TOKENS,
  MIXED_ANSWER_TIMEOUT_MS, packMixedAnswer } from './mixed-answer.mjs';
import { prepareMixedSourceCase, mixedSourcePolicy } from './mixed-source.mjs';
import { OFFICIAL_JUDGE_MODEL, OFFICIAL_QUESTION_TYPES,
  OFFICIAL_UPSTREAM_COMMIT } from './official-scoring.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from './public-comparison.mjs';
import { MixedComparisonError, canonical, dense, exact, fail, freeze, hash,
  reportSnapshot, sourceSnapshot, wellFormed } from './mixed-validation.mjs';
import { authenticateLocalUnknown, completionOnce, trackedTransport,
  unknownCurrentAttempt } from './mixed-transport.mjs';

const requireFromAdapter = createRequire(new URL('../../adapters/openai/package.json', import.meta.url));
const nativeEncoder = requireFromAdapter('tiktoken').get_encoding('cl100k_base');
const PREPARED = new WeakMap();
const USED = new WeakSet();
const CASE_ID = /^lme-case-[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ARM_NAMES = ['cairn', 'mem0'];
const PREPARATION_VERSION = 'cairn-lme-mixed-preparation-v1';
export const MIXED_GENERATION_VERSION = 'cairn-lme-mixed-generation-v1';
const CONTEXT_DOMAIN = 'cairn.lme.mixed.context.v1';
const ANSWER_DOMAIN = 'cairn.lme.mixed.answer.v1';
const SCORER_DOMAIN = 'cairn.lme.mixed.scorer.v1';
const CAIRN_ADAPTER_DOMAIN = 'cairn.lme.mixed.cairn-adapter.v1';
const CASE_DOMAIN = 'cairn.lme.mixed.case-protocol.v1';
const MANIFEST_DOMAIN = 'cairn.lme.mixed.manifest.v1';
const ROSTER_DOMAIN = 'cairn.lme.mixed-source-pair.roster.v1';
const SCOPE_DOMAIN = 'cairn.lme.mixed-source-pair.scope.v1';
const LOCAL_REASONS = new Set(['planner_mismatch', 'ingestion_incomplete', 'recall_failed',
  'invalid_recall_provenance', 'provenance_limit_exceeded', 'invalid_native_result',
  'invalid_mixed_completion', 'invalid_mixed_usage', 'mixed_usage_unsettled',
  'question_context_exceeded', 'answer_token_count_unavailable', 'invalid_answer_units']);
const reasonOf = (error, fallback) => error instanceof MixedComparisonError
  && LOCAL_REASONS.has(error.code) ? error.code : fallback;
const arm = name => ({ name, status: 'blocked', reason: 'not_started', answer: null,
  scope: null, diagnostics: {} });
const scopeOf = guard => {
  const value = guard.caseScopeSnapshot();
  return value ? { ordinal: value.ordinal, status: value.status, reason: value.reason } : null;
};

function ownOptions(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some(key => !ownKeys.includes(key))) fail(code);
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    result[key] = descriptor.value;
  }
  return result;
}

function opaqueDigest(value, key, code) {
  if (!value || typeof value !== 'object') fail(code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string' || !SHA256.test(descriptor.value)) fail(code);
  return descriptor.value;
}

function sourceIdentity(row, seen) {
  exact(row, ['history', 'question', 'namespace'], 'invalid_source_cases');
  const { history, question, namespace } = row;
  exact(history, ['question_id', 'sessions'], 'invalid_source_cases');
  exact(question, ['question_id', 'text', 'date'], 'invalid_source_cases');
  exact(namespace, ['ownerId', 'scope', 'projectId'], 'invalid_source_cases');
  const id = question.question_id;
  if (!CASE_ID.test(id) || history.question_id !== id || namespace.projectId !== id
    || namespace.scope !== 'project' || !wellFormed(namespace.ownerId)
    || !namespace.ownerId.trim() || !wellFormed(question.text) || !question.text.trim()
    || Buffer.byteLength(question.text, 'utf8') > 16 * 1024
    || !wellFormed(question.date) || !question.date.trim() || seen.has(id)) {
    fail('invalid_source_cases');
  }
  seen.add(id);
  return id;
}

function staticNativeFit(input) {
  for (const batch of input.batches) {
    // Installed Mem0 2.2.0 parse_messages uses exactly this role/content layout.
    const joined = batch.map(message => `${message.role}: ${message.content}\n`).join('');
    let tokens;
    try { tokens = nativeEncoder.encode(joined, [], []).length; }
    catch { return false; }
    if (tokens > mem0WireProfile().embedding.maxItemInputTokens) return false;
  }
  return true;
}

function protocolManifest({ nativeArtifact, nativeConfiguration, cairnRuntimeArtifactSha256 }) {
  if (typeof cairnRuntimeArtifactSha256 !== 'string' || !SHA256.test(cairnRuntimeArtifactSha256)) {
    fail('invalid_cairn_artifact_descriptor');
  }
  const sourceTreeSha256 = opaqueDigest(nativeArtifact, 'sourceTreeSha256', 'invalid_native_descriptor');
  const dependencyLockSha256 = opaqueDigest(nativeArtifact, 'dependencyLockSha256', 'invalid_native_descriptor');
  const configurationSha256 = opaqueDigest(nativeConfiguration,
    'configurationSha256', 'invalid_native_descriptor');
  const configuration = Object.getOwnPropertyDescriptor(nativeConfiguration, 'configuration')?.value;
  if (!configuration || typeof configuration !== 'object') fail('invalid_native_descriptor');
  const context = { version: 'mixed-context-v1', sourcePolicyDigest: mixedSourcePolicy().digest,
    nativeProfile: 'mem0-2.2.0-infer-add-no-nlp-v1',
    nativeConfigurationSha256: configurationSha256,
    nativeTopK: 6, nativeThreshold: 0, nativeChildTimeoutMs: 3_600_000,
    cairnQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1', recallLimit: 6,
    recallContextMode: 'source-evidence', recallSelectionMode: 'bounded-source-scan',
    experimentPolicy: experimentPolicy(), stages: benchmarkStagePolicy(),
    wireProfile: mem0WireProfile() };
  const answer = { version: 'mixed-answer-v1', model: MIXED_ANSWER_MODEL,
    instruction: PUBLIC_ANSWER_INSTRUCTION, contextWindow: MIXED_ANSWER_CONTEXT_WINDOW,
    outputTokens: MIXED_ANSWER_OUTPUT_TOKENS, timeoutMs: MIXED_ANSWER_TIMEOUT_MS,
    requestKeys: ['model', 'messages', 'temperature', 'max_tokens', 'n'],
    evidenceShape: 'JSON.stringify({evidence:[{text}],currentQuestion:{text,date}})',
    packing: 'exact-string-first-seen-whole-unit-v1' };
  const scorer = { version: 'mixed-scorer-v1', upstreamCommit: OFFICIAL_UPSTREAM_COMMIT,
    judgeModel: OFFICIAL_JUDGE_MODEL, questionTypes: OFFICIAL_QUESTION_TYPES,
    judgePolicy: benchmarkStagePolicy().judge, aggregation: 'fixed-N-paired-3x3-v1' };
  const cairnAdapter = { version: 'mixed-cairn-adapter-v1',
    qualificationInputMode: 'adaptive-text-catalog-v1',
    extractionModel: DEFAULT_MODEL, rationaleModel: DEFAULT_MODEL, basisModel: DEFAULT_MODEL,
    modelProfile: modelProfile() };
  return freeze({ sourceProtocolSha256: mixedSourcePolicy().digest,
    contextProtocolSha256: hash(CONTEXT_DOMAIN, context),
    answerProtocolSha256: hash(ANSWER_DOMAIN, answer),
    scorerProtocolSha256: hash(SCORER_DOMAIN, scorer),
    cairn: { runtimeArtifactSha256: cairnRuntimeArtifactSha256,
      adapterConfigurationSha256: hash(CAIRN_ADAPTER_DOMAIN, cairnAdapter),
      qualificationInputProfile: 'adaptive-text-catalog-v1',
      captureSourcePolicy: 'indexed-windows-v1' },
    mem0: { version: '2.2.0', sourceTreeSha256, dependencyLockSha256,
      configurationSha256, wireProfile: structuredClone(mem0WireProfile()) } });
}

export function prepareMixedComparison(options) {
  const raw = ownOptions(options, ['sourceCases', 'armOrders', 'nativeArtifact',
    'nativeConfiguration', 'cairnRuntimeArtifactSha256'], 'invalid_mixed_preparation');
  const source = sourceSnapshot({ sourceCases: raw.sourceCases, armOrders: raw.armOrders });
  dense(source.sourceCases, 1, 250, 'invalid_source_cases');
  dense(source.armOrders, source.sourceCases.length, source.sourceCases.length,
    'invalid_arm_orders');
  const seen = new Set();
  for (const row of source.sourceCases) sourceIdentity(row, seen);
  for (const order of source.armOrders) {
    dense(order, 2, 2, 'invalid_arm_orders');
    if (new Set(order).size !== 2 || ARM_NAMES.some(name => !order.includes(name))) {
      fail('invalid_arm_orders');
    }
  }
  const manifest = protocolManifest(raw);
  const preflight = [];
  const plans = [];
  const batchCounts = [];
  const roster = [];
  for (const [index, row] of source.sourceCases.entries()) {
    let plan = null, reason = null;
    try {
      plan = prepareMixedSourceCase(row);
      if (!staticNativeFit(plan.mem0Input)) { plan = null; reason = 'native_static_input_exceeded'; }
    } catch (error) {
      reason = typeof error?.code === 'string' && /^[a-z0-9_]{1,80}$/u.test(error.code)
        ? error.code : 'source_preflight_failed';
    }
    plans.push(plan);
    const questionId = row.question.question_id;
    const status = plan ? 'ready' : 'failed';
    const preflightRow = { questionId, status, reason: plan ? null : reason,
      caseDigest: plan?.caseDigest ?? null };
    preflight.push(preflightRow);
    batchCounts.push(plan?.counts.batches ?? 0);
    const armOrder = source.armOrders[index];
    const protocolDigest = hash(CASE_DOMAIN, { manifest, question: row.question,
      namespace: row.namespace, caseDigest: plan?.caseDigest ?? null,
      preflight: { status, reason: preflightRow.reason }, armOrder });
    roster.push({ questionId, protocolDigest, armOrder,
      arms: ARM_NAMES.map(name => ({ name,
        scopeId: `lme-case-${hash(SCOPE_DOMAIN, [questionId, name])}` })) });
  }
  const projection = freeze({ schemaVersion: PREPARATION_VERSION,
    manifest, roster, counts: { fixedN: source.sourceCases.length, batchCounts }, preflight });
  PREPARED.set(projection, { sourceCases: source.sourceCases, armOrders: source.armOrders,
    plans, nativeArtifact: raw.nativeArtifact, nativeConfiguration: raw.nativeConfiguration,
    manifestDigest: hash(MANIFEST_DOMAIN, manifest), rosterDigest: hash(ROSTER_DOMAIN, roster) });
  return projection;
}

function assertGuard(prepared, privateData, guard) {
  const capability = guard?.mixedSourcePairCapability;
  if (!capability || typeof guard.withCaseScope !== 'function'
    || typeof guard.isHalted !== 'function' || guard.isHalted()
    || canonical(capability.manifest) !== canonical(prepared.manifest)
    || canonical(capability.roster) !== canonical(prepared.roster)
    || capability.rosterDigest !== privateData.rosterDigest
    || capability.schedule?.length !== prepared.roster.length * 4) {
    fail('mixed_guard_mismatch');
  }
  for (let index = 0; index < prepared.roster.length; index++) {
    const roster = prepared.roster[index];
    for (let position = 0; position < 2; position++) {
      const selected = roster.arms.find(item => item.name === roster.armOrder[position]);
      if (capability.schedule[index * 2 + position]?.phase !== 'generation'
        || capability.schedule[index * 2 + position]?.caseId !== selected.scopeId) {
        fail('mixed_guard_mismatch');
      }
    }
  }
}

function assertNative(prepared, privateData, guard) {
  const roots = checkedMem0NativeArtifact(privateData.nativeArtifact);
  const configuration = checkedMem0NativeConfiguration(privateData.nativeConfiguration);
  if (configuration.configuration.topK !== 6 || configuration.configuration.threshold !== 0
    || configuration.configuration.childTimeoutMs !== 3_600_000
    || configuration.configuration.httpTimeoutMs !== guard.mixedSourcePairCapability.limits.mem0TimeoutMs
    || privateData.nativeArtifact.sourceTreeSha256 !== prepared.manifest.mem0.sourceTreeSha256
    || privateData.nativeArtifact.dependencyLockSha256 !== prepared.manifest.mem0.dependencyLockSha256
    || configuration.configurationSha256 !== prepared.manifest.mem0.configurationSha256
    || !roots) fail('native_manifest_mismatch');
}

function rootPath(root) {
  if (!wellFormed(root) || !path.isAbsolute(root)) fail('invalid_cairn_store_root');
  let info;
  try { info = lstatSync(root); } catch { fail('invalid_cairn_store_root'); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('invalid_cairn_store_root');
  return root;
}

function revokeSemanticOnly(handle, guard, allowedLocalOrdinals) {
  // A transport/accounting unknown must keep its X cause. Revocation is for
  // completed, priced local semantic failures, never a reason-minting fallback.
  if (!guard.isHalted() && !unknownCurrentAttempt(guard, allowedLocalOrdinals)) handle.revoke();
}

async function cairnCase({ guard, apiKey, root, row, plan, handle, transport, holdCore,
  allowedLocalOrdinals }) {
  const folder = mkdtempSync(path.join(root, 'mixed-cairn-'));
  const model = createOpenAIModel({ apiKey, fetchImpl: transport.track(guard.cairnFetch),
    qualificationInputMode: 'adaptive-text-catalog-v1' });
  const core = openMemoryCore({ path: path.join(folder, 'store.db'), model,
    captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  holdCore(core);
  try {
    verifyMixedCapturePlan({ history: plan.renderedHistory, namespace: row.namespace,
      expectedPlan: plan.cairnPlan });
    const ingested = await ingestIndexedWindowLongMemEvalCase({ history: plan.renderedHistory,
      namespace: row.namespace, capture: input => core.capture(input) });
    if (!isDeepStrictEqual(ingested.plan, plan.cairnPlan)
      || ingested.outcomes.length !== plan.cairnPlan.batches.length
      || ingested.outcomes.some(item => item.status !== 'completed')) {
      revokeSemanticOnly(handle, guard, allowedLocalOrdinals); fail('ingestion_incomplete');
    }
    const recalled = await core.recall({ readSet: [row.namespace], query: plan.mem0Input.query,
      limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
    if (recalled?.ok !== true) { revokeSemanticOnly(handle, guard, allowedLocalOrdinals); fail('recall_failed'); }
    let evidence;
    try { evidence = verifiedEvidence(recalled.value,
      input => core.get(input), plan, row.namespace); }
    catch (error) { revokeSemanticOnly(handle, guard, allowedLocalOrdinals); throw error; }
    const packed = packMixedAnswer({ question: { text: row.question.text,
      date: plan.canonicalQuestionDate }, units: evidence.units, countTokens: countOpenAITokens });
    const answer = await completionOnce({ guard, stage: 'answer', request: packed.request,
      apiKey, timeoutMs: MIXED_ANSWER_TIMEOUT_MS, transport });
    const admitted = ingested.outcomes.reduce((sum, item) => sum
      + (item.result?.admission?.memories?.length ?? 0), 0);
    return { answer, diagnostics: { stage: 'answer', captureBatches: ingested.outcomes.length,
      admittedMemories: admitted,
      recalledCards: evidence.units.length, receiptCount: evidence.provenance.length,
      provenance: evidence.provenance, selectedIndices: packed.selectedIndices,
      duplicateIndices: packed.duplicateIndices, omittedIndices: packed.omittedIndices } };
  } finally { await transport.drain(); }
}

function attemptDiagnostics(guard, ordinal) {
  const attempts = guard.attempts().filter(item => item.ordinal === ordinal);
  return { requests: attempts.length,
    reservedMicroUsd: attempts.reduce((sum, item) => sum + item.reservedMicroUsd, 0),
    knownActualMicroUsd: attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
    unknownActualCount: attempts.filter(item => item.actualMicroUsd === null).length,
    stages: attempts.map(item => ({ stage: item.stage, outcome: item.outcome,
      reservedMicroUsd: item.reservedMicroUsd, actualMicroUsd: item.actualMicroUsd })) };
}

async function nativeCase({ guard, apiKey, plan, nativeArtifact, nativeConfiguration,
  handle, transport, question, allowedLocalOrdinals }) {
  const result = await runMem0NativeCase({ artifact: nativeArtifact,
    configuration: nativeConfiguration, guard, handle, input: plan.mem0Input });
  if (result?.status !== 'completed') return { failed: result?.reason ?? 'native_failed',
    diagnostics: { stage: 'native' } };
  const native = result.value;
  if (!Array.isArray(native?.results) || native.results.length > 6
    || native.results.some(item => !wellFormed(item?.memory)
      || !item.memory || Buffer.byteLength(item.memory, 'utf8') > 1024 * 1024)) {
    revokeSemanticOnly(handle, guard, allowedLocalOrdinals); fail('invalid_native_result');
  }
  const packed = packMixedAnswer({ question, units: native.results.map(item =>
    ({ text: item.memory })), countTokens: countOpenAITokens });
  const answer = await completionOnce({ guard, stage: 'answer', request: packed.request,
    apiKey, timeoutMs: MIXED_ANSWER_TIMEOUT_MS, transport });
  return { answer, diagnostics: { stage: 'answer', nativeResults: native.results.length,
    verifiedAddRecords: native.verifiedAddRecords,
    selectedIndices: packed.selectedIndices, duplicateIndices: packed.duplicateIndices,
    omittedIndices: packed.omittedIndices } };
}

export async function runMixedGeneration(options) {
  const { prepared, guard, apiKey, cairnStoreRoot } = ownOptions(options,
    ['prepared', 'guard', 'apiKey', 'cairnStoreRoot'], 'invalid_mixed_generation');
  const privateData = PREPARED.get(prepared);
  if (!privateData || USED.has(prepared)) fail('prepared_identity_required');
  USED.add(prepared);
  if (!wellFormed(apiKey) || !apiKey.trim() || /[\r\n]/u.test(apiKey)) fail('invalid_api_key');
  assertGuard(prepared, privateData, guard);
  assertNative(prepared, privateData, guard);
  const root = rootPath(cairnStoreRoot);
  const cases = privateData.sourceCases.map((row, index) => ({
    questionId: row.question.question_id,
    question: { text: row.question.text,
      date: privateData.plans[index]?.canonicalQuestionDate ?? row.question.date },
    caseDigest: privateData.plans[index]?.caseDigest ?? null,
    preflight: { status: prepared.preflight[index].status,
      reason: prepared.preflight[index].reason },
    arms: ARM_NAMES.map(arm) }));
  let haltReason = null;
  const allowedLocalOrdinals = new Set();
  for (let index = 0; index < cases.length && !haltReason; index++) {
    const row = privateData.sourceCases[index], plan = privateData.plans[index];
    for (const name of prepared.roster[index].armOrder) {
      if (haltReason) break;
      const resultArm = cases[index].arms.find(item => item.name === name);
      const identity = { phase: 'generation', caseId: prepared.roster[index].arms
        .find(item => item.name === name).scopeId };
      if (guard.isHalted() || unknownCurrentAttempt(guard, allowedLocalOrdinals)) {
        haltReason = 'global_accounting_unsettled'; break;
      }
      const transport = trackedTransport();
      let outcome, local = null, entered = false, workSettled = false, ownedCore = null;
      try {
        outcome = await guard.withCaseScope(identity, async handle => {
          entered = true;
          try {
            if (!plan) { handle.revoke(); return null; }
            try {
              local = name === 'cairn'
                ? await cairnCase({ guard, apiKey, root, row, plan, handle, transport,
                  holdCore: core => { ownedCore = core; }, allowedLocalOrdinals })
                : await nativeCase({ guard, apiKey, plan,
                  nativeArtifact: privateData.nativeArtifact,
                  nativeConfiguration: privateData.nativeConfiguration, handle, transport,
                  question: { text: row.question.text, date: plan.canonicalQuestionDate },
                  allowedLocalOrdinals });
            } catch (error) {
              local = { failed: reasonOf(error, 'arm_execution_failed'),
                diagnostics: { stage: 'execution' } };
            }
            return local;
          } finally { await transport.drain(); workSettled = true; }
        });
      } catch { haltReason = 'scope_execution_failed'; }
      // Core operations and owned guarded transport have settled; X has now
      // closed its scope and verified accounting. Only then close the store.
      if (ownedCore) {
        try { ownedCore.close(); } catch { haltReason ??= 'core_cleanup_failed'; }
      }
      const observed = scopeOf(guard);
      if (entered) {
        resultArm.scope = observed;
        resultArm.diagnostics = { ...local?.diagnostics,
          attempts: attemptDiagnostics(guard, observed?.ordinal) };
      }
      if (guard.isHalted()) haltReason ??= 'global_halt';
      if (!haltReason && unknownCurrentAttempt(guard, allowedLocalOrdinals)) {
        if (!authenticateLocalUnknown(guard, outcome, identity, allowedLocalOrdinals,
          { workSettled, transportSettled: transport.size === 0 })) {
          haltReason = 'global_accounting_unsettled';
        }
      }
      if (haltReason) {
        resultArm.status = entered ? 'failed' : 'blocked'; resultArm.reason = haltReason;
      } else if (outcome?.status === 'completed' && local?.answer) {
        resultArm.status = 'completed'; resultArm.reason = null;
        resultArm.answer = local.answer;
      } else {
        resultArm.status = outcome?.status === 'blocked' ? 'blocked' : 'failed';
        resultArm.reason = plan ? (outcome?.reason === 'deadline' ? 'deadline'
          : LOCAL_REASONS.has(local?.failed) ? local.failed
          : outcome?.reason ?? local?.failed ?? 'arm_failed')
          : prepared.preflight[index].reason;
        resultArm.diagnostics = { ...resultArm.diagnostics,
          stage: local?.diagnostics?.stage ?? 'preflight' };
      }
    }
  }
  if (haltReason) for (const item of cases) for (const resultArm of item.arms) {
    if (resultArm.reason === 'not_started') resultArm.reason = haltReason;
  }
  return freeze(reportSnapshot({ schemaVersion: MIXED_GENERATION_VERSION, manifest: prepared.manifest,
    roster: prepared.roster, manifestDigest: privateData.manifestDigest,
    rosterDigest: privateData.rosterDigest, cases, halted: haltReason !== null, haltReason }));
}

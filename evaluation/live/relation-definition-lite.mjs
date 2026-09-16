import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { proposeRationale } from '../../core/rationale.mjs';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { getQualificationPilotPins } from './qualification-pilot.mjs';
import { createRationaleLiveSession } from './qualification-session.mjs';
import { createRationaleAttempt } from './qualification-pilot-attempt.mjs';
import { experimentPolicy } from './session.mjs';
import { privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = 'relation-definition-lite-v1';
const FIXTURE = 'evaluation/live/relation-definition-fixture.json';
const RUBRIC = 'evaluation/live/relation-definition-rubric.json';
const GUIDE = 'docs/relation-definition-lite-guide.md';
const FROZEN = Object.freeze({
  [FIXTURE]: '95137a94a7702085889aa68df70d2b899488fde4b7aef9915d9610d749fb650f',
  [RUBRIC]: '048786044462967a3bafe7fc4b8fcef6076319a46295133662188e9035d2a436',
  [GUIDE]: '6622d642c652e0d70c9151b2d8cae012e973f16d8239a48b8622812327cadff4',
});
const PIN_FILES = Object.freeze([FIXTURE, RUBRIC, GUIDE,
  'evaluation/live/relation-definition-lite.mjs', 'evaluation/live/relation-definition-score.mjs', 'core/rationale.mjs',
  'core/prompts/relate-rationale.md', 'core/prompts/relate-claim-focus.md',
  'core/model-call.mjs', 'core/model-budget.mjs']);
export const RELATION_DEFINITION_LIMITS = Object.freeze({ requests: 64, microUsd: 320_000,
  reservationMicroUsd: 5_000, expectedRequests: 40, slots: 20 });
const fail = code => { throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const safePath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || realpathSync(value) !== value) fail('unsafe_relation_path');
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('unsafe_relation_path');
  return value;
};
const stateSummary = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length,
  limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap, state: state.state });

export function getRelationDefinitionPins() {
  return { ...getQualificationPilotPins(), ...Object.fromEntries(PIN_FILES.map(name =>
    [name, hash(readFileSync(safePath(path.join(ROOT, name))))])) };
}

/** Explicit one-shot operator; no credential, ledger, grant or fetch discovery. */
export async function runRelationDefinitionLite(options) {
  try { return await execute(options); }
  catch { fail('relation_definition_preflight_failed'); }
}

async function execute(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'rationaleExtension', 'apiKey',
    'fetchImpl', 'privateDirectory', 'pins'])) fail('invalid_relation_options');
  const { apiKey, fetchImpl } = options;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function') fail('invalid_relation_options');
  const ledgerOptions = structuredClone(options.ledger), checkpoint = structuredClone(options.expectedCheckpoint);
  const capability = structuredClone(options.rationaleExtension), pins = structuredClone(options.pins);
  if (!exact(checkpoint, ['requestCount', 'reservedMicroUsd'])
    || !Object.values(checkpoint).every(value => Number.isSafeInteger(value) && value >= 0)
    || !exact(ledgerOptions, ['directory', 'runId', 'limitMicroUsd', 'requestCap'])
    || !exact(pins, Object.keys(getRelationDefinitionPins()))
    || capability?.authorizationId !== 'rationale-pilot-v1'
    || capability?.method !== 'cairn_relate' || capability?.model !== 'gpt-4.1-mini-2025-04-14') fail('invalid_relation_options');
  const verifyPins = () => {
    const actual = getRelationDefinitionPins();
    if (!same(pins, actual) || Object.entries(FROZEN).some(([name, digest]) => actual[name] !== digest)) fail('pin_mismatch');
  };
  verifyPins();
  const directory = privateDirectory(safePath(options.privateDirectory, true));
  safePath(ledgerOptions.directory, true);
  const capabilityFile = safePath(path.join(ledgerOptions.directory, 'experiment-rationale-extension.json'));
  const policyFile = safePath(path.join(ledgerOptions.directory, 'experiment-request-policy.json'));
  const capabilityBytes = readFileSync(capabilityFile), policyBytes = readFileSync(policyFile);
  if ((lstatSync(capabilityFile).mode & 0o777) !== 0o600 || (lstatSync(policyFile).mode & 0o777) !== 0o600
    || !same(JSON.parse(capabilityBytes), capability)
    || !same(JSON.parse(policyBytes), { version: 1, runId: ledgerOptions.runId, policy: experimentPolicy() })) fail('binding_mismatch');
  const checkBoundaries = () => {
    verifyPins(); safePath(capabilityFile); safePath(policyFile);
    if (!readFileSync(capabilityFile).equals(capabilityBytes) || !readFileSync(policyFile).equals(policyBytes)) fail('binding_changed');
  };
  const cleanString = value => value.replace(/\\u([0-9a-f]{4})/giu,
    (_, digits) => String.fromCharCode(Number.parseInt(digits, 16))).replaceAll('\\/', '/').replaceAll(apiKey, '[REDACTED-KEY]');
  const redact = value => typeof value === 'string' ? cleanString(value)
    : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [cleanString(key), redact(item)])) : value;
  const evidence = (name, value) => writeQualifiedEvidence(directory, name, redact(value));
  const fixture = JSON.parse(readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
  const guide = readFileSync(path.join(ROOT, GUIDE), 'utf8');
  if (fixture.id !== ID || fixture.version !== 1 || fixture.cases?.length !== 10
    || fixture.cases.some(item => !Array.isArray(item.memories) || !item.memories.length
      || Object.keys(item).sort().join(',') !== 'id,memories')) fail('invalid_fixture');
  const schedule = fixture.cases.flatMap((item, index) => (index % 2
    ? ['guide', 'baseline'] : ['baseline', 'guide']).map(arm => ({ caseId: item.id, arm, memories: item.memories })));
  const report = { version: 1, id: ID, status: 'not_run', semanticReviewRequired: true,
    limits: RELATION_DEFINITION_LIMITS, pins, capabilitySha256: hash(capabilityBytes),
    budgetBefore: null, budgetAfter: null, attempt: null,
    cleanup: { drain: 'not-opened', sessionClose: 'not-opened', ledgerClose: 'not-opened' },
    slots: schedule.map(item => ({ caseId: item.caseId, arm: item.arm, status: 'not_run',
      proposal: null, rawOutput: null, requests: [], durationMs: null })) };
  const ledger = reopenExperimentBudget(ledgerOptions);
  let before;
  try {
    before = ledger.getState();
    if (before.state !== 'open' || before.attempts.some(item => item.outcome === null)
      || before.requestCount !== checkpoint.requestCount || before.reservedMicroUsd !== checkpoint.reservedMicroUsd
      || before.requestCap - before.requestCount < RELATION_DEFINITION_LIMITS.requests
      || before.limitMicroUsd - before.reservedMicroUsd < RELATION_DEFINITION_LIMITS.microUsd) fail('checkpoint_or_cap_mismatch');
  } catch (error) { ledger.close(); throw error; }
  let session, attempt, activeSlot, activeIndex = -1, requestQueue = Promise.resolve();
  try {
    report.budgetBefore = stateSummary(before);
    // Construction verifies the pre-existing immutable capability; it never grants one.
    session = createRationaleLiveSession({ ledger: ledgerOptions, rationaleExtension: capability, apiKey, fetchImpl });
    attempt = createRationaleAttempt({ readState: () => ledger.getState(), expectedCheckpoint: checkpoint,
      checkPins: checkBoundaries, persist: evidence,
      send: async (route, body, requestOptions) => {
        const local = attempt.getState();
        if (local.requests > RELATION_DEFINITION_LIMITS.requests
          || local.reservedMicroUsd > RELATION_DEFINITION_LIMITS.microUsd) fail('relation_cap_reached');
        const sequence = local.requests;
        const record = { sequence, route, requestBody: JSON.parse(body), responseText: null,
          responseBody: null, responseAvailable: false };
        activeSlot.requests.push(record);
        evidence(`http-${sequence}-request`, record);
        let stage = 'guarded-transport';
        const beforeRequestCount = ledger.getState().requestCount;
        try {
          const response = await session.request(route, body, requestOptions);
          record.responseAvailable = true;
          stage = 'response-copy';
          const bytes = await response.clone().arrayBuffer();
          if (bytes.byteLength > 262_144) fail('response_bounds');
          record.responseText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          evidence(`http-${sequence}-raw-response`, { sequence, route, responseText: record.responseText });
          record.responseBody = JSON.parse(record.responseText);
          evidence(`http-${sequence}-response`, record);
          if (route === '/responses') {
            try { activeSlot.rawOutput = JSON.parse(record.responseBody.output
              .flatMap(message => message.content).map(part => part.text).join('')); }
            catch { activeSlot.rawOutput = { malformedJson: true }; }
          }
          return response;
        } catch (error) {
          let costStatus = 'unavailable';
          try {
            const state = ledger.getState();
            if (state.requestCount === beforeRequestCount + 1) {
              costStatus = state.attempts.at(-1)?.actualMicroUsd === null ? 'unknown' : 'known';
            }
          } catch { /* Failure evidence remains conservative. */ }
          try { evidence(`http-${sequence}-failure`, { stage, slot: activeIndex,
            responseAvailable: record.responseAvailable, costStatus, error: 'request_failed' }); } catch { /* halt evidence remains */ }
          throw error;
        }
      } });
    checkBoundaries();
    writeQualifiedEvidence(ledgerOptions.directory, `${ID}-intent`, { version: 1, id: ID,
      expectedCheckpoint: checkpoint, pins, capabilitySha256: hash(capabilityBytes), limits: RELATION_DEFINITION_LIMITS });
    evidence('initial-report', report);
    evidence('frozen-fixture', fixture);
    const model = createOpenAIModel({ apiKey, fetchImpl: (url, requestOptions) => {
      const route = new URL(url).pathname;
      if (!['/v1/responses', '/v1/responses/input_tokens'].includes(route)) fail('invalid_live_route');
      const pending = requestQueue.then(() => {
        const state = attempt.getState();
        if (state.requests >= RELATION_DEFINITION_LIMITS.requests
          || state.reservedMicroUsd + RELATION_DEFINITION_LIMITS.reservationMicroUsd > RELATION_DEFINITION_LIMITS.microUsd) {
          attempt.stop(); fail('relation_cap_reached');
        }
        return attempt.request(route.slice(3), requestOptions.body, { signal: requestOptions.signal });
      });
      requestQueue = pending.then(() => undefined, () => undefined);
      return pending;
    } });
    for (let index = 0; index < schedule.length; index++) {
      if (attempt.getState().halted) break;
      activeIndex = index; activeSlot = report.slots[index]; const item = schedule[index];
      const started = performance.now(); activeSlot.status = 'running';
      evidence(`slot-${index}-started`, { caseId: item.caseId, arm: item.arm });
      const wrapped = { contextWindow: model.contextWindow, countTokens: model.countTokens,
        relate: async request => {
          if (item.arm === 'guide') request.system += `\n\n${guide}`;
          const output = await model.relate(request);
          activeSlot.proposal = output; return output;
        } };
      try {
        await proposeRationale(wrapped, item.memories, checkBoundaries);
        activeSlot.status = 'completed';
      } catch (error) {
        if (attempt.getState().halted) { activeSlot.status = 'failed'; attempt.stop(); }
        else if (error?.code === 'invalid_model_output') activeSlot.status = 'malformed';
        else { activeSlot.status = 'failed'; attempt.stop(); }
        activeSlot.error = activeSlot.status === 'malformed' ? 'invalid_model_output' : 'slot_failed';
      }
      activeSlot.durationMs = Math.round(performance.now() - started);
      evidence(`slot-${index}-result`, activeSlot);
    }
    report.status = attempt.getState().halted ? 'halted'
      : report.slots.some(slot => slot.status !== 'completed') ? 'completed_with_failures' : 'completed';
  } catch {
    report.status = 'halted'; report.error = 'relation_definition_failed';
    if (activeSlot?.status === 'running') activeSlot.status = 'failed';
    if (attempt) attempt.stop();
  } finally {
    if (attempt) { try { await attempt.drain(); report.cleanup.drain = 'completed'; }
      catch { report.status = 'halted'; report.cleanup.drain = 'failed'; } }
    try { report.budgetAfter = stateSummary(ledger.getState()); }
    catch { report.status = 'halted'; report.accountingError = 'accounting_failed'; }
    report.attempt = attempt?.getState() ?? null;
    if (session) { try { session.close(); report.cleanup.sessionClose = 'completed'; }
      catch { report.status = 'halted'; report.cleanup.sessionClose = 'failed'; } }
    try { ledger.close(); report.cleanup.ledgerClose = 'completed'; }
    catch { report.status = 'halted'; report.cleanup.ledgerClose = 'failed'; }
    try { checkBoundaries(); } catch { report.status = 'halted'; report.pinError = 'pin_or_binding_changed'; }
    try { evidence('final-report', report); } catch { report.status = 'halted'; report.persistenceError = 'final_report_failed'; }
  }
  return redact(report);
}

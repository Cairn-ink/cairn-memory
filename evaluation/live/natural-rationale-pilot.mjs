import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { runDecisionEvolutionCore } from '../decision-evolution/core-runner.mjs';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { createRationaleAttempt, RATIONALE_LIMITS } from './qualification-pilot-attempt.mjs';
import { createRationaleLiveSession } from './qualification-session.mjs';
import { getQualificationPilotPins } from './qualification-pilot.mjs';
import { experimentPolicy } from './session.mjs';
import { privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = 'natural-rationale-dev-v1';
const FIXTURE = 'evaluation/decision-evolution/fixture.json';
const FROZEN_DEV_SHA = 'b26960db6151733d6c0b5b2e45803d3d444b25c6a3dc2dd7c06d9570f5d5056c';
const PIN_FILES = Object.freeze([
  FIXTURE, 'evaluation/decision-evolution/contract.mjs',
  'evaluation/decision-evolution/core-runner.mjs',
  'evaluation/decision-evolution/natural-rationale-trace.mjs',
  'evaluation/live/natural-rationale-pilot.mjs',
]);
const fail = code => { throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const safePath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || realpathSync(value) !== value) fail('unsafe_pilot_path');
  const entry = lstatSync(value);
  if (entry.isSymbolicLink() || !(directory ? entry.isDirectory() : entry.isFile())) fail('unsafe_pilot_path');
  return value;
};
const summary = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
  limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap, state: state.state,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length });
const substageCounts = result => ({
  captureFailures: result.captures.filter(item => item.status !== 'ok' || item.receiptError).length,
  classificationFailures: result.captures.filter(item => item.classification?.status === 'failed').length,
  rationaleFailures: result.captures.filter(item => !item.naturalRationale
    || item.naturalRationale.captureRationale?.status === 'failed'
    || item.naturalRationale.observation === 'candidate-seen-callback-failed-or-pending').length,
  readFailures: result.questions.flatMap(item => Object.values(item.arms)).filter(arm => arm.status !== 'ok').length,
  lifecycleFailures: result.trace.filter(item => item.status === 'failed'
    && !item.stage.startsWith('capture:') && !item.stage.startsWith('classification:')).length
    + result.captures.filter(item => item.naturalRationale
      && [item.naturalRationale.beforeCapture, item.naturalRationale.afterCapture,
        item.naturalRationale.afterColdReopen].some(view => view?.status === 'incomplete')).length,
});

function corePins() {
  const files = [];
  const walk = relative => {
    for (const entry of readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory() && !['test', 'testing', 'examples'].includes(entry.name)) walk(name);
      else if (entry.isFile() && /\.(?:mjs|md)$/u.test(entry.name)) files.push(name);
    }
  };
  walk('core');
  return files.sort();
}

/** Hash the transitive core surface plus the existing transport/policy pins. */
export function getNaturalRationalePilotPins() {
  return { ...getQualificationPilotPins(), ...Object.fromEntries([...PIN_FILES, ...corePins()].map(name =>
    [name, hash(readFileSync(safePath(path.join(ROOT, name))))])) };
}

function frozenFixture() {
  const source = JSON.parse(readFileSync(safePath(path.join(ROOT, FIXTURE)), 'utf8'));
  const fixture = { version: source.version, cases: source.cases.filter(item => item.split === 'dev') };
  if (fixture.cases.length !== 4 || fixture.cases.reduce((sum, item) => sum + item.events.length, 0) !== 10
    || fixture.cases.reduce((sum, item) => sum + item.questions.length, 0) !== 4
    || hash(JSON.stringify(fixture)) !== FROZEN_DEV_SHA) fail('fixture_mismatch');
  return fixture;
}

/** Explicit operator only. No import-time key discovery, native fetch or ledger creation. */
export async function runNaturalRationalePilot(options) {
  try { return await execute(options); }
  catch (error) {
    const safe = ['invalid_pilot_options', 'pin_mismatch', 'fixture_mismatch', 'unsafe_pilot_path',
      'invalid_capability', 'invalid_policy', 'unsafe_private_directory'].includes(error?.message);
    fail(safe ? error.message : 'pilot_preflight_failed');
  }
}

async function execute(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'rationaleExtension', 'apiKey', 'fetchImpl',
    'privateDirectory', 'pins'])) fail('invalid_pilot_options');
  const { apiKey, fetchImpl } = options;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function') fail('invalid_pilot_options');
  let ledgerConfig, checkpoint, capability, pins;
  try {
    ledgerConfig = structuredClone(options.ledger);
    checkpoint = structuredClone(options.expectedCheckpoint);
    capability = structuredClone(options.rationaleExtension);
    pins = structuredClone(options.pins);
  } catch { fail('invalid_pilot_options'); }
  if (!exact(checkpoint, ['requestCount', 'reservedMicroUsd'])
    || !Object.values(checkpoint).every(value => Number.isSafeInteger(value) && value >= 0)
    || !exact(ledgerConfig, ['directory', 'runId', 'limitMicroUsd', 'requestCap'])
    || !exact(capability, ['version', 'authorizationId', 'ledger', 'policy', 'method', 'model', 'checkpoint'])
    || capability.method !== 'cairn_relate' || capability.model !== 'gpt-4.1-mini-2025-04-14'
    || !exact(pins, Object.keys(getNaturalRationalePilotPins()))) fail('invalid_pilot_options');
  const verifyPins = () => {
    if (!same(pins, getNaturalRationalePilotPins())) fail('pin_mismatch');
    frozenFixture();
  };
  verifyPins();
  const directory = privateDirectory(safePath(options.privateDirectory, true));
  safePath(ledgerConfig.directory, true);
  const capabilityFile = safePath(path.join(ledgerConfig.directory, 'experiment-rationale-extension.json'));
  const capabilityBytes = readFileSync(capabilityFile);
  if ((lstatSync(capabilityFile).mode & 0o777) !== 0o600
    || !same(JSON.parse(capabilityBytes), capability)) fail('invalid_capability');
  const policyFile = safePath(path.join(ledgerConfig.directory, 'experiment-request-policy.json'));
  const policyBytes = readFileSync(policyFile);
  if ((lstatSync(policyFile).mode & 0o777) !== 0o600
    || !same(JSON.parse(policyBytes), { version: 1, runId: ledgerConfig.runId, policy: experimentPolicy() })) fail('invalid_policy');
  const verifyBoundaries = () => {
    verifyPins();
    safePath(capabilityFile); safePath(policyFile);
    if (!readFileSync(capabilityFile).equals(capabilityBytes) || !readFileSync(policyFile).equals(policyBytes)) fail('binding_changed');
  };
  const redact = value => typeof value === 'string' ? value.replaceAll(apiKey, '[REDACTED-KEY]')
    : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(apiKey, '[REDACTED-KEY]'), redact(item)])) : value;
  const evidence = (name, value) => writeQualifiedEvidence(directory, name, redact(value));
  const fixture = frozenFixture();
  const report = { version: 1, id: ID, status: 'not_run', diagnosticOnly: true,
    limits: RATIONALE_LIMITS, fixtureSha256: FROZEN_DEV_SHA, pins, capabilitySha256: hash(capabilityBytes),
    budgetBefore: null, budgetAfter: null, attempt: null,
    cleanup: { drain: 'not-opened', sessionClose: 'not-opened', ledgerClose: 'not-opened' },
    cases: fixture.cases.map(item => ({ caseId: item.id, status: 'not_run', result: null })) };
  const ledger = reopenExperimentBudget(ledgerConfig);
  let session, attempt;
  try {
    const before = ledger.getState();
    if (before.state !== 'open' || before.attempts.some(item => item.outcome === null)
      || before.requestCount !== checkpoint.requestCount || before.reservedMicroUsd !== checkpoint.reservedMicroUsd) fail('checkpoint_mismatch');
    report.budgetBefore = summary(before);
    // Construction validates the existing immutable grant. It never provisions one.
    session = createRationaleLiveSession({ ledger: ledgerConfig, rationaleExtension: capability, apiKey, fetchImpl });
    attempt = createRationaleAttempt({ readState: () => ledger.getState(), expectedCheckpoint: checkpoint,
      checkPins: verifyBoundaries, persist: evidence,
      send: async (route, body, requestOptions) => {
        const sequence = attempt.getState().requests;
        let stage = 'request-evidence', responseAvailable = false, responseStatus = null, beforeCount = null;
        try {
          evidence(`http-${sequence}-request`, { route, body: JSON.parse(body) });
          stage = 'accounting-snapshot';
          beforeCount = ledger.getState().requestCount;
          stage = 'guarded-transport';
          const response = await session.request(route, body, requestOptions);
          responseAvailable = true; responseStatus = response.status;
          stage = 'response-copy';
          const responseBody = JSON.parse(await response.clone().text());
          stage = 'response-evidence';
          evidence(`http-${sequence}-response`, { status: responseStatus, body: responseBody });
          return response;
        } catch (error) {
          let costStatus = 'unavailable';
          try {
            const state = ledger.getState();
            if (beforeCount !== null && state.requestCount === beforeCount + 1) {
              costStatus = state.attempts.at(-1).actualMicroUsd === null ? 'unknown' : 'known';
            }
          } catch { /* Never mask the original request failure. */ }
          try { evidence(`http-${sequence}-failure`, { stage, responseAvailable, responseStatus, costStatus }); }
          catch { /* Existing request-N-halted evidence remains the fallback. */ }
          throw error;
        }
      } });
    verifyBoundaries();
    writeQualifiedEvidence(ledgerConfig.directory, `${ID}-intent`, { version: 1, id: ID,
      expectedCheckpoint: checkpoint, fixtureSha256: FROZEN_DEV_SHA, pins,
      capabilitySha256: hash(capabilityBytes), limits: RATIONALE_LIMITS });
    evidence('frozen-fixture', fixture);
    evidence('initial-report', report);
    const model = createOpenAIModel({ apiKey, fetchImpl: (url, requestOptions) => {
      const route = new URL(url).pathname;
      if (!['/v1/responses', '/v1/responses/input_tokens'].includes(route)) fail('invalid_live_route');
      return attempt.request(route.slice(3), requestOptions.body, { signal: requestOptions.signal });
    } });
    for (let index = 0; index < fixture.cases.length; index++) {
      const slot = report.cases[index];
      if (attempt.getState().halted) break;
      slot.status = 'running'; evidence(`case-${index}-started`, { caseId: slot.caseId });
      try {
        verifyBoundaries();
        const result = await runDecisionEvolutionCore({ fixture: { version: fixture.version, cases: [fixture.cases[index]] },
          modelFactory: () => model, naturalRationaleTrace: true, includeRationale: true, coldReopen: true });
        slot.result = result.cases[0];
        slot.substageCounts = substageCounts(slot.result);
        slot.status = attempt.getState().halted ? 'failed'
          : slot.result.incompleteCapture || Object.values(slot.substageCounts).some(count => count > 0)
            ? 'completed_with_failures' : 'completed';
      } catch { slot.status = 'failed'; slot.error = 'case_failed'; attempt.stop(); }
      evidence(`case-${index}-result`, slot);
    }
    report.status = attempt.getState().halted ? 'halted'
      : report.cases.every(item => item.status === 'completed') ? 'completed' : 'completed_with_failures';
  } catch {
    report.status = 'halted'; report.error = 'pilot_failed';
    if (attempt) attempt.stop();
  } finally {
    if (attempt) {
      try { await attempt.drain(); report.cleanup.drain = 'completed'; }
      catch { report.cleanup.drain = 'failed'; report.status = 'halted'; report.cleanupError = 'drain_failed'; }
    }
    try { report.budgetAfter = summary(ledger.getState()); } catch { report.status = 'halted'; report.accountingError = 'accounting_failed'; }
    if (attempt) report.attempt = attempt.getState();
    if (session) {
      try { session.close(); report.cleanup.sessionClose = 'completed'; }
      catch { report.cleanup.sessionClose = 'failed'; report.status = 'halted'; report.cleanupError = 'session_close_failed'; }
    }
    try { ledger.close(); report.cleanup.ledgerClose = 'completed'; }
    catch { report.cleanup.ledgerClose = 'failed'; report.status = 'halted'; report.cleanupError = 'ledger_close_failed'; }
    try { evidence('final-report', report); } catch { report.status = 'halted'; report.persistenceError = 'final_report_failed'; }
  }
  return redact(report);
}

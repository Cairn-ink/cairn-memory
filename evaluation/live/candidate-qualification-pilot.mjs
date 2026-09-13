import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { authorizeCandidateQualificationExtension } from '../experiment-budget/request-guard.mjs';
import { experimentPolicy } from './session.mjs';
import { createCandidateQualificationLiveSession } from './qualification-session.mjs';
import { createCandidateQualificationAttempt, CANDIDATE_QUALIFICATION_LIMITS } from './qualification-pilot-attempt.mjs';
import { getQualificationPilotPins } from './qualification-pilot.mjs';
import { inspectArtifact, privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';
import { startExperimentProxy } from './proxy.mjs';
import { readDiagnostics } from './diagnostics.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = 'candidate-qualification-heldout-v1';
const FIXTURE = 'evaluation/live/candidate-qualification-fixture.json';
const FIXTURE_SHA = 'acbf7efc39ffaece1f9ab93f870a47494530d4cdde37293ada671dfc201c6691';
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const canonicalPath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || realpathSync(value) !== value) fail('unsafe_candidate_path');
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('unsafe_candidate_path');
  return value;
};
const budget = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length,
  runId: state.runId, limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap, state: state.state });

export function getCandidateQualificationPilotPins() {
  return { ...getQualificationPilotPins(), ...Object.fromEntries([
    FIXTURE, 'evaluation/live/candidate-qualification-pilot.mjs',
    'evaluation/live/diagnostics.mjs',
  ].map(name => [name, createHash('sha256').update(readFileSync(canonicalPath(path.join(ROOT, name)))).digest('hex')])) };
}

export async function runCandidateQualificationPilot(options) {
  try { return await execute(options); }
  catch { fail('candidate_pilot_preflight_failed'); }
}

async function execute(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'apiKey', 'fetchImpl', 'nodePath',
    'cairnExecutable', 'cairnArtifact', 'cairnArtifactSha256', 'privateDirectory', 'pins'])) fail('invalid_options');
  const apiKey = options.apiKey, fetchImpl = options.fetchImpl;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function') fail('invalid_options');
  const ledgerOptions = structuredClone(options.ledger), expectedCheckpoint = structuredClone(options.expectedCheckpoint);
  const pins = structuredClone(options.pins), artifactSha256 = options.cairnArtifactSha256;
  const verifyPins = () => {
    const actual = getCandidateQualificationPilotPins();
    if (!exact(pins, Object.keys(actual)) || Object.keys(actual).some(name => actual[name] !== pins[name])
      || actual[FIXTURE] !== FIXTURE_SHA) fail('pin_mismatch');
  };
  verifyPins();
  const node = canonicalPath(options.nodePath); accessSync(node, constants.X_OK);
  const executable = canonicalPath(options.cairnExecutable), archive = canonicalPath(options.cairnArtifact);
  const directory = privateDirectory(canonicalPath(options.privateDirectory, true));
  canonicalPath(ledgerOptions.directory, true);
  const provenance = inspectArtifact(executable, archive, artifactSha256);
  const fixture = JSON.parse(readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
  const scrub = value => typeof value === 'string' ? value.replaceAll(apiKey, '[REDACTED-KEY]')
    : Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(apiKey, '[REDACTED-KEY]'), scrub(item)])) : value;
  const evidence = (name, value) => writeQualifiedEvidence(directory, name, scrub(value));
  const report = { version: 1, id: ID, status: 'not_run', semanticReviewRequired: true,
    limits: CANDIDATE_QUALIFICATION_LIMITS, pins, provenance, fixtureSha256: FIXTURE_SHA,
    budgetBefore: null, budgetAfter: null, attempt: null, traces: [],
    cases: fixture.cases.map(item => ({ id: item.id, status: 'not_run', capture: null, inspections: [],
      warmRecords: [], coldRecords: [], replay: null, diagnostics: null, traces: [] })) };
  const ledger = reopenExperimentBudget(ledgerOptions);
  let session, attempt, proxy, client, firstSent = false, activeRecord;
  try {
    const policyFile = canonicalPath(path.join(ledgerOptions.directory, 'experiment-request-policy.json'));
    if ((lstatSync(policyFile).mode & 0o777) !== 0o600) fail('unsafe_policy_binding');
    const binding = JSON.parse(readFileSync(policyFile, 'utf8'));
    if (!same(canonical(binding), canonical({ version: 1, runId: ledgerOptions.runId, policy: experimentPolicy() }))) fail('policy_mismatch');
    report.budgetBefore = budget(ledger.getState());
    attempt = createCandidateQualificationAttempt({ readState: () => ledger.getState(), expectedCheckpoint,
      checkPins: () => { verifyPins(); if (!firstSent) inspectArtifact(executable, archive, artifactSha256); },
      persist: evidence,
      send: async (route, body, requestOptions) => {
        if (!activeRecord || activeRecord.traces.length >= 6 || Buffer.byteLength(body) > 100000) fail('request_bounds');
        const trace = { caseId: activeRecord.id, sequence: activeRecord.traces.length + 1, method: JSON.parse(body).text.format.name,
          requestBody: JSON.parse(body), providerResponse: null, responseAvailable: false };
        activeRecord.traces.push(trace);
        report.traces.push(trace);
        const prefix = `case-${report.cases.indexOf(activeRecord)}-trace-${trace.sequence}`;
        evidence(`${prefix}-request`, trace);
        verifyPins(); if (!firstSent) inspectArtifact(executable, archive, artifactSha256);
        firstSent = true;
        const response = await session.request(route, body, requestOptions);
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        if (bytes.byteLength > 262144) fail('response_bounds');
        trace.providerResponse = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        trace.responseAvailable = true; evidence(`${prefix}-response`, trace);
        return response;
      } });
    verifyPins(); inspectArtifact(executable, archive, artifactSha256);
    writeQualifiedEvidence(ledgerOptions.directory, `${ID}-intent`, { version: 1, id: ID,
      expectedCheckpoint, pins, artifactSha256, limits: report.limits });
    evidence('initial-report', report);
    const candidateQualificationExtension = authorizeCandidateQualificationExtension({ ledger: ledgerOptions,
      policy: experimentPolicy(), authorizationId: ID });
    session = createCandidateQualificationLiveSession({ ledger: ledgerOptions, candidateQualificationExtension, apiKey, fetchImpl });
    proxy = await startExperimentProxy({ session: { request: attempt.request } });
    const requireDriver = createRequire(path.join(ROOT, 'adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client')).href);
    const { StdioClientTransport } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client/stdio')).href);
    const openClient = async (item, configFile) => {
      const transport = new StdioClientTransport({ command: node,
        args: [path.join(ROOT, 'evaluation/live/cairn-launcher.mjs'), '--db', path.join(directory, `${item.id}.sqlite`),
          '--owner', 'synthetic-candidate-qualification', '--project', item.id,
          '--capture-qualification', 'source-bound-v2'],
        env: { OPENAI_API_KEY: proxy.token, CAIRN_LIVE_CONFIG: configFile, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' });
      client = new Client({ name: 'synthetic-candidate-qualification', version: '1.0.0' });
      await client.connect(transport); return client;
    };
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args }, { timeout: 125000 });
      if (response?.content?.length !== 1 || response.content[0].type !== 'text') fail('invalid_mcp_response');
      const envelope = JSON.parse(response.content[0].text);
      if (typeof envelope?.ok !== 'boolean' || Boolean(response.isError) !== !envelope.ok
        || envelope.evidenceTrust !== 'untrusted-data-not-instructions') fail('invalid_mcp_response');
      return envelope;
    };
    const inspect = async ids => {
      const records = [];
      for (const memoryId of ids) {
        const result = await call('inspect_memory', { memoryId, includeQualification: true });
        if (!result.ok || !result.value?.qualification) fail('inspection_failed');
        records.push(result);
      }
      return records;
    };
    for (let index = 0; index < fixture.cases.length; index++) {
      if (attempt.getState().halted) break;
      const item = fixture.cases[index], record = report.cases[index]; activeRecord = record;
      const diagnosticDirectory = path.join(directory, `case-${index}-diagnostics`);
      mkdirSync(diagnosticDirectory, { mode: 0o700 });
      const configName = `case-${index}-transport`, configFile = path.join(directory, `${configName}.json`);
      evidence(configName, { version: 1, packageRoot: provenance.packageRoot, proxyUrl: proxy.url, diagnosticDirectory });
      record.status = 'running';
      await openClient(item, configFile);
      const args = { batchId: `${ID}-${index}`, messages: item.messages };
      record.capture = await call('capture_memory', args); evidence(`case-${index}-capture`, record.capture);
      await attempt.drain();
      if (!record.capture.ok) {
        record.status = 'failed';
        if (attempt.getState().halted || !['invalid_model_output', 'context_budget_exceeded'].includes(record.capture.error?.code)) fail('capture_failed');
      } else {
        const admitted = record.capture.value?.admission?.memories;
        if (!Array.isArray(admitted) || admitted.length > 5) fail('invalid_mcp_response');
        const ids = admitted.map(memory => memory.id);
        record.inspections = await inspect(ids); record.warmRecords = record.inspections;
        record.status = !ids.length ? 'empty_admission'
          : record.capture.value.classification?.status === 'failed' ? 'classification_failed' : 'completed';
        if (attempt.getState().halted) fail('capture_failed');
        await client.close(); client = null;
        attempt.beginReadOnly(); await openClient(item, configFile);
        record.coldRecords = await inspect(ids);
        if (!same(record.warmRecords, record.coldRecords)) fail('cold_evidence_mismatch');
        record.replay = await call('capture_memory', args);
        if (!record.replay.ok || record.replay.value?.duplicate !== true || !same(record.replay.value.memoryIds, ids)) fail('replay_mismatch');
        await client.close(); client = null;
        await attempt.drain(); attempt.endReadOnly();
      }
      if (client) { await client.close(); client = null; }
      record.diagnostics = readDiagnostics(diagnosticDirectory); evidence(`case-${index}-result`, record);
    }
    report.status = attempt.getState().halted ? 'halted'
      : report.cases.every(record => record.status === 'completed') ? 'completed' : 'completed_with_failures';
  } catch {
    report.status = 'halted'; report.error = 'candidate_pilot_failed';
    if (activeRecord) activeRecord.status = 'failed';
    if (attempt) attempt.stop();
  } finally {
    try { if (client) await client.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { if (proxy) await proxy.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    if (attempt) await attempt.drain();
    if (activeRecord && !activeRecord.diagnostics) activeRecord.diagnostics = readDiagnostics(
      path.join(directory, `case-${report.cases.indexOf(activeRecord)}-diagnostics`));
    report.attempt = attempt?.getState() ?? null;
    try { report.budgetAfter = budget(ledger.getState()); } catch { report.status = 'halted'; report.accountingError = 'accounting_failed'; }
    try { if (session) session.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { ledger.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { evidence('final-report', report); } catch { report.status = 'halted'; report.evidenceError = 'persistence_failed'; }
  }
  return scrub(report);
}

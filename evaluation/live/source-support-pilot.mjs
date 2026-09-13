import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { experimentPolicy } from './session.mjs';
import { createSourceSupportLiveSession } from './qualification-session.mjs';
import { createSourceSupportAttempt, SOURCE_SUPPORT_LIMITS } from './qualification-pilot-attempt.mjs';
import { getQualificationPilotPins } from './qualification-pilot.mjs';
import { inspectArtifact, privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';
import { startExperimentProxy } from './proxy.mjs';
import { readDiagnostics } from './diagnostics.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = 'source-support-v1';
const FIXTURE = 'evaluation/live/source-support-fixture.json';
const FIXTURE_SHA = 'de75ff41fb0f4fac8c81f19dfad4d4a6456c42b63681ac47316e36e185576284';
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const canonicalPath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || realpathSync(value) !== value) fail('unsafe_source_support_path');
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('unsafe_source_support_path');
  return value;
};
const budget = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length,
  runId: state.runId, limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap, state: state.state });

export function getSourceSupportPilotPins() {
  return { ...getQualificationPilotPins(), ...Object.fromEntries([
    FIXTURE, 'evaluation/live/source-support-pilot.mjs',
    'evaluation/live/diagnostics.mjs',
  ].map(name => [name, createHash('sha256').update(readFileSync(canonicalPath(path.join(ROOT, name)))).digest('hex')])) };
}

export async function runSourceSupportPilot(options) {
  try { return await execute(options); }
  catch { fail('source_support_pilot_preflight_failed'); }
}

async function execute(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'apiKey', 'fetchImpl', 'nodePath',
    'cairnExecutable', 'cairnArtifact', 'cairnArtifactSha256', 'privateDirectory', 'pins', 'candidateQualificationExtension'])) fail('invalid_options');
  const apiKey = options.apiKey, fetchImpl = options.fetchImpl;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function') fail('invalid_options');
  const ledgerOptions = structuredClone(options.ledger), expectedCheckpoint = structuredClone(options.expectedCheckpoint);
  const candidateQualificationExtension = structuredClone(options.candidateQualificationExtension);
  if (candidateQualificationExtension?.authorizationId !== 'candidate-qualification-heldout-v1') fail('invalid_capability');
  const pins = structuredClone(options.pins), artifactSha256 = options.cairnArtifactSha256;
  const verifyPins = () => {
    const actual = getSourceSupportPilotPins();
    if (!exact(pins, Object.keys(actual)) || Object.keys(actual).some(name => actual[name] !== pins[name])
      || actual[FIXTURE] !== FIXTURE_SHA) fail('pin_mismatch');
  };
  verifyPins();
  const node = canonicalPath(options.nodePath); accessSync(node, constants.X_OK);
  const executable = canonicalPath(options.cairnExecutable), archive = canonicalPath(options.cairnArtifact);
  const directory = privateDirectory(canonicalPath(options.privateDirectory, true));
  canonicalPath(ledgerOptions.directory, true);
  const provenance = inspectArtifact(executable, archive, artifactSha256);
  const capabilityFile = canonicalPath(path.join(ledgerOptions.directory, 'experiment-candidate-qualification-extension.json'));
  const capabilityBytes = readFileSync(capabilityFile);
  const capabilitySha256 = createHash('sha256').update(capabilityBytes).digest('hex');
  if ((lstatSync(capabilityFile).mode & 0o777) !== 0o600
    || !same(canonical(JSON.parse(capabilityBytes)), canonical(candidateQualificationExtension))) fail('invalid_capability');
  const verifyCapability = () => {
    canonicalPath(capabilityFile);
    if ((lstatSync(capabilityFile).mode & 0o777) !== 0o600 || !readFileSync(capabilityFile).equals(capabilityBytes)) fail('capability_changed');
  };
  const fixture = JSON.parse(readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
  const scrub = value => typeof value === 'string' ? value.replaceAll(apiKey, '[REDACTED-KEY]')
    : Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(apiKey, '[REDACTED-KEY]'), scrub(item)])) : value;
  const evidence = (name, value) => writeQualifiedEvidence(directory, name, scrub(value));
  const report = { version: 1, id: ID, status: 'not_run', semanticReviewRequired: true,
    limits: SOURCE_SUPPORT_LIMITS, pins, provenance, fixtureSha256: FIXTURE_SHA, capabilitySha256,
    budgetBefore: null, budgetAfter: null, attempt: null, traces: [],
    cases: fixture.cases.map(item => ({ id: item.id, status: 'not_run', capture: null, recall: null,
      captureStatus: 'not_run', recallStatus: 'not_run', coldStatus: 'not_run', inspections: [],
      warmRecords: [], coldRecords: [], replay: null, diagnostics: null, traces: [] })) };
  const ledger = reopenExperimentBudget(ledgerOptions);
  let session, attempt, proxy, client, firstSent = false, activeRecord, activePhase = null;
  try {
    const policyFile = canonicalPath(path.join(ledgerOptions.directory, 'experiment-request-policy.json'));
    if ((lstatSync(policyFile).mode & 0o777) !== 0o600) fail('unsafe_policy_binding');
    const binding = JSON.parse(readFileSync(policyFile, 'utf8'));
    if (!same(canonical(binding), canonical({ version: 1, runId: ledgerOptions.runId, policy: experimentPolicy() }))) fail('policy_mismatch');
    report.budgetBefore = budget(ledger.getState());
    attempt = createSourceSupportAttempt({ readState: () => ledger.getState(), expectedCheckpoint,
      checkPins: () => { verifyPins(); verifyCapability(); if (!firstSent) inspectArtifact(executable, archive, artifactSha256); },
      persist: evidence,
      send: async (route, body, requestOptions) => {
        if (!activeRecord || !['capture', 'recall'].includes(activePhase)
          || activeRecord.traces.filter(trace => trace.phase === activePhase).length >= 6
          || Buffer.byteLength(body) > 100000) fail('request_bounds');
        const method = JSON.parse(body).text?.format?.name;
        if (!(activePhase === 'capture' ? ['cairn_extract', 'cairn_qualifyCandidates', 'cairn_classify']
          : ['cairn_select', 'cairn_rank']).includes(method)) fail('phase_method_mismatch');
        const trace = { caseId: activeRecord.id, phase: activePhase, sequence: activeRecord.traces.length + 1, method: JSON.parse(body).text.format.name,
          requestBody: JSON.parse(body), providerResponse: null, responseAvailable: false };
        activeRecord.traces.push(trace);
        report.traces.push(trace);
        const prefix = `case-${report.cases.indexOf(activeRecord)}-trace-${trace.sequence}`;
        evidence(`${prefix}-request`, trace);
        verifyPins(); verifyCapability(); if (!firstSent) inspectArtifact(executable, archive, artifactSha256);
        firstSent = true;
        const response = await session.request(route, body, requestOptions);
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        if (bytes.byteLength > 262144) fail('response_bounds');
        trace.providerResponse = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        trace.responseAvailable = true; evidence(`${prefix}-response`, trace);
        return response;
      } });
    verifyPins(); verifyCapability(); inspectArtifact(executable, archive, artifactSha256);
    // Construction verifies the existing capability; never provision a missing one.
    session = createSourceSupportLiveSession({ ledger: ledgerOptions, candidateQualificationExtension, apiKey, fetchImpl });
    writeQualifiedEvidence(ledgerOptions.directory, `${ID}-intent`, { version: 1, id: ID,
      expectedCheckpoint, pins, artifactSha256, capabilitySha256, limits: report.limits });
    evidence('initial-report', report);
    evidence('frozen-fixture', fixture);
    proxy = await startExperimentProxy({ session: { request: attempt.request } });
    const requireDriver = createRequire(path.join(ROOT, 'adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client')).href);
    const { StdioClientTransport } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client/stdio')).href);
    const openClient = async (item, configFile) => {
      const transport = new StdioClientTransport({ command: node,
        args: [path.join(ROOT, 'evaluation/live/cairn-launcher.mjs'), '--db', path.join(directory, `${item.id}.sqlite`),
          '--owner', 'synthetic-source-support', '--project', item.id,
          '--capture-qualification', 'source-bound-v2'],
        env: { OPENAI_API_KEY: proxy.token, CAIRN_LIVE_CONFIG: configFile, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' });
      client = new Client({ name: 'synthetic-source-support', version: '1.0.0' });
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
      record.status = 'running'; record.captureStatus = 'running'; activePhase = 'capture';
      await openClient(item, configFile);
      const args = { batchId: `${ID}-${index}`, messages: item.messages };
      record.capture = await call('capture_memory', args); evidence(`case-${index}-capture`, record.capture);
      await attempt.drain();
      if (!record.capture.ok) {
        record.status = 'capture_failed'; record.captureStatus = 'failed';
        if (attempt.getState().halted || !['invalid_model_output', 'context_budget_exceeded'].includes(record.capture.error?.code)) fail('capture_failed');
      } else {
        const admitted = record.capture.value?.admission?.memories;
        if (!Array.isArray(admitted) || admitted.length > 5) fail('invalid_mcp_response');
        const ids = admitted.map(memory => memory.id);
        record.inspections = await inspect(ids); record.warmRecords = record.inspections;
        record.captureStatus = !ids.length ? 'empty_admission'
          : record.capture.value.classification?.status === 'failed' ? 'classification_failed' : 'completed';
        if (ids.length) {
          activePhase = 'recall'; record.recallStatus = 'running';
          record.recall = await call('recall_memory', { query: item.query, includeQualification: true });
          evidence(`case-${index}-recall`, record.recall);
          await attempt.drain();
          if (!record.recall.ok) {
            record.recallStatus = 'failed';
            if (attempt.getState().halted || !['invalid_model_output', 'context_budget_exceeded'].includes(record.recall.error?.code)) fail('recall_failed');
          } else {
            const recalled = record.recall.value?.memories;
            if (!Array.isArray(recalled) || recalled.some(memory => !ids.includes(memory.memory?.id)
              || !Object.hasOwn(memory, 'qualification') || !memory.qualification)) fail('invalid_recall_response');
            record.recallStatus = recalled.length ? 'completed' : 'empty_recall';
          }
        }
        record.status = record.captureStatus === 'completed' && record.recallStatus === 'completed'
          ? 'completed' : 'completed_with_failures';
        if (attempt.getState().halted) fail('capture_failed');
        await client.close(); client = null;
        activePhase = null; record.coldStatus = 'running';
        attempt.beginReadOnly(); await openClient(item, configFile);
        record.coldRecords = await inspect(ids);
        if (!same(record.warmRecords, record.coldRecords)) fail('cold_evidence_mismatch');
        record.replay = await call('capture_memory', args);
        if (!record.replay.ok || record.replay.value?.duplicate !== true || !same(record.replay.value.memoryIds, ids)
          || !same(record.replay.value.retainedSourceWindow, record.capture.value.retainedSourceWindow)) fail('replay_mismatch');
        await client.close(); client = null;
        await attempt.drain(); attempt.endReadOnly(); record.coldStatus = 'completed';
      }
      if (client) { await client.close(); client = null; }
      record.diagnostics = readDiagnostics(diagnosticDirectory); evidence(`case-${index}-result`, record);
    }
    report.status = attempt.getState().halted ? 'halted'
      : report.cases.every(record => record.status === 'completed') ? 'completed' : 'completed_with_failures';
  } catch {
    report.status = 'halted'; report.error = 'source_support_pilot_failed';
    if (activeRecord) {
      activeRecord.status = 'failed';
      for (const field of ['captureStatus', 'recallStatus', 'coldStatus']) if (activeRecord[field] === 'running') activeRecord[field] = 'failed';
    }
    if (attempt) attempt.stop();
  } finally {
    try { if (client) await client.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { if (proxy) await proxy.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    if (attempt) await attempt.drain();
    if (activeRecord && !activeRecord.diagnostics) activeRecord.diagnostics = readDiagnostics(
      path.join(directory, `case-${report.cases.indexOf(activeRecord)}-diagnostics`));
    report.attempt = attempt?.getState() ?? null;
    try { verifyCapability(); } catch { report.status = 'halted'; report.capabilityError = 'capability_changed'; }
    try { report.budgetAfter = budget(ledger.getState()); } catch { report.status = 'halted'; report.accountingError = 'accounting_failed'; }
    try { if (session) session.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { ledger.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { evidence('final-report', report); } catch { report.status = 'halted'; report.evidenceError = 'persistence_failed'; }
  }
  return scrub(report);
}

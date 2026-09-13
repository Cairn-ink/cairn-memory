import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { createQualificationLiveSession } from './qualification-session.mjs';
import { createQualificationPilotAttempt } from './qualification-pilot-attempt.mjs';
import { getQualificationPilotPins } from './qualification-pilot.mjs';
import { inspectArtifact, privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';
import { startExperimentProxy } from './proxy.mjs';
import { readDiagnostics } from './diagnostics.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = 'qualification-diagnostic-v1';
const MESSAGE = Object.freeze({ role: 'user', content: 'For my personal reading notes, use short numbered lists.' });
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonicalPath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || realpathSync(value) !== value) fail('unsafe_diagnostic_path');
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('unsafe_diagnostic_path');
  return value;
};
const budget = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length,
  runId: state.runId, limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap, state: state.state });

export function getQualificationDiagnosticPins() {
  return { ...getQualificationPilotPins(), ...Object.fromEntries([
    'evaluation/live/qualification-diagnostic.mjs', 'evaluation/live/diagnostics.mjs',
  ].map(name => [name, createHash('sha256').update(readFileSync(canonicalPath(path.join(ROOT, name)))).digest('hex')])) };
}

export async function runQualificationDiagnostic(options) {
  try { return await execute(options); }
  catch { fail('diagnostic_preflight_failed'); }
}

async function execute(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'qualificationExtension', 'apiKey', 'fetchImpl',
    'nodePath', 'cairnExecutable', 'cairnArtifact', 'cairnArtifactSha256', 'privateDirectory', 'pins'])) fail('invalid_options');
  const apiKey = options.apiKey, fetchImpl = options.fetchImpl;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function') fail('invalid_options');
  const ledgerOptions = structuredClone(options.ledger);
  const expectedCheckpoint = structuredClone(options.expectedCheckpoint);
  const qualificationExtension = structuredClone(options.qualificationExtension);
  const pins = structuredClone(options.pins), artifactSha256 = options.cairnArtifactSha256;
  const verifyPins = () => {
    const actual = getQualificationDiagnosticPins();
    if (!exact(pins, Object.keys(actual)) || Object.keys(actual).some(name => actual[name] !== pins[name])) fail('pin_mismatch');
  };
  verifyPins();
  const node = canonicalPath(options.nodePath); accessSync(node, constants.X_OK);
  const executable = canonicalPath(options.cairnExecutable), archive = canonicalPath(options.cairnArtifact);
  const directory = privateDirectory(canonicalPath(options.privateDirectory, true));
  canonicalPath(ledgerOptions.directory, true);
  const provenance = inspectArtifact(executable, archive, artifactSha256);
  const diagnosticDirectory = path.join(directory, 'diagnostics');
  // Normally no credential is present in payloads. Also protect evidence if a
  // faulty injected provider echoes it; never serialize credential-bearing text.
  const scrub = value => typeof value === 'string' ? value.replaceAll(apiKey, '[REDACTED-KEY]')
    : Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(apiKey, '[REDACTED-KEY]'), scrub(item)])) : value;
  const evidence = (name, value) => {
    writeQualifiedEvidence(directory, name, scrub(value));
  };
  const report = { version: 1, id: ID, status: 'not_run', source: MESSAGE, semanticReviewRequired: true,
    limits: { requests: 6, microUsd: 30000 }, pins, provenance, capture: null, inspections: [],
    diagnostics: null, traces: [], budgetBefore: null, budgetAfter: null, attempt: null };
  const ledger = reopenExperimentBudget(ledgerOptions);
  let session, attempt, proxy, client, firstSent = false, requests = 0;
  try {
    session = createQualificationLiveSession({ ledger: ledgerOptions, qualificationExtension, apiKey, fetchImpl });
    report.budgetBefore = budget(ledger.getState());
    attempt = createQualificationPilotAttempt({ readState: () => ledger.getState(), expectedCheckpoint,
      checkPins: () => { verifyPins(); if (!firstSent) inspectArtifact(executable, archive, artifactSha256); },
      persist: evidence,
      send: async (route, body, requestOptions) => {
        if (report.traces.length >= 6) fail('diagnostic_request_cap');
        const trace = { sequence: report.traces.length + 1, method: JSON.parse(body).text.format.name,
          requestBody: JSON.parse(body), providerResponse: null, responseAvailable: false };
        if (Buffer.byteLength(body) > 100000) fail('request_bounds');
        report.traces.push(trace);
        evidence(`trace-${trace.sequence}-request`, trace);
        verifyPins();
        if (!firstSent) inspectArtifact(executable, archive, artifactSha256);
        firstSent = true;
        const response = await session.request(route, body, requestOptions);
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        if (bytes.byteLength > 262144) fail('response_bounds');
        trace.providerResponse = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        trace.responseAvailable = true;
        evidence(`trace-${trace.sequence}-response`, trace);
        return response;
      } });
    writeQualifiedEvidence(ledgerOptions.directory, `${ID}-intent`, { version: 1, id: ID,
      expectedCheckpoint, pins, artifactSha256, limits: report.limits });
    evidence('initial-report', report);
    mkdirSync(diagnosticDirectory, { mode: 0o700 });
    proxy = await startExperimentProxy({ session: { request: (...args) => {
      if (requests >= 6) { attempt.stop(); return Promise.reject(new Error('diagnostic_request_cap')); }
      requests++;
      return attempt.request(...args);
    } } });
    evidence('transport', { version: 1, packageRoot: provenance.packageRoot, proxyUrl: proxy.url, diagnosticDirectory });
    const requireDriver = createRequire(path.join(ROOT, 'adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client')).href);
    const { StdioClientTransport } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client/stdio')).href);
    const transport = new StdioClientTransport({ command: node,
      args: [path.join(ROOT, 'evaluation/live/cairn-launcher.mjs'), '--db', path.join(directory, 'memory.sqlite'),
        '--owner', 'synthetic-qualification-diagnostic', '--project', ID,
        '--capture-qualification', 'source-bound-v1'],
      env: { OPENAI_API_KEY: proxy.token, CAIRN_LIVE_CONFIG: path.join(directory, 'transport.json'), NODE_NO_WARNINGS: '1' }, stderr: 'ignore' });
    client = new Client({ name: 'synthetic-qualification-diagnostic', version: '1.0.0' });
    await client.connect(transport);
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args }, { timeout: 125000 });
      if (response?.content?.length !== 1 || response.content[0].type !== 'text') fail('invalid_mcp_response');
      const envelope = JSON.parse(response.content[0].text);
      if (typeof envelope?.ok !== 'boolean' || Boolean(response.isError) !== !envelope.ok
        || envelope.evidenceTrust !== 'untrusted-data-not-instructions') fail('invalid_mcp_response');
      return envelope;
    };
    report.status = 'running';
    report.capture = await call('capture_memory', { batchId: ID, messages: [MESSAGE] });
    evidence('capture', report.capture);
    await attempt.drain(); attempt.beginReadOnly();
    if (report.capture.ok) {
      const memories = report.capture.value?.admission?.memories;
      if (!Array.isArray(memories) || memories.length > 5) fail('invalid_mcp_response');
      for (const memory of memories) {
        const result = await call('inspect_memory', { memoryId: memory.id, includeQualification: true });
        report.inspections.push(result);
        if (!result.ok || !result.value?.qualification) fail('inspection_failed');
      }
      report.status = memories.length && report.capture.value.classification?.status !== 'failed' ? 'completed' : 'failed';
    } else report.status = 'failed';
    if (attempt.getState().halted) report.status = 'halted';
  } catch {
    report.status = 'halted'; report.error = 'diagnostic_failed';
    if (attempt) attempt.stop();
  } finally {
    try { if (client) await client.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { if (proxy) await proxy.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    if (attempt) await attempt.drain();
    report.diagnostics = readDiagnostics(diagnosticDirectory);
    report.attempt = attempt?.getState() ?? null;
    try { report.budgetAfter = budget(ledger.getState()); } catch { report.status = 'halted'; report.accountingError = 'accounting_failed'; }
    try { if (session) session.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { ledger.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { evidence('final-report', report); } catch { report.status = 'halted'; report.evidenceError = 'persistence_failed'; }
  }
  return scrub(report);
}

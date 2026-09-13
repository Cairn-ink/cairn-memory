import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { authorizeQualificationExtension } from '../experiment-budget/request-guard.mjs';
import { createQualificationLiveSession } from './qualification-session.mjs';
import { experimentPolicy } from './session.mjs';
import { startExperimentProxy } from './proxy.mjs';
import { inspectArtifact, privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';
import { createQualificationPilotAttempt } from './qualification-pilot-attempt.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = 'evaluation/live/qualification-pilot-fixture.json';
const FIXTURE_SHA = '2f9859d309b145253bb6b37060a0723111045a0f9ad50ad42e095343ba40fec5';
export const QUALIFICATION_PILOT_PIN_FILES = Object.freeze([
  FIXTURE, 'evaluation/live/qualification-pilot.mjs', 'evaluation/live/qualification-pilot-attempt.mjs',
  'evaluation/live/qualification-session.mjs', 'evaluation/live/session.mjs',
  'evaluation/live/proxy.mjs', 'evaluation/live/cairn-launcher.mjs',
  'evaluation/live/installed-capture-support.mjs', 'evaluation/live/qualified-attempt.mjs',
  'evaluation/experiment-budget/request-guard.mjs', 'evaluation/experiment-budget/index.mjs',
  'adapters/openai/index.mjs', 'adapters/openai/profiles.mjs', 'adapters/openai/schemas.mjs',
  'adapters/openai/package.json', 'adapters/openai/package-lock.json',
  'adapters/mcp/package.json', 'adapters/mcp/package-lock.json',
  'core/validation.mjs', 'core/model-diagnostics.mjs', 'plugins/cairn-memory/lib/redact.mjs',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const checkpoint = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd });
const summary = state => ({ ...checkpoint(state), runId: state.runId, limitMicroUsd: state.limitMicroUsd,
  requestCap: state.requestCap, state: state.state,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length });
const canonicalPath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || realpathSync(value) !== value) fail('unsafe_pilot_path');
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('unsafe_pilot_path');
  return value;
};

export function getQualificationPilotPins() {
  return Object.fromEntries(QUALIFICATION_PILOT_PIN_FILES.map(name =>
    [name, hash(readFileSync(canonicalPath(path.join(ROOT, name))))]));
}

/** Explicit one-shot entry point. Imports never discover credentials or execute a pilot. */
export async function runQualificationPilot(options) {
  try { return await executeQualificationPilot(options); }
  catch (error) {
    const code = ['invalid_pilot_options', 'invalid_pilot_pins', 'pilot_pin_mismatch', 'unsafe_pilot_path',
      'unsafe_private_directory', 'invalid_cairn_artifact', 'unpinned_cairn_artifact', 'cairn_install_source_mismatch']
      .includes(error?.message) ? error.message : 'pilot_preflight_failed';
    fail(code);
  }
}

async function executeQualificationPilot(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'apiKey', 'fetchImpl', 'nodePath',
    'cairnExecutable', 'cairnArtifact', 'cairnArtifactSha256', 'privateDirectory', 'pins'])) fail('invalid_pilot_options');
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl;
  const artifactSha256 = options.cairnArtifactSha256;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey)
    || typeof fetchImpl !== 'function') fail('invalid_pilot_options');
  const ledgerOptions = structuredClone(options.ledger);
  const expectedCheckpoint = structuredClone(options.expectedCheckpoint);
  const pins = structuredClone(options.pins);
  if (!exact(pins, QUALIFICATION_PILOT_PIN_FILES)
    || Object.values(pins).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))) fail('invalid_pilot_pins');
  const verifyPins = () => {
    const current = getQualificationPilotPins();
    if (QUALIFICATION_PILOT_PIN_FILES.some(name => current[name] !== pins[name]) || current[FIXTURE] !== FIXTURE_SHA) fail('pilot_pin_mismatch');
  };
  verifyPins();
  const node = canonicalPath(options.nodePath);
  accessSync(node, constants.X_OK);
  const executable = canonicalPath(options.cairnExecutable);
  const archive = canonicalPath(options.cairnArtifact);
  const directory = privateDirectory(canonicalPath(options.privateDirectory, true));
  canonicalPath(ledgerOptions.directory, true);
  const provenance = inspectArtifact(executable, archive, artifactSha256);
  canonicalPath(provenance.packageRoot, true);
  const fixture = JSON.parse(readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
  const evidence = (name, value) => writeQualifiedEvidence(directory, name, value);
  const ledger = reopenExperimentBudget(ledgerOptions);
  let session, proxy, attempt, activeClient;
  const report = { version: 1, id: 'qualification-pilot-v1', status: 'not_run', semanticReviewRequired: true,
    fixtureSha256: FIXTURE_SHA, pins, provenance, budgetBefore: null, budgetAfter: null,
    cases: fixture.cases.map(item => ({ id: item.id, status: 'not_run',
      events: { initial: { status: 'not_run' }, later: { status: 'not_run' } } })) };
  try {
    // Validate bound policy without initializing it or altering the existing ledger.
    const policyFile = canonicalPath(path.join(ledgerOptions.directory, 'experiment-request-policy.json'));
    if ((lstatSync(policyFile).mode & 0o777) !== 0o600) fail('unsafe_policy_binding');
    const binding = JSON.parse(readFileSync(policyFile, 'utf8'));
    if (!same(canonical(binding), canonical({ version: 1, runId: ledgerOptions.runId, policy: experimentPolicy() }))) fail('policy_mismatch');
    report.budgetBefore = summary(ledger.getState());
    let firstRequestSent = false;
    attempt = createQualificationPilotAttempt({ readState: () => ledger.getState(), expectedCheckpoint,
      checkPins: () => {
        verifyPins();
        if (!firstRequestSent) inspectArtifact(executable, archive, artifactSha256);
      }, persist: evidence,
      send: (...args) => { firstRequestSent = true; return session.request(...args); } });
    verifyPins();
    inspectArtifact(executable, archive, artifactSha256);
    writeQualifiedEvidence(ledgerOptions.directory, 'qualification-pilot-v1-intent', {
      version: 1, id: 'qualification-pilot-v1', expectedCheckpoint, pins,
      artifactSha256: provenance.artifactSha256, limits: { requests: 100, microUsd: 1_000_000 } });
    evidence('initial-report', report);
    const qualificationExtension = authorizeQualificationExtension({ ledger: ledgerOptions,
      policy: experimentPolicy(), authorizationId: 'qualification-pilot-v1' });
    session = createQualificationLiveSession({ ledger: ledgerOptions, apiKey,
      qualificationExtension, fetchImpl });
    proxy = await startExperimentProxy({ session: { request: attempt.request } });
    const configFile = path.join(directory, 'transport.json');
    evidence('transport', { version: 1, packageRoot: provenance.packageRoot, proxyUrl: proxy.url });
    // The driver is maintainer tooling; the installed artifact intentionally
    // contains only the server. Its real server/adapter still run in the child.
    const requireDriver = createRequire(path.join(ROOT, 'adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client')).href);
    const { StdioClientTransport } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client/stdio')).href);
    const openClient = async item => {
      const transport = new StdioClientTransport({ command: node,
        args: [path.join(ROOT, 'evaluation/live/cairn-launcher.mjs'), '--db', path.join(directory, `${item.id}.sqlite`),
          '--owner', 'synthetic-qualification-pilot', '--project', item.id,
          '--capture-qualification', 'source-bound-v1'],
        env: { OPENAI_API_KEY: proxy.token, CAIRN_LIVE_CONFIG: configFile, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' });
      const client = new Client({ name: 'synthetic-qualification-pilot', version: '1.0.0' });
      activeClient = client;
      await client.connect(transport);
      return client;
    };
    const call = async (client, name, args) => {
      const response = await client.callTool({ name, arguments: args }, { timeout: 125000 });
      if (response?.content?.length !== 1 || response.content[0].type !== 'text') fail('invalid_mcp_response');
      const envelope = JSON.parse(response.content[0].text);
      if (typeof envelope?.ok !== 'boolean' || Boolean(response.isError) !== !envelope.ok
        || envelope.evidenceTrust !== 'untrusted-data-not-instructions') fail('invalid_mcp_response');
      return envelope;
    };
    const inspect = async (client, ids) => {
      const records = [];
      for (const memoryId of ids) {
        const envelope = await call(client, 'inspect_memory', { memoryId, includeQualification: true });
        if (!envelope.ok || !envelope.value?.qualification) fail('inspection_failed');
        records.push(envelope);
      }
      return records;
    };
    for (let index = 0; index < fixture.cases.length; index++) {
      const item = fixture.cases[index], record = report.cases[index];
      if (attempt.getState().halted) break;
      record.status = 'running';
      let client = await openClient(item);
      const ids = new Set();
      for (const stage of ['initial', 'later']) {
        const event = record.events[stage];
        const args = { batchId: `${item.id}-${stage}`, messages: item[stage] };
        event.status = 'attempted';
        event.capture = await call(client, 'capture_memory', args);
        evidence(`case-${index}-${stage}-capture`, event.capture);
        if (!event.capture.ok) {
          event.status = 'failed'; record.status = 'failed';
          const code = event.capture.error?.code;
          if (attempt.getState().halted || !['invalid_model_output', 'context_budget_exceeded',
            'qualification_conflict'].includes(code)) fail('capture_failed');
          break;
        }
        event.status = 'completed';
        const admitted = event.capture.value?.admission?.memories;
        if (!Array.isArray(admitted) || admitted.length > 5) fail('invalid_mcp_response');
        for (const memory of admitted) ids.add(memory.id);
        event.inspections = await inspect(client, admitted.map(memory => memory.id));
        if (!admitted.length) { event.status = 'empty_admission'; record.status = 'failed'; break; }
        if (event.capture.value.classification?.status === 'failed') {
          event.status = 'classification_failed'; record.status = 'failed';
          if (attempt.getState().halted) fail('capture_failed');
          break;
        }
      }
      record.warmRecords = await inspect(client, [...ids]);
      await client.close(); activeClient = null;
      await attempt.drain(); attempt.beginReadOnly();
      client = await openClient(item);
      record.coldRecords = await inspect(client, [...ids]);
      if (!same(record.warmRecords, record.coldRecords)) fail('cold_evidence_mismatch');
      for (const stage of ['initial', 'later']) {
        const event = record.events[stage];
        if (!event.capture?.ok) continue;
        event.replay = await call(client, 'capture_memory', { batchId: `${item.id}-${stage}`, messages: item[stage] });
        if (!event.replay.ok || event.replay.value?.duplicate !== true
          || !same(event.replay.value.memoryIds, event.capture.value.admission.memories.map(memory => memory.id))) fail('replay_mismatch');
      }
      await client.close(); activeClient = null;
      await attempt.drain(); attempt.endReadOnly();
      if (record.status === 'running') record.status = 'completed';
      evidence(`case-${index}-result`, record);
    }
    report.status = attempt.getState().halted ? 'halted'
      : report.cases.every(item => item.status === 'completed') ? 'completed' : 'completed_with_failures';
  } catch {
    report.status = 'halted'; report.error = 'pilot_failed';
    for (const record of report.cases) if (record.status === 'running') {
      record.status = 'failed';
      for (const event of Object.values(record.events)) if (event.status === 'attempted') {
        event.status = 'failed'; event.error = 'pilot_failed';
      }
    }
    if (attempt) attempt.stop();
  } finally {
    try { if (activeClient) await activeClient.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { if (proxy) await proxy.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { if (attempt) await attempt.drain(); } catch { report.status = 'halted'; }
    try { report.budgetAfter = summary(ledger.getState()); } catch { report.status = 'halted'; report.accountingError = 'accounting_failed'; }
    report.attempt = attempt?.getState() ?? null;
    try { if (session) session.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { ledger.close(); } catch { report.status = 'halted'; report.cleanupError = 'cleanup_failed'; }
    try { evidence('final-report', report); } catch { report.status = 'halted'; report.evidenceError = 'persistence_failed'; }
  }
  return report;
}

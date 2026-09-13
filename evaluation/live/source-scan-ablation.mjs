import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { getQualificationPilotPins } from './qualification-pilot.mjs';
import { inspectArtifact, privateDirectory } from './installed-capture-support.mjs';
import { writeQualifiedEvidence } from './qualified-attempt.mjs';
import { createSourceScanAttempt, SOURCE_SCAN_LIMITS } from './qualification-pilot-attempt.mjs';
import { createSourceScanSession } from './source-scan-session.mjs';
import { startExperimentProxy } from './proxy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = 'source-scan-ablation-v1';
const FIXTURE = 'evaluation/live/source-scan-fixture.json';
const FIXTURE_SHA = '6e31bfd44eaf42de5c0c55e3ccbea617633547155869eec3c2b5d9d02f374eb5';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('source_scan_preflight_failed'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonicalPath = (value, directory = false) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value || realpathSync(value) !== value) fail();
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail();
  return value;
};
const budget = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
  knownUsageMicroUsd: state.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0),
  unknownCostRequests: state.attempts.filter(item => item.actualMicroUsd === null).length,
  unsettled: state.attempts.filter(item => item.outcome === null).length,
  limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap, state: state.state });

export function getSourceScanPins() {
  return { ...getQualificationPilotPins(), ...Object.fromEntries([
    FIXTURE, 'evaluation/live/source-scan-ablation.mjs', 'evaluation/live/source-scan-session.mjs',
    'evaluation/live/qualification-pilot-attempt.mjs', 'core/contract.mjs', 'core/recall.mjs',
    'adapters/mcp/server.mjs', 'core/prompts/recall-select.md', 'core/prompts/recall-rank-source-evidence.md',
  ].map(name => [name, hash(readFileSync(canonicalPath(path.join(ROOT, name))))])) };
}

/** Explicit one-shot operator entry; imports never read credentials or send HTTP. */
export async function runSourceScanAblation(options) {
  try { return await execute(options); } catch { fail(); }
}

async function execute(options) {
  if (!exact(options, ['ledger', 'expectedCheckpoint', 'apiKey', 'fetchImpl', 'nodePath',
    'cairnExecutable', 'cairnArtifact', 'cairnArtifactSha256', 'privateDirectory', 'pins'])) fail();
  const { apiKey, fetchImpl } = options;
  if (typeof apiKey !== 'string' || !apiKey || /\s/u.test(apiKey) || typeof fetchImpl !== 'function') fail();
  const ledgerOptions = structuredClone(options.ledger), pins = structuredClone(options.pins);
  const expectedCheckpoint = structuredClone(options.expectedCheckpoint);
  canonicalPath(ledgerOptions.directory, true);
  const policyFile = canonicalPath(path.join(ledgerOptions.directory, 'experiment-request-policy.json'));
  if ((lstatSync(policyFile).mode & 0o777) !== 0o600) fail();
  const policyBytes = readFileSync(policyFile);
  const node = canonicalPath(options.nodePath); accessSync(node, constants.X_OK);
  const executable = canonicalPath(options.cairnExecutable), archive = canonicalPath(options.cairnArtifact);
  const directory = privateDirectory(canonicalPath(options.privateDirectory, true));
  const provenance = inspectArtifact(executable, archive, options.cairnArtifactSha256);
  const verifyPins = () => {
    if (!readFileSync(canonicalPath(policyFile)).equals(policyBytes) || (lstatSync(policyFile).mode & 0o777) !== 0o600) fail();
    const actual = getSourceScanPins();
    if (!exact(pins, Object.keys(actual)) || Object.keys(actual).some(name => actual[name] !== pins[name])
      || actual[FIXTURE] !== FIXTURE_SHA) fail();
    for (const [name, expected] of Object.entries(provenance.sourceHashes)) {
      if (hash(readFileSync(canonicalPath(path.join(provenance.packageRoot, name)))) !== expected) fail();
      if (Object.hasOwn(pins, name) && pins[name] !== expected) fail();
    }
    if (hash(readFileSync(archive)) !== provenance.artifactSha256) fail();
  };
  verifyPins();
  const fixture = JSON.parse(readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
  const schedule = fixture.cases.flatMap((item, index) => (index % 2 ? ['source-scan', 'baseline'] : ['baseline', 'source-scan'])
    .map(arm => ({ ...item, caseId: item.id, id: `${item.id}-${arm}`, arm })));
  const scrub = value => typeof value === 'string' ? value.replaceAll(apiKey, '[REDACTED-KEY]')
    : Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(apiKey, '[REDACTED-KEY]'), scrub(item)])) : value;
  const evidence = (name, value) => writeQualifiedEvidence(directory, name, scrub(value));
  const report = { version: 1, id: ID, status: 'not_run', semanticReviewRequired: true, ingestion: 'manual-oracle',
    fixtureSha256: FIXTURE_SHA, pins, provenance, limits: SOURCE_SCAN_LIMITS,
    budgetBefore: null, budgetAfter: null, attempt: null,
    cases: schedule.map(item => ({ id: item.id, caseId: item.caseId, arm: item.arm, status: 'not_run',
      records: [], recall: null, returnedSourceIndices: null, sourceCoverage: null, traces: [], durationMs: null })) };
  const ledger = reopenExperimentBudget(ledgerOptions);
  let session, attempt, proxy, client, active;
  try {
    report.budgetBefore = budget(ledger.getState());
    attempt = createSourceScanAttempt({ readState: () => ledger.getState(), expectedCheckpoint,
      checkPins: verifyPins, persist: evidence,
      send: async (route, body, requestOptions) => {
        if (!active || active.traces.length >= (active.arm === 'baseline' ? 4 : 2)) fail();
        const trace = { route, requestBody: JSON.parse(body), providerResponse: null, responseAvailable: false };
        active.traces.push(trace); evidence(`arm-${report.cases.indexOf(active)}-request-${active.traces.length}`, trace);
        const response = await session.request(route, body, requestOptions);
        trace.providerResponse = await response.clone().json(); trace.responseAvailable = true;
        evidence(`arm-${report.cases.indexOf(active)}-response-${active.traces.length}`, trace);
        return response;
      } });
    session = createSourceScanSession({ ledger: ledgerOptions, apiKey, fetchImpl });
    // Exclusive ledger intent prevents another directory/process from rerunning this experiment.
    writeQualifiedEvidence(ledgerOptions.directory, `${ID}-intent`, { version: 1, id: ID,
      expectedCheckpoint, pins, artifactSha256: provenance.artifactSha256, limits: SOURCE_SCAN_LIMITS });
    evidence('initial-report', report); evidence('frozen-fixture', fixture);
    proxy = await startExperimentProxy({ session: { request: attempt.request } });
    const requireDriver = createRequire(path.join(ROOT, 'adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client')).href);
    const { StdioClientTransport } = await import(pathToFileURL(requireDriver.resolve('@modelcontextprotocol/client/stdio')).href);
    const { openMemoryCore } = await import(pathToFileURL(path.join(provenance.packageRoot, 'core/index.mjs')).href);
    const config = path.join(directory, 'transport.json');
    writeQualifiedEvidence(directory, 'transport', { version: 1, packageRoot: provenance.packageRoot, proxyUrl: proxy.url });
    for (const [index, item] of schedule.entries()) {
      if (attempt.getState().halted) break;
      active = report.cases[index]; const started = performance.now();
      const dbPath = path.join(directory, `${item.id}.sqlite`);
      const namespace = { ownerId: 'synthetic-source-scan', scope: 'project', projectId: item.id };
      let core;
      try {
        verifyPins();
        core = openMemoryCore({ path: dbPath });
        for (const source of item.sources) {
          const admitted = core.admit({ namespace, memory: { content: source.label, kind: 'context' }, receipts: [{
            client: 'synthetic', sessionId: item.caseId, eventId: `source-${active.records.length}`, role: source.role, excerpt: source.text }] });
          if (!admitted.ok) fail();
          const record = core.get({ namespace, memoryId: admitted.value.memory.id });
          if (!record.ok) fail(); active.records.push(record.value);
        }
        core.close(); core = null;
        client = new Client({ name: 'source-scan-ablation', version: '1.0.0' });
        await client.connect(new StdioClientTransport({ command: node,
          args: [path.join(ROOT, 'evaluation/live/cairn-launcher.mjs'), '--db', dbPath,
            '--owner', namespace.ownerId, '--project', namespace.projectId],
          env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' }));
        const response = await client.callTool({ name: 'recall_memory', arguments: {
          query: item.query, limit: 6, contextMode: 'source-evidence',
          ...(item.arm === 'source-scan' ? { selectionMode: 'bounded-source-scan' } : {}) } }, { timeout: 180000 });
        active.recall = JSON.parse(response.content[0].text);
        if (!active.recall.ok) { active.status = 'recall_failed'; }
        else {
          active.returnedSourceIndices = active.recall.value.memories.map(memory => {
            const sourceIndex = active.records.findIndex(record => record.memory.id === memory.memory.id);
            if (sourceIndex < 0) fail(); return sourceIndex;
          });
          active.sourceCoverage = { required: item.evaluation.requiredSources.length,
            retainedRequired: item.evaluation.requiredSources.filter(i => active.returnedSourceIndices.includes(i)).length,
            retainedIrrelevant: item.evaluation.irrelevantSources.filter(i => active.returnedSourceIndices.includes(i)).length };
          active.status = 'completed';
        }
      } catch { active.status = 'failed'; }
      finally {
        if (core) core.close(); if (client) await client.close(); client = null;
        active.durationMs = performance.now() - started;
        evidence(`arm-${index}-result`, active);
      }
    }
    report.status = report.cases.every(item => item.status === 'completed') ? 'completed' : 'incomplete';
    return report;
  } finally {
    if (client) await client.close(); if (proxy) await proxy.close();
    if (attempt) { await attempt.drain(); report.attempt = attempt.getState(); attempt.stop(); }
    if (session) session.close();
    report.budgetAfter = budget(ledger.getState()); ledger.close();
    evidence('final-report', report);
  }
}

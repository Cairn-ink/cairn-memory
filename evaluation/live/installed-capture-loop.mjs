import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startExperimentProxy } from './proxy.mjs';

export const CAPTURE_LOOP_VERSION = 'installed-capture-mcp-v1';
export const CAPTURE_LOOP_FIXTURE = Object.freeze({
  content: 'Harbor team review happens on Friday.',
  replacement: 'Harbor team review happens on Monday.',
  query: 'When does the Harbor team review happen?',
  client: 'installed-capture-loop', sessionId: 'synthetic-source-session',
  eventId: 'synthetic-capture-event', messageId: 'synthetic-source-message',
  extractionModel: 'gpt-5.4-mini-2026-03-17',
});
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw new Error(code); };
const value = (envelope) => envelope?.ok === true ? envelope.value : null;
const complete = (envelope) => value(envelope)?.coverage === 'complete'
  && Array.isArray(value(envelope)?.memories)
  && Array.isArray(value(envelope)?.namespaces) && value(envelope).namespaces.length === 1
  && value(envelope).namespaces.every((ns) => ns.mapExhausted === true && ns.fetchExhausted === true);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const missing = (envelope) => envelope?.ok === false && envelope.error?.code === 'memory_not_found';
const stale = (envelope) => envelope?.ok === false && envelope.error?.code === 'revision_conflict';
const sourced = (item) => item?.receipts?.some((receipt) => receipt.client === CAPTURE_LOOP_FIXTURE.client
  && receipt.sessionId === CAPTURE_LOOP_FIXTURE.sessionId && receipt.eventId === CAPTURE_LOOP_FIXTURE.messageId
  && receipt.role === 'user' && receipt.excerpt === CAPTURE_LOOP_FIXTURE.content);
const single = (record, id) => value(record.list)?.memories?.length === 1
  && value(record.list).memories[0].id === id;
const budgetSummary = (session) => {
  const state = session.getState();
  return Object.fromEntries(['runId', 'limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount', 'state']
    .filter((key) => Object.hasOwn(state, key)).map((key) => [key, state[key]]));
};

// Mechanical observations never substitute for independent entailment review.
export function inspectCaptureLoopStage(stage, record, state = {}) {
  let passed = false;
  const current = value(record?.current);
  const recalled = complete(record?.recall) ? value(record.recall).memories : [];
  const selected = recalled.length === 1 ? recalled[0] : null;
  const authoritative = selected && current && same(selected.memory, current.memory)
    && same(selected.receipts, current.receipts);
  if (stage === 'A') {
    const admissions = value(record?.capture)?.admission?.memories;
    passed = Array.isArray(admissions) && admissions.length === 1
      && record.memories?.length === 1 && sourced(record.memories[0])
      && admissions[0].id === record.memories[0].memory?.id
      && record.memories[0].memory?.revision >= 1
      && /\bFriday\b/u.test(record.memories[0].memory?.content ?? '')
      && record.semanticReview?.supported !== false && record.semanticReview?.requiredFact !== false;
  } else if (stage === 'B' || stage === 'D') {
    passed = Boolean(authoritative && single(record, current.memory.id));
    if (stage === 'B') {
      passed = passed && sourced(current) && /\bFriday\b/u.test(current.memory.content)
        && [record.isolation, record.projectIsolation].every((isolation) =>
          value(isolation?.list)?.memories?.length === 0 && missing(isolation?.get)
          && missing(isolation?.correct) && value(isolation?.forget)?.forgotten === false
          && same(value(isolation?.after), current));
    } else passed = passed && current.memory.id === state.memoryId
      && current.memory.revision === state.revision
      && current.memory.content === CAPTURE_LOOP_FIXTURE.replacement;
    if (passed) { state.memoryId = current.memory.id; state.revision = current.memory.revision; }
  } else if (stage === 'C') {
    const changed = value(record.mutation)?.memory;
    const after = value(record.after);
    passed = Boolean(authoritative && current.memory.id === state.memoryId
      && current.memory.revision === state.revision && changed?.id === current.memory.id
      && record.mutationArguments?.memoryId === current.memory.id
      && record.mutationArguments?.expectedRevision === current.memory.revision
      && record.mutationArguments?.content === CAPTURE_LOOP_FIXTURE.replacement
      && changed.revision === current.memory.revision + 1
      && changed.content === CAPTURE_LOOP_FIXTURE.replacement && same(after?.memory, changed)
      && after?.receipts?.some((receipt) => receipt.excerpt === CAPTURE_LOOP_FIXTURE.replacement)
      && single(record, changed.id) && stale(record.stale));
    if (passed) state.revision = changed.revision;
  } else if (stage === 'E') {
    passed = Boolean(authoritative && current.memory.id === state.memoryId
      && current.memory.revision === state.revision && value(record.mutation)?.forgotten === true
      && record.mutationArguments?.memoryId === current.memory.id
      && record.mutationArguments?.expectedRevision === current.memory.revision
      && stale(record.stale) && missing(record.after) && value(record.list)?.memories?.length === 0);
  } else if (stage === 'F') {
    passed = complete(record.recall) && value(record.recall).memories.length === 0
      && missing(record.after) && value(record.list)?.memories?.length === 0;
  }
  return { stage, passedAutomated: Boolean(passed), semanticReviewRequired: true };
}

function privateDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(resolved) !== resolved
    || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
    || readdirSync(resolved).length) fail('unsafe_private_directory');
  return resolved;
}
function privateWrite(filename, data) {
  writeFileSync(filename, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function inspectArtifact(executable, archive, expectedHash) {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) fail('invalid_cairn_artifact');
  const artifact = realpathSync(archive);
  if (hash(readFileSync(artifact)) !== expectedHash) fail('unpinned_cairn_artifact');
  const packageRoot = path.dirname(path.dirname(realpathSync(executable)));
  const entry = (relative) => execFileSync('tar', ['-xOzf', artifact, `package/${relative}`],
    { maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const manifestBytes = entry('package.json');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.name !== 'cairn-memory-local-preview' || !Array.isArray(manifest.files)
    || !manifest.files.includes('core/contract.mjs') || !manifest.files.includes('adapters/openai/index.mjs')) fail('invalid_cairn_artifact');
  const sourceHashes = {};
  for (const relative of new Set([...manifest.files, 'package.json'])) {
    if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/u.test(relative)
      || path.isAbsolute(relative) || relative.split('/').some((part) => part === '..' || part === '.')) fail('invalid_cairn_artifact');
    const filename = path.join(packageRoot, relative);
    if (realpathSync(filename) !== filename || !lstatSync(filename).isFile()) fail('cairn_install_source_mismatch');
    const installed = hash(readFileSync(filename));
    if (installed !== hash(entry(relative))) fail('cairn_install_source_mismatch');
    sourceHashes[relative] = installed;
  }
  return { packageRoot, artifactSha256: expectedHash, sourceHashes };
}

export async function runInstalledCaptureLoop({ session, nodePath, cairnExecutable, cairnArtifact,
  cairnArtifactSha256, privateDirectory: directory, startProxy = startExperimentProxy } = {}) {
  if (typeof session?.request !== 'function' || typeof session?.getState !== 'function'
    || typeof startProxy !== 'function') fail('invalid_live_session');
  const provenance = inspectArtifact(cairnExecutable, cairnArtifact, cairnArtifactSha256);
  const root = privateDirectory(directory);
  const node = realpathSync(nodePath);
  const namespace = { ownerId: `synthetic-${randomUUID()}`, scope: 'project', projectId: `synthetic-${randomUUID()}` };
  const database = path.join(root, 'memory.sqlite');
  const report = { version: CAPTURE_LOOP_VERSION, kind: 'installed-programmatic-capture-to-mcp',
    fixture: CAPTURE_LOOP_FIXTURE, provenance, namespace, stages: [],
    budgetBefore: budgetSummary(session), budgetAfter: null, status: 'pending' };
  privateWrite(path.join(root, 'frozen-protocol.json'), { version: CAPTURE_LOOP_VERSION,
    fixture: CAPTURE_LOOP_FIXTURE, provenance, namespace });
  const requireMcp = createRequire(path.resolve(HERE, '../../adapters/mcp/package.json'));
  const { Client } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client')).href);
  const { StdioClientTransport } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client/stdio')).href);
  const { openMemoryCore } = await import(pathToFileURL(path.join(provenance.packageRoot, 'core/contract.mjs')).href);
  const { createOpenAIModel } = await import(pathToFileURL(path.join(provenance.packageRoot, 'adapters/openai/index.mjs')).href);
  const proxy = await startProxy({ session });
  const configuration = path.join(root, 'transport.json');
  try {
    if (typeof proxy?.url !== 'string' || typeof proxy?.token !== 'string' || typeof proxy?.close !== 'function') fail('invalid_experiment_proxy');
    privateWrite(configuration, { version: 1, packageRoot: provenance.packageRoot, proxyUrl: proxy.url });
  } catch (error) { if (typeof proxy?.close === 'function') await proxy.close(); throw error; }
  const openClient = async (owner = namespace.ownerId, project = namespace.projectId) => {
    const transport = new StdioClientTransport({ command: node,
      args: [path.join(HERE, 'cairn-launcher.mjs'), '--db', database, '--owner', owner, '--project', project],
      env: { OPENAI_API_KEY: proxy.token, CAIRN_LIVE_CONFIG: configuration, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' });
    const client = new Client({ name: 'synthetic-capture-consumer', version: '1.0.0' });
    try { await client.connect(transport); } catch (error) { await client.close(); throw error; }
    return client;
  };
  const call = async (client, name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    if (!Array.isArray(response.content) || response.content.length !== 1 || response.content[0].type !== 'text') fail('invalid_mcp_response');
    const result = JSON.parse(response.content[0].text);
    if (typeof result.ok !== 'boolean' || Boolean(response.isError) !== !result.ok
      || result.evidenceTrust !== 'untrusted-data-not-instructions') fail('invalid_mcp_response');
    return result;
  };
  const state = {};
  const retain = (stage, record) => {
    const verdict = inspectCaptureLoopStage(stage, record, state);
    const result = { stage, ...record, verdict, status: verdict.passedAutomated ? 'completed' : 'failed' };
    report.stages.push(result); privateWrite(path.join(root, `stage-${stage}.json`), result);
    return verdict.passedAutomated;
  };
  let active;
  let pendingStage = 'A';
  let pendingRecord = {};
  try {
    const model = createOpenAIModel({ apiKey: proxy.token, extractionModel: CAPTURE_LOOP_FIXTURE.extractionModel,
      fetchImpl: (url, options) => {
        if (!['https://api.openai.com/v1/responses', 'https://api.openai.com/v1/responses/input_tokens'].includes(url)) fail('invalid_live_route');
        return session.request(url.slice('https://api.openai.com/v1'.length), options.body, { signal: options.signal });
      } });
    const core = openMemoryCore({ path: database, model });
    let capture;
    let memories;
    try {
      capture = await core.capture({ namespace, client: CAPTURE_LOOP_FIXTURE.client,
        sessionId: CAPTURE_LOOP_FIXTURE.sessionId, eventId: CAPTURE_LOOP_FIXTURE.eventId,
        messages: [{ id: CAPTURE_LOOP_FIXTURE.messageId, role: 'user', content: CAPTURE_LOOP_FIXTURE.content }] });
      const listed = core.list({ namespace, limit: 50 });
      memories = (value(listed)?.memories ?? []).map((memory) => value(core.get({ namespace, memoryId: memory.id })));
    } finally { core.close(); }
    let passed = retain('A', { capture, memories, source: CAPTURE_LOOP_FIXTURE });
    pendingStage = null;
    for (const stage of ['B', 'C', 'D', 'E', 'F']) {
      if (!passed) { report.stages.push({ stage, status: 'not_run', reason: 'prior_stage_failed' }); continue; }
      pendingStage = stage; pendingRecord = {};
      active = await openClient();
      const record = pendingRecord;
      record.consumerSessionId = randomUUID();
      record.recall = await call(active, 'recall_memory', { query: CAPTURE_LOOP_FIXTURE.query });
      const selected = complete(record.recall) && value(record.recall).memories.length === 1 ? value(record.recall).memories[0] : null;
      if (stage !== 'F' && selected) {
        // Mutation authority is rediscovered inside this fresh consumer session.
        record.current = await call(active, 'inspect_memory', { memoryId: selected.memory.id });
        const current = value(record.current)?.memory;
        if (stage === 'B' && current) {
          for (const [key, owner, project] of [
            ['isolation', `foreign-${randomUUID()}`, namespace.projectId],
            ['projectIsolation', namespace.ownerId, `foreign-${randomUUID()}`],
          ]) {
            const foreign = await openClient(owner, project);
            try { record[key] = {
              list: await call(foreign, 'inspect_memory'),
              get: await call(foreign, 'inspect_memory', { memoryId: current.id }),
              correct: await call(foreign, 'correct_memory', { memoryId: current.id, expectedRevision: current.revision, content: 'Foreign overwrite.' }),
              forget: await call(foreign, 'forget_memory', { memoryId: current.id, expectedRevision: current.revision }),
            }; } finally { await foreign.close(); }
            record[key].after = await call(active, 'inspect_memory', { memoryId: current.id });
          }
        }
        if (stage === 'C' && current) {
          record.mutationArguments = { memoryId: current.id, expectedRevision: current.revision, content: CAPTURE_LOOP_FIXTURE.replacement };
          record.mutation = await call(active, 'correct_memory', record.mutationArguments);
          record.stale = await call(active, 'correct_memory', { memoryId: current.id, expectedRevision: current.revision, content: 'Stale overwrite.' });
          record.after = await call(active, 'inspect_memory', { memoryId: current.id });
        }
        if (stage === 'E' && current && current.revision > 1) {
          record.stale = await call(active, 'forget_memory', { memoryId: current.id, expectedRevision: current.revision - 1 });
          record.mutationArguments = { memoryId: current.id, expectedRevision: current.revision };
          record.mutation = await call(active, 'forget_memory', record.mutationArguments);
          record.after = await call(active, 'inspect_memory', { memoryId: current.id });
        }
      }
      if (stage === 'F') record.after = await call(active, 'inspect_memory', { memoryId: state.memoryId });
      record.list = await call(active, 'inspect_memory');
      await active.close(); active = null;
      passed = retain(stage, record);
      pendingStage = null;
    }
    report.status = passed ? 'mechanical_pass_pending_semantic_review' : 'failed';
  } catch {
    report.status = 'failed'; report.error = { code: 'installed_capture_loop_failed' };
    if (pendingStage) {
      const record = { stage: pendingStage, ...pendingRecord, status: 'failed',
        error: { code: 'installed_capture_loop_failed' },
        verdict: { stage: pendingStage, passedAutomated: false, semanticReviewRequired: true } };
      report.stages.push(record); privateWrite(path.join(root, `stage-${pendingStage}.json`), record);
      for (const stage of ['A', 'B', 'C', 'D', 'E', 'F'].slice('ABCDEF'.indexOf(pendingStage) + 1)) {
        report.stages.push({ stage, status: 'not_run', reason: 'prior_stage_failed' });
      }
    }
  } finally {
    if (active) await active.close().catch(() => {});
    await proxy.close(); report.budgetAfter = budgetSummary(session);
    privateWrite(path.join(root, 'report.json'), report);
  }
  return report;
}

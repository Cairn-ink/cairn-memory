import { randomUUID } from 'node:crypto';
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startExperimentProxy } from './proxy.mjs';
import { privateDirectory, privateWrite, inspectArtifact } from './installed-capture-support.mjs';
import { ORDERED_CAPTURE_LOOP_VERSION, ORDERED_CAPTURE_LOOP_FIXTURE } from './installed-ordered-fixture.mjs';
import { inspectOrderedCaptureLoopStage } from './installed-ordered-stages.mjs';

export { ORDERED_CAPTURE_LOOP_VERSION, ORDERED_CAPTURE_LOOP_FIXTURE, inspectOrderedCaptureLoopStage };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGES = ['A', 'B', 'C', 'D', 'E', 'F'];
const fail = code => { throw new Error(code); };
const value = envelope => envelope?.ok === true ? envelope.value : null;
const unwrap = envelope => { if (envelope?.ok !== true) fail('ordered_operation_failed'); return envelope.value; };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function preflight(options) {
  let selected;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Reflect.ownKeys(options).some(key => !['session', 'nodePath', 'cairnExecutable', 'cairnArtifact',
        'cairnArtifactSha256', 'privateDirectory', 'startProxy'].includes(key))) fail('invalid_ordered_capture_options');
    const { session, nodePath, cairnExecutable, cairnArtifact, cairnArtifactSha256,
      privateDirectory: directory, startProxy = startExperimentProxy } = options;
    if (typeof session?.request !== 'function' || typeof session?.getState !== 'function'
      || typeof startProxy !== 'function' || typeof cairnArtifactSha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(cairnArtifactSha256)
      || [nodePath, cairnExecutable, cairnArtifact, directory].some(item =>
        typeof item !== 'string' || !path.isAbsolute(item) || item.includes('\0') || path.resolve(item) !== item)) {
      fail('invalid_ordered_capture_options');
    }
    selected = { session, nodePath, cairnExecutable, cairnArtifact, cairnArtifactSha256, directory, startProxy };
  } catch { fail('invalid_ordered_capture_options'); }
  let root;
  try { root = privateDirectory(selected.directory); } catch { fail('unsafe_private_directory'); }
  let node;
  try {
    node = realpathSync(selected.nodePath);
    if (!lstatSync(node).isFile()) fail('invalid_node_executable');
    accessSync(node, constants.X_OK);
  } catch { fail('invalid_node_executable'); }
  let provenance;
  try { provenance = inspectArtifact(selected.cairnExecutable, selected.cairnArtifact, selected.cairnArtifactSha256); }
  catch (error) {
    const code = ['invalid_cairn_artifact', 'unpinned_cairn_artifact', 'cairn_install_source_mismatch'].includes(error?.message)
      ? error.message : 'invalid_cairn_artifact';
    fail(code);
  }
  return { ...selected, root, node, provenance };
}

function budgetSummary(session) {
  const state = session.getState();
  return structuredClone(Object.fromEntries(['runId', 'limitMicroUsd', 'requestCap', 'reservedMicroUsd', 'requestCount', 'state']
    .filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]])));
}

async function details(call, memoryId, pages, append = () => {}) {
  let receiptCursor;
  let record;
  do {
    const envelope = await call({ memoryId, receiptLimit: 50, ...(receiptCursor ? { receiptCursor } : {}) });
    pages.push(envelope);
    const detail = unwrap(envelope);
    if (!record) {
      record = { memory: detail.memory, receipts: [], ...(detail.supersession ? { supersession: detail.supersession } : {}) };
      append(record);
    }
    record.receipts.push(...detail.receipts);
    receiptCursor = detail.nextReceiptCursor;
  } while (receiptCursor);
  return record;
}

async function snapshot(call, observed) {
  let cursor;
  do {
    const envelope = await call({ limit: 50, ...(cursor ? { cursor } : {}) });
    observed.listPages.push(envelope);
    const listed = unwrap(envelope);
    for (const memory of listed.memories) {
      const item = { memoryId: memory.id, pages: [] };
      observed.getPages.push(item);
      await details(call, memory.id, item.pages, record => observed.records.push(record));
    }
    cursor = listed.nextCursor;
  } while (cursor);
}
const emptySnapshot = () => ({ listPages: [], getPages: [], records: [] });

function captureCompleted(envelope) {
  const captured = value(envelope);
  const classification = captured?.classification;
  const reconciliation = captured?.reconciliation;
  return captured?.duplicate === false
    && (classification?.status === 'applied' || (classification?.status === 'skipped'
      && ['empty', 'already_filed'].includes(classification.reason)))
    && reconciliation?.reason === null && Number.isInteger(reconciliation.retiredCount)
    && ((reconciliation.status === 'complete_no_change' && reconciliation.retiredCount === 0)
      || (reconciliation.status === 'applied' && reconciliation.retiredCount >= 1 && reconciliation.retiredCount <= 5));
}

/** Installed source capture and independent cold MCP consumers; no semantic verdict. */
export async function runInstalledOrderedCaptureLoop(options) {
  const { session, root, node, provenance, startProxy } = preflight(options);
  const fixture = ORDERED_CAPTURE_LOOP_FIXTURE;
  const namespace = { ownerId: `synthetic-${randomUUID()}`, scope: 'project', projectId: `synthetic-${randomUUID()}` };
  const database = path.join(root, 'memory.sqlite');
  const report = { version: ORDERED_CAPTURE_LOOP_VERSION, kind: 'installed-programmatic-ordered-capture-to-mcp',
    fixture, provenance, namespace, stages: STAGES.map(stage => ({ stage, status: 'not_run', reason: 'prior_stage_failed',
      verdict: { stage, passedAutomated: false, semanticReviewRequired: true } })),
    budgetBefore: null, budgetAfter: null, status: 'pending' };
  const recordFailure = (record, code) => {
    record.status = 'failed';
    record.error ??= { code };
    record.errors ??= [];
    if (!record.errors.some(error => error.code === code)) record.errors.push({ code });
    if (record.verdict) record.verdict.passedAutomated = false;
    report.status = 'failed';
  };
  const persist = (filename, record) => {
    try { privateWrite(path.join(root, filename), record); return true; }
    catch {
      recordFailure(record, 'ordered_persistence_failed');
      if (record !== report) recordFailure(report, 'ordered_persistence_failed');
      return false;
    }
  };
  const clients = new Set();
  const transports = new Map();
  let proxy;
  let core;
  let activeRecord = report;
  const closeClient = async client => {
    try {
      await client.close();
      clients.delete(client);
      transports.delete(client);
    } catch { recordFailure(activeRecord, 'ordered_client_close_failed'); fail('ordered_cleanup_failed'); }
  };
  const closeCore = () => {
    const closing = core;
    if (closing) {
      try { unwrap(closing.close()); core = null; }
      catch { recordFailure(activeRecord, 'ordered_core_close_failed'); fail('ordered_cleanup_failed'); }
    }
  };
  const state = {};
  try {
    if (!persist('frozen-protocol.json', { version: ORDERED_CAPTURE_LOOP_VERSION, fixture, provenance, namespace })) {
      fail('ordered_persistence_failed');
    }
    try { report.budgetBefore = budgetSummary(session); } catch { recordFailure(report, 'ordered_budget_read_failed'); fail('ordered_budget_read_failed'); }
    proxy = await startProxy({ session });
    if (typeof proxy?.url !== 'string' || typeof proxy?.token !== 'string' || typeof proxy?.close !== 'function') fail('invalid_experiment_proxy');
    const proxyUrl = new URL(proxy.url);
    if (proxyUrl.protocol !== 'http:' || proxyUrl.hostname !== '127.0.0.1' || !proxyUrl.port
      || proxyUrl.username || proxyUrl.password || proxyUrl.search || proxyUrl.hash
      || !['', '/'].includes(proxyUrl.pathname)) fail('invalid_experiment_proxy');
    const configuration = path.join(root, 'transport.json');
    if (!persist('transport.json', { version: 1, packageRoot: provenance.packageRoot, proxyUrl: proxy.url })) fail('ordered_persistence_failed');
    const requireMcp = createRequire(path.resolve(HERE, '../../adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client')).href);
    const { StdioClientTransport } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client/stdio')).href);
    const { openMemoryCore } = await import(pathToFileURL(path.join(provenance.packageRoot, 'core/contract.mjs')).href);
    const { createOpenAIModel } = await import(pathToFileURL(path.join(provenance.packageRoot, 'adapters/openai/index.mjs')).href);
    const model = createOpenAIModel({ apiKey: proxy.token, extractionModel: fixture.extractionModel,
      fetchImpl: (url, request) => {
        if (!['https://api.openai.com/v1/responses', 'https://api.openai.com/v1/responses/input_tokens'].includes(url)) fail('invalid_live_route');
        return session.request(url.slice('https://api.openai.com/v1'.length), request.body, { signal: request.signal });
      } });
    const openClient = async binding => {
      const transport = new StdioClientTransport({ command: node,
        args: [path.join(HERE, 'cairn-launcher.mjs'), '--db', database, '--owner', binding.ownerId, '--project', binding.projectId],
        env: { OPENAI_API_KEY: proxy.token, CAIRN_LIVE_CONFIG: configuration, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' });
      const client = new Client({ name: 'synthetic-ordered-capture-consumer', version: '1.0.0' });
      clients.add(client);
      transports.set(client, transport);
      await client.connect(transport);
      return client;
    };
    const call = async (client, name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      if (!Array.isArray(response.content) || response.content.length !== 1 || response.content[0].type !== 'text') fail('invalid_mcp_response');
      const envelope = JSON.parse(response.content[0].text);
      if (typeof envelope.ok !== 'boolean' || Boolean(response.isError) !== !envelope.ok
        || envelope.evidenceTrust !== 'untrusted-data-not-instructions') fail('invalid_mcp_response');
      return envelope;
    };
    const inspect = client => args => call(client, 'inspect_memory', args);
    const inspectInto = async (client, record, key, memoryId) => {
      const pages = record[`${key}Pages`] = [];
      try { return await details(inspect(client), memoryId, pages); }
      finally { if (pages.length) record[key] = pages[0]; }
    };
    let passed = true;
    for (const record of report.stages) {
      if (!passed) break;
      activeRecord = record;
      delete record.reason;
      record.status = 'pending';
      const stage = record.stage;
      try {
        if (stage === 'A') {
          record.windows = [];
          for (const source of fixture.windows) {
            const window = { source, snapshot: emptySnapshot(), reopenedSnapshot: emptySnapshot() };
            record.windows.push(window);
            core = openMemoryCore({ path: database, model });
            window.capture = await core.capture({ namespace, client: fixture.client,
              sessionId: source.sessionId, eventId: source.eventId, messages: source.messages,
              causal: { streamId: fixture.streamId, sequence: source.sequence } });
            await snapshot(args => args.memoryId ? core.get({ namespace, ...args }) : core.list({ namespace, ...args }), window.snapshot);
            closeCore();
            core = openMemoryCore({ path: database });
            await snapshot(args => args.memoryId ? core.get({ namespace, ...args }) : core.list({ namespace, ...args }), window.reopenedSnapshot);
            closeCore();
            if (!captureCompleted(window.capture) || !same(window.snapshot.records, window.reopenedSnapshot.records)
              || (source.sequence === 1 && (window.capture.value.admission.memories.length !== 1
                || window.snapshot.records.length !== 1))) fail('ordered_capture_failed');
          }
        } else {
          const client = await openClient(namespace);
          record.consumerSessionId = randomUUID();
          record.recall = await call(client, 'recall_memory', { query: fixture.query });
          if (stage !== 'F') {
            const recalled = unwrap(record.recall);
            if (recalled.coverage !== 'complete' || recalled.memories.length !== 1
              || !Array.isArray(recalled.namespaces) || recalled.namespaces.length !== 1
              || !recalled.namespaces.every(item => same(item.namespace, namespace)
                && item.mapExhausted === true && item.fetchExhausted === true)) fail('ordered_target_ambiguous');
            const selected = recalled.memories[0];
            const current = await inspectInto(client, record, 'current', selected.memory.id);
            if (current.memory.id !== state.successorId || current.memory.state !== 'active'
              || !same(selected.memory, current.memory) || !same(selected.receipts, current.receipts)) fail('ordered_target_ambiguous');
            if (stage === 'B') {
              for (const [key, binding] of [['isolation', { ...namespace, ownerId: `foreign-${randomUUID()}` }],
                ['projectIsolation', { ...namespace, projectId: `foreign-${randomUUID()}` }]]) {
                const foreign = await openClient(binding);
                const isolation = record[key] = { consumerSessionId: randomUUID(), namespace: binding, listPages: [] };
                let cursor;
                do {
                  const listed = await call(foreign, 'inspect_memory', { limit: 50, ...(cursor ? { cursor } : {}) });
                  isolation.listPages.push(listed); cursor = unwrap(listed).nextCursor;
                } while (cursor);
                isolation.get = await call(foreign, 'inspect_memory', { memoryId: current.memory.id });
                isolation.correctArguments = { memoryId: current.memory.id, expectedRevision: current.memory.revision, content: 'Foreign overwrite.' };
                isolation.correct = await call(foreign, 'correct_memory', isolation.correctArguments);
                isolation.forgetArguments = { memoryId: current.memory.id, expectedRevision: current.memory.revision };
                isolation.forget = await call(foreign, 'forget_memory', isolation.forgetArguments);
                await closeClient(foreign);
                await inspectInto(client, isolation, 'after', current.memory.id);
                await inspectInto(client, isolation, 'historyAfter', state.predecessorId);
                isolation.snapshotAfter = emptySnapshot();
                await snapshot(inspect(client), isolation.snapshotAfter);
              }
            }
            if (stage === 'C') {
              record.mutationArguments = { memoryId: current.memory.id, expectedRevision: current.memory.revision, content: fixture.correction };
              record.mutation = await call(client, 'correct_memory', record.mutationArguments);
              record.staleArguments = { memoryId: current.memory.id, expectedRevision: current.memory.revision, content: 'Stale overwrite.' };
              record.stale = await call(client, 'correct_memory', record.staleArguments);
              await inspectInto(client, record, 'after', current.memory.id);
            }
            if (stage === 'E') {
              record.staleArguments = { memoryId: current.memory.id, expectedRevision: current.memory.revision - 1 };
              record.stale = await call(client, 'forget_memory', record.staleArguments);
              const unchanged = await inspectInto(client, record, 'afterStale', current.memory.id);
              if (record.stale?.error?.code !== 'revision_conflict' || !same(unchanged, current)) fail('ordered_stale_control_failed');
              record.mutationArguments = { memoryId: current.memory.id, expectedRevision: current.memory.revision };
              record.mutation = await call(client, 'forget_memory', record.mutationArguments);
              record.after = await call(client, 'inspect_memory', { memoryId: current.memory.id });
            }
          } else record.after = await call(client, 'inspect_memory', { memoryId: state.successorId });
          await inspectInto(client, record, 'history', state.predecessorId);
          record.snapshot = emptySnapshot();
          await snapshot(inspect(client), record.snapshot);
          await closeClient(client);
        }
        record.verdict = inspectOrderedCaptureLoopStage(stage, record, state);
        record.status = record.verdict.passedAutomated ? 'completed' : 'failed';
        if (!record.verdict.passedAutomated) recordFailure(record, 'ordered_stage_rejected');
      } catch { recordFailure(record, 'installed_ordered_capture_loop_failed'); }
      try { closeCore(); } catch { /* Already retained by closeCore. */ }
      for (const client of [...clients]) { try { await closeClient(client); } catch { /* Already retained. */ } }
      if (!persist(`stage-${stage}.json`, record)) recordFailure(report, 'ordered_persistence_failed');
      passed = record.status === 'completed' && report.status !== 'failed';
    }
    if (passed) report.status = 'mechanical_pass_pending_semantic_review';
  } catch { recordFailure(activeRecord, 'installed_ordered_capture_loop_failed'); }
  finally {
    try { closeCore(); } catch { /* Already retained. */ }
    for (const client of [...clients]) {
      try { await closeClient(client); }
      catch {
        // Bounded transport fallback is cleanup, never a repeated model/tool call.
        try { await transports.get(client)?.close(); }
        catch { recordFailure(report, 'ordered_transport_close_failed'); }
      }
    }
    try { if (typeof proxy?.close === 'function') await proxy.close(); }
    catch { recordFailure(report, 'ordered_proxy_close_failed'); }
    try { report.budgetAfter = budgetSummary(session); }
    catch { recordFailure(report, 'ordered_budget_read_failed'); }
    for (const record of report.stages.filter(item => item.status === 'not_run')) {
      if (!persist(`stage-${record.stage}.json`, record)) recordFailure(report, 'ordered_persistence_failed');
    }
    persist('report.json', report);
  }
  return report;
}

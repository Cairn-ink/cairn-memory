import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadSourceBundleCases, prepareSourceBundleCase, SOURCE_BUNDLE_VERSION,
  sourceBundleOrders } from './source-bundle-profile.mjs';
import { prepareBundleRankRequest } from '../architecture/source-bundle-rank.mjs';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';

const VERSION = 'source-bundle-comparison-preparation-v1';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const PREFLIGHT_LIMITS = Object.freeze({ inputTokens: 6000, rankOutputTokens: 1024,
  contextWindow: 8192, mapTokens: 4000, cases: 24, cardsPerCase: 12 });
const QT_WIRE_CONTRACT_SHA256 = 'f4f9a3b02fc87cae2c8306a51b31f3f1d6d5ee287b44d91580a65f15df91ebbc';
const OMISSION_FIELDS = ['navigationItemsOmitted', 'candidatesOmitted', 'candidatesShortened', 'receiptListsCapped'];
const preparations = new WeakMap();
const preparedCases = new WeakSet();
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };
const failureReason = error => error instanceof Error && /^source_bundle_[a-z_]+$/.test(error.message)
  ? error.message : 'source_bundle_preflight_failed';
const requireTrue = (condition, code) => { if (!condition) fail(code); };
const value = result => { requireTrue(result.ok === true, 'source_bundle_core_failure'); return result.value; };
const detach = input => freeze(JSON.parse(JSON.stringify(snapshotJson(input,
  { bytes: 32 * 1024 * 1024, nodes: 500000, depth: 24 }, 'invalid_source_bundle_observation'))));
const quote = name => `"${name.replaceAll('"', '""')}"`;

async function privateDirectory(path) {
  const absolute = resolve(path);
  requireTrue(absolute !== dirname(absolute), 'invalid_source_bundle_output');
  const info = await lstat(absolute);
  requireTrue(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0
    && await realpath(absolute) === absolute, 'invalid_source_bundle_output');
  return absolute;
}

async function exclusiveJson(path, data) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(data, null, 2)}\n`); await file.sync(); }
  finally { await file.close(); }
}

// Read all logical tables, not selected application rows or SQLite file hashes.
async function logicalSnapshot(path) {
  const info = await lstat(path);
  requireTrue(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
    'source_bundle_store_drift');
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec('BEGIN');
    const schema = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const tables = schema.filter(row => row.type === 'table').map(({ name }) => {
      const columns = database.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      const rows = database.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${columns.map(quote).join(',')}`).all();
      return { name, columns, rows };
    });
    const snapshot = detach({ applicationId: database.prepare('PRAGMA application_id').get().application_id,
      userVersion: database.prepare('PRAGMA user_version').get().user_version, schema, tables });
    database.exec('COMMIT');
    return { snapshot, sha256: digest(snapshot), fileBytes: (await stat(path)).size };
  } finally { database.close(); }
}

/** Runner-only integrity check; a detached observation is not a trusted case. */
export async function assertSourceBundleStoreUnchanged(caseObservation) {
  requireTrue(preparedCases.has(caseObservation), 'invalid_source_bundle_preparation');
  const current = await logicalSnapshot(caseObservation.storePath);
  requireTrue(current.sha256 === caseObservation.state.sha256, 'source_bundle_store_drift');
  return freeze({ sha256: current.sha256, fileBytes: current.fileBytes });
}

/** Consume before asynchronous validation so a failed first use cannot retry. */
export async function consumeSourceBundlePreparation(capability) {
  const owner = preparations.get(capability);
  requireTrue(owner && owner.state === 'ready', 'invalid_source_bundle_preparation');
  owner.state = 'consumed';
  const sources = await loadSourceBundleCases();
  requireTrue(digest(sources) === owner.observation.manifest.sourceSha256, 'source_bundle_source_drift');
  for (const c of owner.observation.cases) await assertSourceBundleStoreUnchanged(c);
  return owner.observation;
}

// Independently authored QT2 wire, pinned to the prospective contract above.
// No QT constructor, request callback, ledger, key or provider is invoked here.
function bundleBodies(prepared) {
  const request = prepared.request;
  const payload = { model: MODEL, instructions: request.system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request.input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_source_bundle_plan_rank_v1', strict: true,
      schema: request.outputSchema } }, truncation: 'disabled' };
  return { countBody: JSON.stringify(payload), generationBody: JSON.stringify({ ...payload,
    max_output_tokens: 1024, store: false, stream: false }) };
}

async function ordinaryBodies(shell, createOpenAIModel, countTokens) {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-serializer-only', fetchImpl: async (url, init) => {
    const ordinal = calls.length;
    requireTrue(url === `https://api.openai.com/v1${ordinal === 0 ? '/responses/input_tokens' : '/responses'}`
      && ordinal < 2 && init.method === 'POST' && init.redirect === 'error', 'source_bundle_serializer_failure');
    calls.push({ url, body: init.body });
    if (ordinal === 0) return new Response(JSON.stringify({ object: 'response.input_tokens',
      input_tokens: countTokens(init.body) }));
    const text = JSON.stringify({ refs: [] }), outputTokens = countTokens(text), inputTokens = countTokens(init.body);
    return new Response(JSON.stringify({ object: 'response', model: MODEL, status: 'completed',
      error: null, incomplete_details: null, usage: { input_tokens: inputTokens,
        output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] }));
  } });
  const output = await model.rank({ ...shell, signal: new AbortController().signal });
  requireTrue(calls.length === 2 && isDeepStrictEqual(output, { refs: [] }), 'source_bundle_serializer_failure');
  return { countBody: calls[0].body, generationBody: calls[1].body };
}

function assertCompleteRank(shell, mapping, map) {
  requireTrue(shell.maxOutputTokens === 1024 && shell.input.limit === 6
    && shell.input.candidates.length === 12 && map.items.length === 12
    && map.exhausted === true && map.nextCursor === null && map.invalidRefs.length === 0,
  'source_bundle_rank_incomplete');
  const expected = new Map(mapping.map(entry => [entry.memoryId, entry]));
  const seen = new Set();
  for (const [index, candidate] of shell.input.candidates.entries()) {
    const entry = expected.get(candidate.memory.id), ref = map.items[index].ref;
    requireTrue(entry && !seen.has(candidate.memory.id) && candidate.namespaceIndex === 0
      && candidate.memory.currentness === 'current' && candidate.memory.id === ref.memoryId
      && candidate.memory.revision === ref.revision && candidate.memory.revision === entry.revision
      && candidate.receiptCount === 1 && candidate.receipts.length === 1
      && candidate.interpretationStatus === 'omitted' && candidate.sourceSelectionCoverage === 'unassessed'
      && isDeepStrictEqual(candidate.receipts[0], { id: entry.receipt.id, role: entry.role, excerpt: entry.window }),
    'source_bundle_rank_incomplete');
    seen.add(candidate.memory.id);
  }
  requireTrue(seen.size === expected.size, 'source_bundle_rank_incomplete');
}

async function prepareCase(sources, source, directory, openMemoryCore, countTokens, createOpenAIModel) {
  const prepared = await prepareSourceBundleCase(sources, source.id);
  const { plan, question } = prepared, namespace = plan.cairnPlan.batches[0].captureInput.namespace;
  await mkdir(directory, { mode: 0o700 });
  const storePath = join(directory, 'memory.sqlite');
  const exclusive = await open(storePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  await exclusive.close();
  let core, captureFailure;
  const outcomes = [], mapping = [], extractionInputs = [], classificationInputs = [];
  const model = { contextWindow: 8192, countTokens,
    extract({ input }) {
      extractionInputs.push(detach(input));
      return { items: input.messages.map(window => ({ content: window.content, kind: 'context',
        confidence: 1, sourceIndices: [window.index] })) };
    },
    classify({ input }) {
      classificationInputs.push(detach(input));
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    },
    select() { fail('source_bundle_unexpected_select'); }, rank() { fail('source_bundle_unexpected_rank'); },
  };
  try {
    core = openMemoryCore({ path: storePath, model, captureSourcePolicy: 'indexed-evidence-v1' });
    for (const [index, batch] of plan.cairnPlan.batches.entries()) {
      const outcome = value(await core.capture(batch.captureInput));
      requireTrue(outcome.duplicate === false && outcome.admission.memories.length === 1
        && outcome.admission.suppressedCount === 0 && outcome.classification.status === 'applied'
        && !outcome.extractionTruncated && !outcome.qualificationTruncated, 'source_bundle_capture_incomplete');
      const member = outcome.admission.memories[0], detail = value(core.get({ namespace,
        memoryId: member.id, receiptLimit: 100 }));
      const window = batch.indexedWindows[0];
      requireTrue(detail.memory.kind === 'context' && detail.memory.content === window.content
        && detail.memory.state === 'active' && detail.memory.filing.status === 'unfiled'
        && detail.memory.receiptCount === 1 && detail.receipts.length === 1 && detail.exhausted
        && detail.nextReceiptCursor === null && detail.placements.length === 0
        && detail.receipts[0].role === window.role && detail.receipts[0].excerpt === window.content
        && detail.receipts[0].sessionId === batch.captureInput.sessionId
        // Indexed capture binds receipt.eventId to the exact message ID; the
        // capture event ID remains separately retained in captureInput.
        && detail.receipts[0].eventId === batch.captureInput.messages[0].id, 'source_bundle_capture_incomplete');
      outcomes.push(outcome);
      mapping.push({ originalSessionId: source.sessions[index].id, eventTime: source.sessions[index].eventTime,
        originalMessageIndex: 0, originalContent: source.sessions[index].messages[0].content,
        role: window.role, window: window.content, sourceIndex: window.index,
        captureInput: batch.captureInput, memoryId: member.id, revision: detail.memory.revision, receipt: detail.receipts[0] });
    }
  } catch (error) { captureFailure = error; }
  finally { core?.close(); }
  await exclusiveJson(join(directory, 'capture.json'), { id: source.id, namespace,
    complete: !captureFailure, ...(captureFailure ? { failure: failureReason(captureFailure) } : {}),
    mapping, outcomes, extractionInputs, classificationInputs });
  if (captureFailure) throw captureFailure;
  requireTrue(extractionInputs.length === 12 && classificationInputs.length === 12
    && new Set(mapping.map(entry => entry.memoryId)).size === 12
    && new Set(mapping.map(entry => entry.receipt.id)).size === 12, 'source_bundle_capture_incomplete');
  const before = await logicalSnapshot(storePath);
  const rows = before.snapshot.tables.find(table => table.name === 'memories').rows;
  requireTrue(rows.length === 12 && rows.every(row => row.deleted === 0 && row.currentness === 'current'
    && row.filing_status === 'unfiled' && row.owner_id === namespace.ownerId
    && row.scope === namespace.scope && row.project_id === namespace.projectId)
    && before.snapshot.tables.find(table => table.name === 'receipts').rows.length === 12,
  'source_bundle_store_incomplete');
  const observedMaps = [], rankCalls = [];
  const observedCounter = text => {
    if (text.startsWith('{"ok":true,"value":{"items":')) {
      const envelope = JSON.parse(text);
      if (envelope.value.items.length && envelope.value.items.every(item => item.type === 'unfiled'))
        observedMaps.push(detach(envelope.value));
    }
    return countTokens(text);
  };
  let recall, publicMap;
  try {
    core = openMemoryCore({ path: storePath, sourceCandidatePolicy: 'bounded-keyset-v1', model: {
      contextWindow: 8192, countTokens: observedCounter,
      select() { fail('source_bundle_unexpected_select'); },
      rank({ system, input, maxOutputTokens }) { rankCalls.push(detach({ system, input, maxOutputTokens })); return { refs: [] }; },
    } });
    publicMap = value(core.map({ namespace, purpose: 'recall', limit: 100, tokenBudget: 4000 }));
    requireTrue(publicMap.items.length === 12 && publicMap.items.every(item => item.type === 'unfiled')
      && publicMap.exhausted && publicMap.nextCursor === null && publicMap.invalidRefs.length === 0,
    'source_bundle_map_incomplete');
    observedMaps.length = 0;
    recall = value(await core.recall({ readSet: [namespace], query: plan.mem0Input.query,
      limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  } finally { core?.close(); }
  requireTrue(rankCalls.length === 1 && observedMaps.length === 1
    && recall.selection.strategy === 'complete-map' && recall.coverage === 'complete'
    && !recall.recallTruncated && recall.memories.length === 0 && recall.namespaces.length === 1
    && recall.namespaces[0].mapExhausted && recall.namespaces[0].fetchExhausted,
  'source_bundle_rank_incomplete');
  const rankRequest = rankCalls[0];
  // core/recall.mjs emits recallTruncated only when at least one counter is nonzero.
  // Preserve that raw field too, rather than claiming direct access to its locals.
  const omissionCounters = Object.fromEntries(OMISSION_FIELDS.map(field =>
    [field, recall.recallTruncated?.[field] ?? 0]));
  requireTrue(Object.values(omissionCounters).every(count => count === 0), 'source_bundle_rank_incomplete');
  requireTrue(rankRequest.input.query === plan.mem0Input.query, 'source_bundle_query_drift');
  assertCompleteRank(rankRequest, mapping, observedMaps[0]);
  const after = await logicalSnapshot(storePath);
  requireTrue(before.sha256 === after.sha256, 'source_bundle_store_drift');
  const bundle = prepareBundleRankRequest({ ...rankRequest, signal: new AbortController().signal }, countTokens);
  const ordinary = await ordinaryBodies(rankRequest, createOpenAIModel, countTokens), bundleWire = bundleBodies(bundle);
  const tokenCounts = { ordinaryPrepared: countTokens(JSON.stringify(rankRequest)),
    bundlePrepared: countTokens(JSON.stringify(bundle.request)),
    ordinaryCount: countTokens(ordinary.countBody), ordinaryGeneration: countTokens(ordinary.generationBody),
    bundleCount: countTokens(bundleWire.countBody), bundleGeneration: countTokens(bundleWire.generationBody) };
  requireTrue(Object.values(tokenCounts).every(count => count <= 6000), 'source_bundle_wire_overflow');
  const result = detach({ id: source.id, directory, storePath, source: { id: source.id,
    question: source.question, sessions: source.sessions }, plan, question, namespace, mapping, outcomes,
    extractionInputs, classificationInputs, state: before, postPreflightStateSha256: after.sha256,
    publicMap, recallMap: observedMaps[0], recall, omissionCounters,
    omissionCounterBasis: 'core-recall-zero-suppressed-field-plus-exact-source-attestation',
    rankRequest, bundlePrepared: bundle,
    ordinaryWire: ordinary, bundleWire, tokenCounts,
    hashes: { sourceSha256: digest(source), planSha256: digest(plan), stateSha256: before.sha256,
      mappingSha256: digest(mapping), rankRequestSha256: digest(rankRequest),
      bundlePreparedSha256: bundle.requestSha256, ordinaryCountSha256: digest(ordinary.countBody),
      ordinaryGenerationSha256: digest(ordinary.generationBody), bundleCountSha256: digest(bundleWire.countBody),
      bundleGenerationSha256: digest(bundleWire.generationBody) } });
  await exclusiveJson(join(directory, 'preflight.json'), result);
  preparedCases.add(result);
  return result;
}

/** Offline only: all 24 actual stores must pass before a capability exists. */
export async function prepareSourceBundleComparison(options) {
  const input = snapshotJson(options, { bytes: 16384, nodes: 16, depth: 2 }, 'invalid_source_bundle_options');
  requireTrue(input !== null && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).length === 1 && typeof input.outputRoot === 'string'
    && input.outputRoot.trim() === input.outputRoot && input.outputRoot.length > 0
    && !input.outputRoot.includes('\0'), 'invalid_source_bundle_options');
  const outputRoot = await privateDirectory(input.outputRoot);
  requireTrue((await readdir(outputRoot)).length === 0, 'source_bundle_output_not_fresh');
  const sources = await loadSourceBundleCases();
  await exclusiveJson(join(outputRoot, 'preparation-start.json'), { version: VERSION,
    sourceVersion: SOURCE_BUNDLE_VERSION, sourceSha256: digest(sources), caseIds: sources.map(source => source.id) });
  let caseId = null;
  try {
    const { openMemoryCore } = await import('../../core/contract.mjs');
    const { createOpenAIModel, countOpenAITokens } = await import('../../adapters/openai/index.mjs');
    const cases = [];
    for (const source of sources) { caseId = source.id; cases.push(await prepareCase(sources, source,
      join(outputRoot, source.id), openMemoryCore, countOpenAITokens, createOpenAIModel)); }
    const manifest = detach({ version: VERSION, sourceVersion: SOURCE_BUNDLE_VERSION, model: MODEL,
      sourceSha256: digest(sources), selectionMode: 'bounded-source-scan', contextMode: 'source-evidence',
      sourceCandidatePolicy: 'bounded-keyset-v1', limit: 6, orders: sourceBundleOrders,
      limits: PREFLIGHT_LIMITS, resources: { cases: cases.length,
        cards: cases.reduce((sum, c) => sum + c.mapping.length, 0),
        receipts: cases.reduce((sum, c) => sum + c.mapping.length, 0),
        storeFileBytes: cases.reduce((sum, c) => sum + c.state.fileBytes, 0),
        maximumLocalTokens: Object.fromEntries(Object.keys(cases[0].tokenCounts).map(key =>
          [key, Math.max(...cases.map(c => c.tokenCounts[key]))])) },
      qtWireContractSha256: QT_WIRE_CONTRACT_SHA256, cases: cases.map(c => ({ id: c.id, ...c.hashes })) });
    const observation = freeze({ version: VERSION, outputRoot, eligible: true, cases: Object.freeze(cases),
      manifest, manifestSha256: digest(manifest) });
    await exclusiveJson(join(outputRoot, 'preparation.json'), observation);
    const capability = Object.freeze({ observation });
    preparations.set(capability, { state: 'ready', observation });
    return capability;
  } catch (error) {
    const reason = failureReason(error);
    await exclusiveJson(join(outputRoot, 'preparation-failure.json'), { version: VERSION,
      caseId, eligible: false, reason });
    fail(reason);
  }
}

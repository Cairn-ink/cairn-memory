import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { createRequire } from 'node:module';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';

// Closed build-time profiles: no public policy argument or manifest dispatch.
const ORIGINAL_PROFILE = freeze({
  canonical: false, version: 'receipt-group-first-response-feasibility-v1',
  fixture: './receipt-group-feasibility-cases.json',
  fixtureSha256: '176fba365369bc36e85b371aa209ae1ed32e864b3e14b0bb7fbecbf3b70d5a8d',
  facade: './receipt-group-feasibility.mjs',
  ids: ['rgf-fresh-01', 'rgf-fresh-02', 'rgf-fresh-03', 'rgf-fresh-04', 'rgf-fresh-05', 'rgf-fresh-06'],
  transportVersion: 'receipt-group-plan-rank-v1', schemaName: 'cairn_receipt_group_plan_rank_v1',
  literalSourceDate: '2026/10/09 (Fri) 14:00', sourceDate: '2026-10-09 14:00', queryDate: '2026-10-13 18:00'
});
const CANONICAL_PROFILE = freeze({
  canonical: true, version: 'receipt-group-canonical-first-response-feasibility-v1',
  fixture: './receipt-group-canonical-feasibility-cases.json',
  fixtureSha256: '5d70ab957d81d8fe4b0c8ebbc20c62db33cbe9ce2072d556100fa2474cec4d83',
  facade: './receipt-group-canonical-feasibility.mjs',
  ids: ['rgcf-fresh-01', 'rgcf-fresh-02', 'rgcf-fresh-03', 'rgcf-fresh-04', 'rgcf-fresh-05', 'rgcf-fresh-06'],
  transportVersion: 'receipt-group-canonical-plan-rank-v1', schemaName: 'cairn_receipt_group_canonical_plan_rank_v1',
  literalSourceDate: '2026/10/08 (Thu) 09:15', sourceDate: '2026-10-08 09:15', queryDate: '2026-10-13 19:40'
});

function createFixedCoordinator(profile) {
const VERSION = profile.version;
const FIXTURE = new URL(profile.fixture, import.meta.url);
const FIXTURE_SHA = profile.fixtureSha256;
const IDS = profile.ids;
const CARD_COUNTS = [1, 6, 1, 3, 1, 12], RECEIPT_COUNTS = [1, 6, 3, 3, 6, 12];
const LIMITS = freeze({ cases: 6, generations: 6, intents: 12, reservedMicroUsd: 60000,
  reservationMicroUsd: 5000, protectedMicroUsd: 30000000, cumulativeMicroUsd: 400000000,
  inputTokens: 6000, providerInputTokens: 7024, outputTokens: 1024,
  logicalMs: 30000, caseMs: 200000, runMs: 1200000 });
const preparations = new WeakMap();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const unwrap = result => { if (result?.ok !== true) fail(result?.error?.code ?? 'invalid_recall_provenance'); return result.value; };
function fields(value, keys, code) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(code);
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function data(value, code = 'invalid_receipt_group_manifest') {
  const active = new WeakSet(); let nodes = 0;
  const walk = (item, depth = 0) => {
    if (++nodes > 500000 || depth > 24) fail(code);
    if (!item || typeof item !== 'object') return;
    if (types.isProxy(item) || active.has(item)) fail(code);
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) fail(code);
    active.add(item);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
      if (!Object.hasOwn(descriptor, 'value')) fail(code); walk(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  walk(value);
  return JSON.parse(JSON.stringify(snapshotJson(value, { bytes: 16 * 1024 * 1024, nodes: 1000000, depth: 24 }, code)));
}
function errorCode(error, fallback = 'receipt_group_request_denied') {
  if (!error || typeof error !== 'object' || types.isProxy(error) || !types.isNativeError(error)) return fallback;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
    && /^[a-z][a-z0-9_]{1,127}$/u.test(descriptor.value) ? descriptor.value : fallback;
}
const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid });
function ancestors(path) {
  let current = parse(path).root;
  for (const part of relative(current, path).split('/').filter(Boolean)) {
    current = join(current, part); const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('receipt_group_output_unsafe');
  }
  if (realpathSync(path) !== path) fail('receipt_group_output_unsafe');
}
function rootCheck(root, expected) {
  ancestors(root); const stat = lstatSync(root);
  if ((stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid()
    || expected && !isDeepStrictEqual(identity(stat), expected)) fail('receipt_group_output_unsafe');
  return identity(stat);
}
function fileCheck(path, expected) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
    || stat.uid !== process.getuid() || expected && !isDeepStrictEqual(identity(stat), expected)) fail('receipt_group_output_unsafe');
  return identity(stat);
}
function artifact(owner, name, text, maximum = 8 * 1024 * 1024) {
  rootCheck(owner.outputRoot, owner.rootIdentity);
  if (typeof text !== 'string' || Buffer.byteLength(text) > maximum || !/^[A-Za-z0-9_.-]+$/u.test(name)) fail('receipt_group_artifact_limit');
  const path = join(owner.outputRoot, name);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  rootCheck(owner.outputRoot, owner.rootIdentity);
  const directory = openSync(owner.outputRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return freeze({ path, bytes: Buffer.byteLength(text), sha256: sha(text), identity: fileCheck(path) });
}
const jsonArtifact = (owner, name, value) => artifact(owner, name, JSON.stringify(value) + '\n');
function verifyArtifact(binding) {
  fileCheck(binding.path, binding.identity); const bytes = readFileSync(binding.path);
  if (bytes.length !== binding.bytes || sha(bytes) !== binding.sha256) fail('receipt_group_artifact_drift');
}
function snapshot(path, expected, DatabaseSync) {
  fileCheck(path, expected); const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec('BEGIN');
    const schema = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const tables = Object.fromEntries(schema.filter(row => row.type === 'table').map(row => {
      const quoted = '"' + row.name.replaceAll('"', '""') + '"';
      const rows = database.prepare(`SELECT * FROM ${quoted}`).all().map(row => Object.fromEntries(Object.entries(row)))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      return [row.name, rows];
    }));
    const state = { applicationId: database.prepare('PRAGMA application_id').get().application_id,
      userVersion: database.prepare('PRAGMA user_version').get().user_version, schema, tables };
    database.exec('COMMIT'); fileCheck(path, expected);
    return freeze({ sha256: sha(JSON.stringify(state)), bytes: lstatSync(path).size, state });
  } finally { database.close(); }
}
const SOURCE_DEPENDENCIES = ['../../core/contract.mjs', '../../core/capture-input.mjs', '../../core/source-windows.mjs',
  '../../core/recall.mjs', '../../core/query-candidates.mjs', '../../adapters/openai/index.mjs',
  '../../adapters/openai/profiles.mjs', '../architecture/receipt-group-plan.mjs',
  '../architecture/source-bundle-plan-rank-transport.mjs', '../architecture/receipt-group-canonical-plan.mjs',
  '../longmemeval/mixed-source.mjs', './source-bundle-runner.mjs', '../experiment-budget/index.mjs'];
function dependencies() {
  const require = createRequire(new URL('../../adapters/openai/package.json', import.meta.url));
  const entry = realpathSync(require.resolve('tiktoken')), root = dirname(entry);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== '1.0.22') fail('receipt_group_dependency_drift');
  const pending = [import.meta.url, new URL(profile.facade, import.meta.url).href, ...SOURCE_DEPENDENCIES.map(path => new URL(path, import.meta.url).href)];
  const source = new Map(); let bytes = 0;
  // Fixed module's relative literal source imports only; no execution, corpus
  // JSON, arbitrary entrypoint, bare-module resolution or exported framework.
  while (pending.length) {
    const url = pending.pop(); if (source.has(url)) continue;
    const value = readFileSync(new URL(url)); bytes += value.length;
    if (source.size >= 256 || value.length > 1024 * 1024 || bytes > 8 * 1024 * 1024) fail('receipt_group_dependency_drift');
    source.set(url, sha(value));
    for (const match of value.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"\s]+\.mjs)\1/gu)) {
      pending.push(new URL(match[2], url).href);
    }
  }
  return freeze({ node: process.versions.node, tokenizer: 'tiktoken@1.0.22',
    tokenizerFiles: ['package.json', 'tiktoken.js', 'tiktoken_bg.js', 'tiktoken_bg.wasm', 'tiktoken.cjs', 'tiktoken_bg.cjs']
      .map(name => join(root, name))
      .map(path => ({ path, sha256: sha(readFileSync(path)) })),
    source: [...source].sort(([left], [right]) => left.localeCompare(right)).map(([url, sha256]) => ({ url, sha256 })) });
}
const wrap = text => `[session-date: ${profile.sourceDate}; clock: dataset-local] source{${text} }`;
const query = text => JSON.stringify({ question: text, date: profile.queryDate });
function wires(request) {
  const body = { model: 'gpt-4.1-mini-2025-04-14', instructions: request.system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request.input) }] }],
    text: { format: { type: 'json_schema', name: profile.schemaName, strict: true, schema: request.outputSchema } }, truncation: 'disabled' };
  return [JSON.stringify(body), JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false })];
}

async function prepareReceiptGroupFeasibility(options) {
  const { outputRoot } = fields(options, ['outputRoot'], 'invalid_receipt_group_preparation');
  if (typeof outputRoot !== 'string' || !isAbsolute(outputRoot) || resolve(outputRoot) !== outputRoot
    || outputRoot === parse(outputRoot).root) fail('invalid_receipt_group_preparation');
  let owner, active, current = 0; const observations = [];
  try {
    ancestors(dirname(outputRoot));
    try { mkdirSync(outputRoot, { mode: 0o700 }); } catch { fail('receipt_group_output_not_fresh'); }
    owner = { outputRoot, rootIdentity: rootCheck(outputRoot) };
    const bytes = readFileSync(FIXTURE);
    if (sha(bytes) !== FIXTURE_SHA) fail('receipt_group_source_drift');
    const frozen = freeze(JSON.parse(bytes)), sourceLiteralHashes = frozen.diagnosticsNotForWire.sourceLiteralHashes;
    if (!isDeepStrictEqual(frozen.caseOrder, IDS) || !isDeepStrictEqual(frozen.cases.map(row => row.id), IDS)) fail('receipt_group_source_drift');
    const roster = jsonArtifact(owner, 'planned-roster.json', { version: VERSION, sourceFileSha256: FIXTURE_SHA,
      sourceLiteralHashes, cases: frozen.cases.map((row, ordinal) => ({ id: row.id, ordinal: ordinal + 1, status: 'planned' })) });
    const sourceArtifact = artifact(owner, 'frozen-source-fixture.json', bytes.toString('utf8'));
    // The complete denominator is durable before dependency loading/capture.
    const { DatabaseSync } = await import('node:sqlite');
    const { openMemoryCore } = await import('../../core/contract.mjs');
    const { countOpenAITokens } = await import('../../adapters/openai/index.mjs');
    const preparationModule = profile.canonical
      ? await import('../architecture/receipt-group-canonical-plan.mjs') : await import('../architecture/receipt-group-plan.mjs');
    const prepareReceiptGroupPlan = profile.canonical
      ? preparationModule.prepareCanonicalReceiptGroupPlan : preparationModule.prepareReceiptGroupPlan;
    const prepareMixedSourceCase = profile.canonical
      ? (await import('../longmemeval/mixed-source.mjs')).prepareMixedSourceCase : null;
    const seenMemories = new Set(), seenReceipts = new Set();
    for (const [ordinal, row] of frozen.cases.entries()) {
      current = ordinal;
      if (profile.canonical ? row.namespace.scope !== 'project' || !/^lme-case-[a-f0-9]{64}$/u.test(row.namespace.projectId)
        : row.namespace.scope !== 'personal' || row.namespace.projectId !== null) fail('receipt_group_source_drift');
      const turns = row.history.sessions.flatMap(session => session.turns);
      if (turns.length !== RECEIPT_COUNTS[ordinal] || row.scriptedExtraction.cards.length !== CARD_COUNTS[ordinal]
        || turns.some(turn => turn.content.length > 800 || sha(turn.content) !== sourceLiteralHashes[turn.sourceLabel])) fail('receipt_group_source_drift');
      const path = join(outputRoot, `${row.id}.sqlite`);
      rootCheck(outputRoot, owner.rootIdentity);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      closeSync(fd); const fileIdentity = fileCheck(path); let sessionOrdinal = 0;
      const captures = [];
      // Only the new fixed profile uses the genuine project-scoped ingestion
      // helper. Never rewrite helper-issued capture identities/client/sourceMap.
      const sourcePlan = profile.canonical ? prepareMixedSourceCase({ namespace: row.namespace,
        history: { question_id: row.namespace.projectId, sessions: row.history.sessions.map((session, index) => ({
          session_index: index, session_id: 'lme-session-' + sha(randomUUID()), date: session.date,
          turns: session.turns.map(turn => ({ turn_id: 'lme-turn-' + sha(randomUUID()), role: turn.role, content: turn.content })) })) },
        question: { question_id: row.namespace.projectId, text: row.query.text, date: row.query.date } }) : null;
      if (sourcePlan && (!sourcePlan.cairnPlan.executable || sourcePlan.cairnPlan.batches.length !== row.history.sessions.length
        || sourcePlan.mem0Input.query !== query(row.query.text))) fail('receipt_group_capture_mismatch');
      const base = { contextWindow: 8192, countTokens: countOpenAITokens,
        extract({ input }) {
          const session = row.history.sessions[sessionOrdinal++];
          if (!session || input.messages.length !== session.turns.length) fail('receipt_group_capture_mismatch');
          const labels = new Map();
          for (const turn of session.turns) {
            const matching = input.messages.filter(message => message.role === turn.role && message.content === wrap(turn.content));
            if (matching.length !== 1) fail('receipt_group_capture_mismatch'); labels.set(turn.sourceLabel, matching[0].index);
          }
          const items = row.scriptedExtraction.cards.flatMap(card => card.sourcePartitions
            .filter(partition => partition.every(label => labels.has(label)))
            .map(partition => ({ content: card.content, kind: card.kind, confidence: card.confidence,
              sourceIndices: partition.map(label => labels.get(label)) })));
          if (!items.length || items.length > 5 || items.some(item => item.sourceIndices.length > 4)) fail('receipt_group_capture_mismatch');
          return { items };
        }, classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
      active = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' });
      const client = randomUUID();
      for (const [sessionIndex, session] of row.history.sessions.entries()) {
        if (session.date !== profile.literalSourceDate) fail('receipt_group_source_drift');
        const captureInput = sourcePlan ? sourcePlan.cairnPlan.batches[sessionIndex].captureInput
          : { namespace: row.namespace, client, sessionId: randomUUID(), eventId: randomUUID(),
            messages: session.turns.map(turn => ({ id: randomUUID(), role: turn.role, content: wrap(turn.content) })) };
        const result = unwrap(await active.capture(captureInput));
        if (result.admission.memories.length !== 1 || result.duplicate !== false) fail('receipt_group_capture_mismatch');
        const memory = result.admission.memories[0], detail = unwrap(active.get({ namespace: row.namespace, memoryId: memory.id, receiptLimit: 100 }));
        if (seenMemories.has(memory.id) || !detail.exhausted || detail.receipts.length !== session.turns.length) fail('receipt_group_capture_mismatch');
        seenMemories.add(memory.id);
        const actual = detail.receipts.map(receipt => [receipt.role, receipt.excerpt]).sort();
        const expected = session.turns.map(turn => [turn.role, wrap(turn.content)]).sort();
        if (!isDeepStrictEqual(actual, expected)) fail('receipt_group_capture_mismatch');
        for (const receipt of detail.receipts) {
          if (seenReceipts.has(receipt.id) || receipt.sessionId !== captureInput.sessionId
            || !captureInput.messages.some(message => message.id === receipt.eventId)) fail('receipt_group_capture_mismatch');
          seenReceipts.add(receipt.id);
        }
        captures.push({ captureInput, result, memory: detail.memory, receipts: detail.receipts });
      }
      active.close(); active = null;
      const before = snapshot(path, fileIdentity, DatabaseSync); let rankRequest, ranks = 0, selects = 0;
      active = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1', model: { ...base,
        select() { selects++; fail('receipt_group_select_forbidden'); },
        rank(request) { ranks++; rankRequest = data({ system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens }); return { refs: [] }; } } });
      const map = unwrap(active.map({ namespace: row.namespace, purpose: 'recall', tokenBudget: 4000 }));
      const recall = unwrap(await active.recall({ readSet: [row.namespace], query: query(row.query.text), limit: 6,
        contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
      active.close(); active = null;
      const after = snapshot(path, fileIdentity, DatabaseSync);
      if (ranks !== 1 || selects !== 0 || !isDeepStrictEqual(before, after) || !map.exhausted || map.nextCursor !== null
        || map.items.length !== CARD_COUNTS[ordinal] || rankRequest?.input.candidates.length !== CARD_COUNTS[ordinal]
        || recall.coverage !== 'complete' || recall.recallTruncated || recall.selection.strategy !== 'complete-map') fail('receipt_group_cold_mismatch');
      const captureById = new Map(captures.map(capture => [capture.memory.id, capture]));
      for (const card of rankRequest.input.candidates) {
        const captured = captureById.get(card.memory.id);
        if (!captured || card.memory.revision !== captured.memory.revision || card.receiptCount !== captured.receipts.length
          || !isDeepStrictEqual(card.receipts, captured.receipts.map(receipt => ({ id: receipt.id, role: receipt.role, excerpt: receipt.excerpt })))) fail('receipt_group_cold_mismatch');
      }
      const prepared = prepareReceiptGroupPlan({ ...rankRequest, signal: new AbortController().signal }, countOpenAITokens);
      const [count, generation] = wires(prepared.request);
      const tokenWitnesses = Object.fromEntries([['actualRequest', JSON.stringify(prepared.request)], ['count', count], ['generation', generation]]
        .map(([name, text]) => { const tokens = countOpenAITokens(text); if (tokens <= 0 || tokens > 6000) fail('context_budget_exceeded');
          return [name, { text, sha256: sha(text), tokens }]; }));
      const observation = freeze({ id: row.id, ordinal: ordinal + 1, path, fileIdentity, namespace: row.namespace,
        ...(sourcePlan ? { sourcePlan } : {}),
        query: query(row.query.text), captures, rankRequest, request: prepared.request, preparedRequestSha256: prepared.requestSha256,
        scanOrder: rankRequest.input.candidates.map(card => card.memory.id), ranks, selects, map, recall, state: after, tokenWitnesses });
      const binding = jsonArtifact(owner, `${row.id}-preparation.json`, observation);
      observations.push(freeze({ ...observation, artifact: binding }));
    }
    if (seenMemories.size !== 24 || seenReceipts.size !== 31) fail('receipt_group_capture_mismatch');
    if (observations[5].tokenWitnesses.generation.tokens <= Math.max(...observations.slice(0, 5).map(row => row.tokenWitnesses.generation.tokens))) fail('receipt_group_pressure_mismatch');
    const observation = freeze({ version: VERSION, ...owner, sourceFileSha256: FIXTURE_SHA, sourceLiteralHashes,
      sourceArtifact, roster, dependencies: dependencies(), cases: observations, cardCount: 24, receiptCount: 31,
      extraction: 'scripted-normal-indexed-capture-v1', semanticSufficiency: 'unassessed' });
    const preparationArtifact = jsonArtifact(owner, 'preparation.json', { ...observation,
      cases: observations.map(row => ({ id: row.id, artifact: row.artifact, preparedRequestSha256: row.preparedRequestSha256, tokenWitnesses: row.tokenWitnesses })) });
    const capability = Object.freeze({ observation });
    preparations.set(capability, { observation, preparationArtifact, frozen, DatabaseSync, openMemoryCore, countOpenAITokens, consumed: false });
    return capability;
  } catch (error) {
    try { active?.close(); } catch { /* Retain the original preparation boundary. */ }
    if (owner) {
      try { jsonArtifact(owner, 'preparation-failed.json', { version: VERSION, failure: { code: errorCode(error, 'receipt_group_preparation_failed') },
        cases: IDS.map((id, ordinal) => ({ id, status: ordinal < observations.length ? 'prepared' : ordinal === current ? 'failed' : 'not-prepared',
          ...(observations[ordinal] ? { artifact: observations[ordinal].artifact } : {}) })) }); } catch { /* Never replace the first failure. */ }
    }
    throw error;
  }
}

function createReceiptGroupFeasibilityManifest(observation) {
  const clean = data(observation);
  if (clean.version !== VERSION || clean.sourceFileSha256 !== FIXTURE_SHA || clean.cardCount !== 24 || clean.receiptCount !== 31
    || !isDeepStrictEqual(clean.cases.map(row => row.id), IDS)) fail('invalid_receipt_group_manifest');
  return freeze({ version: VERSION, caseOrder: IDS, sourceFileSha256: FIXTURE_SHA, sourceLiteralHashes: clean.sourceLiteralHashes,
    preparationSha256: sha(JSON.stringify(clean)), dependencies: clean.dependencies, limits: LIMITS,
    cases: clean.cases.map(row => ({ id: row.id, slotId: `${row.id}-receipt-group`, preparedRequestSha256: row.preparedRequestSha256,
      storeSha256: row.state.sha256, artifact: row.artifact, tokenWitnesses: row.tokenWitnesses })) });
}

const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const nativeOn = EventTarget.prototype.addEventListener, nativeOff = EventTarget.prototype.removeEventListener;
const clock = performance, now = performance.now;
const globalClockDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const dateNow = Date.now, schedule = setTimeout, unschedule = clearTimeout;
function descriptorOwner(object, key) {
  for (let current = object; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return { owner: current, descriptor };
  }
  return null;
}
const clockDescriptor = descriptorOwner(clock, 'now');
function clockCheck() {
  const current = descriptorOwner(clock, 'now');
  if (!isDeepStrictEqual(Object.getOwnPropertyDescriptor(globalThis, 'performance'), globalClockDescriptor)
    || !current || current.owner !== clockDescriptor.owner || !isDeepStrictEqual(current.descriptor, clockDescriptor.descriptor)
    || Object.getOwnPropertyDescriptor(Date, 'now')?.value !== dateNow
    || Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')?.value !== schedule
    || Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout')?.value !== unschedule) fail('receipt_group_clock_mutated');
}
function signalState(signal) {
  try {
    if (!signal || typeof signal !== 'object' || types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype
      || Reflect.ownKeys(Object.getOwnPropertyDescriptors(signal)).some(key =>
        !Object.hasOwn(Object.getOwnPropertyDescriptor(signal, key), 'value'))) fail('request_mutated');
    return nativeAborted.call(signal);
  } catch { fail('request_mutated'); }
}
const checkpointOf = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd });
const bindingOf = state => ({ ...checkpointOf(state), historySha256: state.historySha256 });
function coverage(owner, ordinal, compiled, details) {
  const row = owner.frozen.cases[ordinal], labels = new Map();
  for (const session of row.history.sessions) for (const turn of session.turns) {
    const matching = [...details.values()].flatMap(detail => detail.receipts)
      .filter(receipt => receipt.role === turn.role && receipt.excerpt === wrap(turn.content));
    if (matching.length !== 1) fail('invalid_recall_provenance'); labels.set(turn.sourceLabel, matching[0].id);
  }
  const selected = [...new Set((profile.canonical ? compiled.canonicalProposal : compiled.proposal).groups.flatMap(group => [...group.contextReceiptIds, group.terminalReceiptId]))];
  const available = compiled.refs.flatMap(ref => details.get(ref.memoryId).receipts.map(receipt => receipt.id));
  const anchors = owner.frozen.diagnosticsNotForWire.expectedSourceAnchors[row.id];
  const anchorRows = anchors.map(sourceLabel => ({ sourceLabel, receiptId: labels.get(sourceLabel),
    selectedEndpoint: selected.includes(labels.get(sourceLabel)), chosenCardSourceAvailable: available.includes(labels.get(sourceLabel)) }));
  const groups = (profile.canonical ? compiled.canonicalProposal : compiled.proposal).groups, nonempty = compiled.refs.length > 0;
  const mentioned = groups.flatMap(group => [...group.contextReceiptIds, group.terminalReceiptId]);
  const roles = new Set([...details.values()].flatMap(detail => detail.receipts)
    .filter(receipt => mentioned.includes(receipt.id)).map(receipt => receipt.role));
  const contexts = groups.flatMap(group => group.contextReceiptIds);
  const exercise = ordinal === 0 ? nonempty : ordinal === 1 ? nonempty && compiled.refs.length < 6
    : ordinal === 2 ? roles.size === 2 && groups.some(group => group.contextReceiptIds.length > 0)
    : ordinal === 3 ? groups.length >= 2 && new Set(contexts).size < contexts.length
    : ordinal === 4 ? compiled.refs.length === 1 && selected.length === 6 : groups.length >= 3 && compiled.refs.length >= 3;
  return { selectedReceiptIds: selected, chosenCardSourceAvailability: { receiptIds: available, deliveredAnswerContext: false },
    sourceAnchorDiagnostics: anchorRows, structuralExercise: { shape: row.shape, elicited: exercise, semanticSufficiency: 'unassessed' } };
}

async function runReceiptGroupFeasibility(options) {
  // Resolve authority without evaluating arbitrary option getters or proxies.
  if (!options || typeof options !== 'object' || types.isProxy(options)) fail('invalid_receipt_group_preparation');
  const descriptor = Object.getOwnPropertyDescriptor(options, 'preparation');
  const owner = descriptor && Object.hasOwn(descriptor, 'value') ? preparations.get(descriptor.value) : null;
  if (!owner || owner.consumed) fail('invalid_receipt_group_preparation');
  owner.consumed = true;
  const observation = owner.observation;
  const report = { version: VERSION, denominator: 6, status: 'running', failure: null, manifest: null,
    cases: IDS.map((id, ordinal) => ({ id, ordinal: ordinal + 1, slotId: `${id}-receipt-group`, status: 'not-run',
      prepared: true, dispatched: false, generated: false, compiled: false, failure: null, transportHealth: null })),
    resources: { physicalCalls: 0, reservedIntents: 0, generations: 0, unknownIntents: 0 }, attempts: [], checkpoints: [],
    structuralGate: { requiredCompiledNonempty: 5, compiledNonempty: 0, passed: false, meaning: 'engineering-feasibility-only' } };
  let opts, configuration, initial, expected, current, transport, guard, core, pendingPort, portFailure;
  let fatalCode = null, runTimer, caseTimer, caseDeadline, controller, callerListener, inspect;
  const runDeadline = now.call(clock) + LIMITS.runMs;
  const mark = code => { fatalCode ??= code; };
  const callback = (fn, value) => {
    try { const returned = fn(freeze(data(value, 'record_persistence_failed')));
      if (returned !== undefined) { if (types.isPromise(returned)) Promise.prototype.then.call(returned, undefined, () => {});
        fail('record_persistence_failed'); }
    } catch { mark('record_persistence_failed'); fail('record_persistence_failed'); }
  };
  function integrity() {
    clockCheck(); rootCheck(observation.outputRoot, observation.rootIdentity);
    if (sha(readFileSync(FIXTURE)) !== FIXTURE_SHA || !isDeepStrictEqual(dependencies(), observation.dependencies)) fail('receipt_group_source_drift');
    verifyArtifact(observation.roster); verifyArtifact(observation.sourceArtifact); verifyArtifact(owner.preparationArtifact);
    for (const row of observation.cases) verifyArtifact(row.artifact);
    if (opts && signalState(opts.signal)) fail('cancelled');
    if (current) {
      const row = observation.cases[current.ordinal - 1];
      if (!isDeepStrictEqual(snapshot(row.path, row.fileIdentity, owner.DatabaseSync), row.state)) fail('receipt_group_store_drift');
    }
  }
  function ensure() {
    integrity();
    if (fatalCode) fail(fatalCode);
    if (controller && nativeAborted.call(controller.signal)) fail('cancelled');
    if (now.call(clock) >= Math.min(runDeadline, caseDeadline ?? runDeadline)) fail('receipt_group_absolute_deadline');
  }
  function record(raw) {
    const row = data(raw, 'record_persistence_failed');
    if (!current || row.slotId !== current.slotId || row.version !== profile.transportVersion
      || row.preparedRequestSha256 !== observation.cases[current.ordinal - 1].preparedRequestSha256) {
      mark('receipt_group_wire_drift'); fail('receipt_group_wire_drift');
    }
    let intent = report.attempts.find(value => value.attemptId === row.attemptId);
    if (row.phase === 'pre') {
      ensure();
      if (intent || report.attempts.length >= 12 || row.reservedMicroUsd !== 5000 || !['count', 'generation'].includes(row.kind)) fail('receipt_group_accounting_failed');
      const expectedBody = observation.cases[current.ordinal - 1].tokenWitnesses[row.kind === 'count' ? 'count' : 'generation'].text;
      if (row.requestBody !== expectedBody || row.requestSha256 !== sha(expectedBody)) { mark('receipt_group_wire_drift'); fail('receipt_group_wire_drift'); }
      intent = { attemptId: row.attemptId, slotId: row.slotId, kind: row.kind, dispatched: false,
        requestArtifact: artifact(observation, `${row.attemptId}-request.txt`, row.requestBody, 262144), pre: row, post: null };
      report.attempts.push(intent); report.resources.reservedIntents++;
    } else if (row.phase !== 'post' || !intent || intent.post) fail('receipt_group_accounting_failed');
    if (row.phase === 'post') {
      intent.post = row;
      if (typeof row.responseBody === 'string') intent.responseArtifact = artifact(observation, `${row.attemptId}-response.txt`, row.responseBody, 262144 * 3);
      else intent.responseAbsenceReason = row.failureCode === 'credential_echo' ? 'withheld-credential-echo' : 'not-permitted-or-unavailable';
    }
    const persisted = { ...row, requestArtifact: intent.requestArtifact,
      ...(intent.responseArtifact ? { responseArtifact: intent.responseArtifact } : {}) };
    delete persisted.requestBody; delete persisted.responseBody;
    jsonArtifact(observation, `record-${String(report.attempts.indexOf(intent) * 2 + (row.phase === 'pre' ? 1 : 2)).padStart(3, '0')}.json`, persisted);
    callback(opts.onRecord, raw);
  }
  function reconcile() {
    const actual = inspect(configuration);
    const delta = actual.attempts.slice(expected.attempts.length);
    const known = report.attempts.filter(row => row.slotId === current.slotId);
    if (actual.schemaVersion !== 2 || actual.state !== 'open' || actual.runId !== configuration.runId
      || actual.limitMicroUsd !== configuration.limitMicroUsd || actual.requestCap !== configuration.requestCap
      || !isDeepStrictEqual(actual.attempts.slice(0, expected.attempts.length), expected.attempts)
      || actual.requestCount !== expected.requestCount + delta.length || actual.attempts.length !== actual.requestCount
      || actual.reservedMicroUsd !== expected.reservedMicroUsd + delta.length * 5000
      || !isDeepStrictEqual(delta.map(row => row.attemptId), known.map(row => row.attemptId))
      || delta.some(row => row.outcome === null)
      || known.some((row, index) => !row.post || row.post.outcome !== delta[index].outcome
        || row.post.actualMicroUsd !== delta[index].actualMicroUsd)) fail('receipt_group_accounting_failed');
    const transition = { sequence: report.checkpoints.length + 1, slotId: current.slotId, before: bindingOf(expected), after: bindingOf(actual), deltas: delta };
    jsonArtifact(observation, `checkpoint-${String(transition.sequence).padStart(3, '0')}.json`, transition);
    expected = actual; report.checkpoints.push(transition); callback(opts.onCheckpoint, transition);
    return actual;
  }
  async function finishPort() {
    if (pendingPort) { try { await pendingPort; } catch (error) { portFailure ??= errorCode(error); } pendingPort = null; }
    // Health is mandatory on *all* terminal paths, before public-error classification.
    if (transport) {
      try { current.transportHealth = transport.health(); }
      catch { current.transportHealth = { state: 'unhealthy', fatalCode: 'receipt_group_accounting_failed' }; }
      if (current.transportHealth.fatalCode) mark(current.transportHealth.fatalCode);
      if (current.transportHealth.state !== 'consumed') mark('receipt_group_accounting_failed');
      let caught;
      try { reconcile(); } catch (error) { caught = error; mark(errorCode(error)); }
      try { transport.close(); } catch (error) { caught ??= error; mark(errorCode(error)); }
      transport = null; guard?.close(); guard = null;
      if (caught) throw caught;
    } else { guard?.close(); guard = null; }
  }
  try {
    opts = fields(options, ['preparation', 'manifest', 'configuration', 'checkpoint', 'historySha256',
      'apiKey', 'fetchImpl', 'signal', 'onRecord', 'onCheckpoint'], 'invalid_receipt_group_configuration');
    const manifest = createReceiptGroupFeasibilityManifest(observation);
    if (!isDeepStrictEqual(data(opts.manifest), manifest)) fail('invalid_receipt_group_manifest');
    report.manifest = manifest;
    configuration = data(opts.configuration, 'invalid_receipt_group_configuration');
    const checkpoint = data(opts.checkpoint, 'invalid_receipt_group_configuration');
    if (typeof opts.apiKey !== 'string' || opts.apiKey.length < 8 || typeof opts.fetchImpl !== 'function'
      || typeof opts.onRecord !== 'function' || typeof opts.onCheckpoint !== 'function'
      || configuration.limitMicroUsd !== 400000000) fail('invalid_receipt_group_configuration');
    signalState(opts.signal); integrity();
    for (const row of observation.cases) {
      if (!isDeepStrictEqual(snapshot(row.path, row.fileIdentity, owner.DatabaseSync), row.state)) fail('receipt_group_store_drift');
    }
    ({ inspectEmbeddingExperimentBudgetSnapshot: inspect } = await import('../experiment-budget/index.mjs'));
    initial = inspect(configuration); expected = initial;
    if (initial.schemaVersion !== 2 || initial.state !== 'open' || initial.requestCount !== checkpoint.requestCount
      || initial.reservedMicroUsd !== checkpoint.reservedMicroUsd || initial.historySha256 !== opts.historySha256
      || initial.attempts.length !== initial.requestCount || initial.attempts.some(row => row.outcome === null)) fail('ledger_failed');
    if (400000000 - initial.reservedMicroUsd - 30000000 < 60000 || configuration.requestCap - initial.requestCount < 12) fail('budget_blocked');
    report.originalHistory = artifact(observation, 'original-ledger-history.json', JSON.stringify(initial), 64 * 1024 * 1024);
    jsonArtifact(observation, 'run-start.json', { version: VERSION, manifest, ledger: bindingOf(initial) });
    controller = new AbortController(); callerListener = () => { mark('cancelled'); controller.abort(); };
    nativeOn.call(opts.signal, 'abort', callerListener, { once: true });
    if (signalState(opts.signal)) callerListener();
    runTimer = schedule(() => { mark('receipt_group_absolute_deadline'); controller.abort(); }, Math.max(0, runDeadline - now.call(clock)));
    const { createSourceBundleGuard } = await import('./source-bundle-runner.mjs');
    const transports = await import('../architecture/source-bundle-plan-rank-transport.mjs');
    const createReceiptGroupPlanRankTransport = profile.canonical
      ? transports.createCanonicalReceiptGroupPlanRankTransport : transports.createReceiptGroupPlanRankTransport;
    const invocations = profile.canonical
      ? await import('../architecture/receipt-group-canonical-plan.mjs') : await import('../architecture/receipt-group-plan.mjs');
    const createReceiptGroupInvocation = profile.canonical
      ? invocations.createCanonicalReceiptGroupInvocation : invocations.createReceiptGroupInvocation;
    for (const [ordinal, prepared] of observation.cases.entries()) {
      ensure(); current = report.cases[ordinal]; portFailure = null;
      caseDeadline = now.call(clock) + LIMITS.caseMs;
      caseTimer = schedule(() => { mark('receipt_group_absolute_deadline'); controller.abort(); }, LIMITS.caseMs);
      let caught = null, compiled;
      try {
        ensure();
        guard = createSourceBundleGuard({ fetchImpl: opts.fetchImpl, signal: controller.signal,
          deadline: Math.min(runDeadline, caseDeadline), onFatal(code) { mark(code); controller.abort(); },
          onDispatch() {
            ensure(); const intent = report.attempts.filter(row => row.slotId === current.slotId).at(-1);
            if (!intent || intent.dispatched) fail('receipt_group_accounting_failed');
            intent.dispatched = true; current.dispatched = true; report.resources.physicalCalls++;
            if (intent.kind === 'generation') { current.generated = true; report.resources.generations++; }
          } });
        transport = await createReceiptGroupPlanRankTransport({ configuration, checkpoint: checkpointOf(expected), historySha256: expected.historySha256,
          manifest: { version: profile.transportVersion, slotId: current.slotId, preparedRequestSha256: prepared.preparedRequestSha256,
            runDeadline, caseDeadline }, apiKey: opts.apiKey, fetchImpl: guard.fetch, onRecord: record });
        const invocation = createReceiptGroupInvocation({ contextWindow: 8192, countTokens: owner.countOpenAITokens,
          select() { fail('receipt_group_select_forbidden'); }, rank() { fail('receipt_group_rank_fallback_forbidden'); } },
        { planRank(request) {
          ensure(); const actual = data({ system: request.system, input: request.input, outputSchema: request.outputSchema, maxOutputTokens: request.maxOutputTokens });
          if (!isDeepStrictEqual(actual, prepared.request)) fail('receipt_group_wire_drift');
          pendingPort = transport.planRank(request);
          return pendingPort.catch(error => { portFailure = errorCode(error); throw error; });
        } });
        core = owner.openMemoryCore({ path: prepared.path, model: invocation.model, sourceCandidatePolicy: 'bounded-keyset-v1' });
        const recalled = await core.recall({ readSet: [prepared.namespace], query: prepared.query, limit: 6,
          contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
        if (pendingPort) { try { await pendingPort; } catch (error) { portFailure ??= errorCode(error); } pendingPort = null; }
        if (recalled.ok !== true) fail(portFailure ?? recalled.error.code);
        if (recalled.value.coverage !== 'complete' || recalled.value.recallTruncated || recalled.value.selection.strategy !== 'complete-map') fail('invalid_recall_provenance');
        compiled = invocation.takePlan();
        const details = new Map();
        for (const captured of prepared.captures) {
          const detail = unwrap(core.get({ namespace: prepared.namespace, memoryId: captured.memory.id, receiptLimit: 100 }));
          if (!detail.exhausted || !isDeepStrictEqual(detail.memory, captured.memory) || !isDeepStrictEqual(detail.receipts, captured.receipts)) fail('invalid_recall_provenance');
          details.set(detail.memory.id, detail);
        }
        const post = report.attempts.find(row => row.slotId === current.slotId && row.kind === 'generation')?.post;
        current.compiled = true; current.proposal = compiled.proposal; current.refs = compiled.refs;
        current.actualRequestSha256 = compiled.requestSha256; current.actualProposalSha256 = compiled.proposalSha256;
        current.derivedAssemblyRequestSha256 = compiled.derivedAssemblyRequestSha256;
        current.derivedAssemblyProposal = compiled.diagnostics.derivedAssemblyProposal;
        current.derivedAssemblyProposalSha256 = compiled.diagnostics.derivedAssemblyProposalSha256;
        current.refsSha256 = sha(JSON.stringify({ refs: compiled.refs })); current.rawResponseSha256 = post?.responseSha256 ?? null;
        current.provenanceOrigin = compiled.origin;
        current.tokenLengths = { actualProposal: owner.countOpenAITokens(JSON.stringify(compiled.proposal)),
          derivedAssemblyProposal: owner.countOpenAITokens(JSON.stringify(compiled.diagnostics.derivedAssemblyProposal)),
          refs: owner.countOpenAITokens(JSON.stringify({ refs: compiled.refs })) };
        if (profile.canonical) Object.assign(current, {
          transportVersion: profile.transportVersion, schemaName: profile.schemaName,
          canonicalProposal: compiled.canonicalProposal, canonicalProposalSha256: compiled.canonicalProposalSha256,
          canonicalization: compiled.canonicalization,
          derivedReceiptGroupRequestSha256: compiled.derivedReceiptGroupRequestSha256,
          derivedReceiptGroupProposalSha256: compiled.derivedReceiptGroupProposalSha256 });
        if (profile.canonical) current.tokenLengths.canonicalProposal = owner.countOpenAITokens(JSON.stringify(compiled.canonicalProposal));
        Object.assign(current, coverage(owner, ordinal, compiled, details));
      } catch (error) { caught = error; current.failure = { code: portFailure ?? errorCode(error) }; }
      finally {
        try { await finishPort(); } catch (error) { caught ??= error; current.failure ??= { code: errorCode(error) }; }
        try { core?.close(); } catch (error) { mark('receipt_group_store_close_failed'); caught ??= error; }
        core = null; unschedule(caseTimer); caseTimer = null;
      }
      // Audit independent of ordinary model error/cancellation classification.
      try { integrity(); } catch (error) { mark(errorCode(error)); caught ??= error; current.failure ??= { code: errorCode(error) }; }
      const localTimeout = ['cancelled', 'deadline_exceeded', 'model_timeout'].includes(current.failure?.code);
      const continuationChecks = { pendingPortSettled: pendingPort === null, callerActive: false,
        globalDeadlineActive: now.call(clock) < Math.min(runDeadline, caseDeadline), ledgerReconciled: false,
        consumed: current.transportHealth?.state === 'consumed', nonfatalHealth: current.transportHealth?.fatalCode === null,
        persistenceIntegrity: !fatalCode };
      try { continuationChecks.callerActive = !signalState(opts.signal) && !nativeAborted.call(controller.signal); }
      catch (error) { mark(errorCode(error)); }
      if (expected) continuationChecks.ledgerReconciled = isDeepStrictEqual(bindingOf(inspect(configuration)), bindingOf(expected))
        && expected.attempts.every(row => row.outcome !== null);
      if (localTimeout) current.continuationChecks = continuationChecks;
      current.status = caught ? 'failed' : 'completed';
      current.artifact = jsonArtifact(observation, `${current.id}-result.json`, current);
      const ordinary = ['provider_failed', 'provider_failure', 'invalid_model_output', 'invalid_response', 'response_too_large'];
      if (caught && (!ordinary.includes(current.failure.code) && !(localTimeout && Object.values(continuationChecks).every(Boolean)))) mark(current.failure.code);
      if (fatalCode) fail(fatalCode);
      current = null; caseDeadline = null;
    }
    report.status = 'completed';
  } catch (error) {
    mark(errorCode(error)); report.status = 'failed'; report.failure = { code: fatalCode };
  } finally {
    try { await finishPort(); } catch (error) { mark(errorCode(error)); }
    try { core?.close(); } catch { mark('receipt_group_store_close_failed'); }
    guard?.close(); unschedule(caseTimer); unschedule(runTimer);
    if (opts?.signal && callerListener) { try { nativeOff.call(opts.signal, 'abort', callerListener); } catch { mark('request_mutated'); } }
  }
  if (fatalCode) { report.status = 'failed'; report.failure = { code: fatalCode }; }
  if (initial && inspect) {
    try {
      const final = inspect(configuration);
      if (!isDeepStrictEqual(final.attempts.slice(0, initial.attempts.length), initial.attempts)
        || final.attempts.some(row => row.outcome === null)) fail('receipt_group_accounting_failed');
      report.resources.unknownIntents = final.attempts.slice(initial.attempts.length).filter(row => row.outcome === 'unknown').length;
      report.ledgerReconciliation = { runId: final.runId, prefixUnchanged: true, final: bindingOf(final), pendingIntents: 0 };
    } catch (error) { report.status = 'failed'; report.failure = { code: errorCode(error) }; }
  }
  report.structuralGate.compiledNonempty = report.cases.filter(row => row.compiled && row.refs?.length > 0).length;
  report.structuralGate.passed = report.status === 'completed' && report.structuralGate.compiledNonempty >= 5
    && report.ledgerReconciliation?.pendingIntents === 0;
  const final = freeze(data(report, 'receipt_group_artifact_limit'));
  jsonArtifact(observation, 'feasibility-report.json', final);
  return final;
}

return Object.freeze({ prepareReceiptGroupFeasibility, createReceiptGroupFeasibilityManifest, runReceiptGroupFeasibility });

}

export const originalReceiptGroupFeasibility = createFixedCoordinator(ORIGINAL_PROFILE);
export const canonicalReceiptGroupFeasibility = createFixedCoordinator(CANONICAL_PROFILE);

import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual, types } from 'node:util';
import { freeze } from '../longmemeval/mixed-validation.mjs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

export { freeze };
export const comparisonVersion = 'receipt-group-canonical-first-answer-comparison-v1';
export const comparisonIds = freeze(Array.from({ length: 24 }, (_, n) => `RQ${String(n + 1).padStart(2, '0')}`));
export const comparisonLimits = freeze({ intents: 144, generations: 96, reservedMicroUsd: 720000,
  reservationMicroUsd: 5000, openingIntents: 2111, openingMicroUsd: 10715000, protectedMicroUsd: 30000000,
  cumulativeMicroUsd: 400000000, inputTokens: 6000, providerInputTokens: 7024, selectionOutputTokens: 1024,
  answerOutputTokens: 512, logicalMs: 30000, physicalMs: 200000, caseMs: 1200000, runMs: 28800000 });
const fixtureUrl = new URL('./receipt-group-canonical-comparison-cases.json', import.meta.url);
export const canonicalComparisonSourceSha256 = '99576fcbe40d1a228d81bdc0f135e3358269e994b724821d036de3e9f65efa25';
const preparations = new WeakMap();
const preparationContexts = new WeakSet(), artifactOwners = new WeakSet();
export const comparisonSha = bytes => createHash('sha256').update(bytes).digest('hex');
export const comparisonFail = code => { throw Object.assign(new Error(code), { code }); };
export const comparisonUnwrap = result => { if (result?.ok !== true) comparisonFail(result?.error?.code ?? 'invalid_recall_provenance'); return result.value; };
export function comparisonFields(value, keys, code = 'invalid_comparison_input') {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) comparisonFail(code);
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).length !== keys.length || keys.some(key => !d[key] || !d[key].enumerable || !Object.hasOwn(d[key], 'value'))) comparisonFail(code);
  return Object.fromEntries(keys.map(key => [key, d[key].value]));
}
export function comparisonData(value, code = 'invalid_comparison_input') {
  const active = new WeakSet(); let nodes = 0;
  const walk = (item, depth = 0) => {
    if (++nodes > 1000000 || depth > 32) comparisonFail(code);
    if (item === null || ['boolean', 'string'].includes(typeof item) || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || types.isProxy(item) || active.has(item)) comparisonFail(code);
    if (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) comparisonFail(code);
    active.add(item); const d = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(d);
    if (Array.isArray(item) && (keys.length !== item.length + 1 || Array.from({ length: item.length }, (_, n) => String(n)).some(key => !d[key]))) comparisonFail(code);
    for (const key of keys) { if (typeof key !== 'string' || !Object.hasOwn(d[key], 'value') || key !== 'length' && !d[key].enumerable) comparisonFail(code); walk(d[key].value, depth + 1); }
    active.delete(item);
  };
  walk(value); const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) comparisonFail(code);
  return freeze(JSON.parse(text));
}
export function comparisonErrorCode(error, fallback = 'comparison_failed') {
  if (!error || types.isProxy(error) || !types.isNativeError(error)) return fallback;
  const d = Object.getOwnPropertyDescriptor(error, 'code');
  return d && Object.hasOwn(d, 'value') && typeof d.value === 'string' && /^[a-z][a-z0-9_]{1,127}$/u.test(d.value) ? d.value : fallback;
}
const normalize = text => redactSecrets(text.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
export function comparisonDate(value) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) \((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\) (\d{2}):(\d{2})$/u.exec(value ?? '');
  if (!m) comparisonFail('invalid_comparison_source');
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[5], +m[6]));
  if (+m[1] < 1900 || +m[1] > 9999 || +m[5] > 23 || +m[6] > 59 || date.getUTCFullYear() !== +m[1]
    || date.getUTCMonth() !== +m[2] - 1 || date.getUTCDate() !== +m[3] || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()] !== m[4]) comparisonFail('invalid_comparison_source');
  return { label: `${m[1]}-${m[2]}-${m[3]} ${m[5]}:${m[6]}`, order: date.getTime() };
}
export const comparisonWrap = (session, turn) => `[session-date: ${comparisonDate(session.date).label}; clock: dataset-local] source{${normalize(turn.content)} }`;
const families = ['detail-retention', 'lexical-paraphrase-cjk', 'multi-session-links', 'event-time-late-import', 'proposal-adoption-premise', 'unknown-conflict'];
const variants = [['nonopening-number', 'middle-condition', 'tail-exception', 'attributed-assistant-instruction'],
  ['exact-lexical', 'paraphrase-without-shared-keyword', 'chinese-query', 'mixed-language-alias'],
  ['two-session-dependency', 'three-session-chain', 'distractor-link', 'missing-link-abstention'],
  ['event-versus-ingestion-time', 'late-old-import', 'relative-date', 'overlapping-scopes'],
  ['unadopted-proposal', 'explicit-adoption', 'premise-changed-reconfirm', 'reaffirmation-without-replacement'],
  ['absent-source', 'unresolved-conflict', 'partial-support', 'quoted-third-party-claim']];
export function validateCanonicalComparisonSource(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024 * 1024) comparisonFail('invalid_comparison_source');
  let value; try { value = comparisonData(JSON.parse(raw), 'invalid_comparison_source'); } catch { comparisonFail('invalid_comparison_source'); }
  comparisonFields(value, ['version', 'caseOrder', 'cases'], 'invalid_comparison_source');
  if (value.version !== 'receipt-group-canonical-comparison-cases-v1' || !isDeepStrictEqual(value.caseOrder, comparisonIds) || value.cases.length !== 24) comparisonFail('invalid_comparison_source');
  const labels = new Set(), hashes = Object.create(null), queries = new Set(); let turns = 0, cards = 0;
  const text = (s, max) => typeof s === 'string' && s.isWellFormed() && s.trim() && !s.includes('\0') && s.length <= max;
  for (const [ordinal, row] of value.cases.entries()) {
    comparisonFields(row, ['id', 'family', 'variant', 'namespace', 'query', 'history', 'scriptedExtraction'], 'invalid_comparison_source');
    const count = [6, 8, 10, 12][ordinal % 4];
    if (row.id !== comparisonIds[ordinal] || row.family !== families[Math.floor(ordinal / 4)]
      || row.variant !== variants[Math.floor(ordinal / 4)][ordinal % 4]) comparisonFail('invalid_comparison_source');
    comparisonFields(row.namespace, ['ownerId', 'scope', 'projectId'], 'invalid_comparison_source');
    if (!isDeepStrictEqual(row.namespace, { ownerId: 'canonical-comparison-source-only', scope: 'project', projectId: 'lme-case-' + comparisonSha('receipt-group-canonical-comparison-v1:' + row.id) })) comparisonFail('invalid_comparison_source');
    comparisonFields(row.query, ['text', 'date'], 'invalid_comparison_source');
    if (!text(row.query.text, 300) || queries.has(comparisonSha(row.query.text))) comparisonFail('invalid_comparison_source');
    queries.add(comparisonSha(row.query.text)); const cutoff = comparisonDate(row.query.date).order;
    comparisonFields(row.history, ['sessions'], 'invalid_comparison_source'); comparisonFields(row.scriptedExtraction, ['cards'], 'invalid_comparison_source');
    if (row.history.sessions.length !== count || row.scriptedExtraction.cards.length !== count) comparisonFail('invalid_comparison_source');
    const local = new Map(); let pairs = 0;
    for (const session of row.history.sessions) {
      comparisonFields(session, ['sourceSessionLabel', 'date', 'turns'], 'invalid_comparison_source');
      if (!text(session.sourceSessionLabel, 200) || labels.has(session.sourceSessionLabel) || comparisonDate(session.date).order >= cutoff
        || !Array.isArray(session.turns) || session.turns.length < 1 || session.turns.length > 2) comparisonFail('invalid_comparison_source');
      labels.add(session.sourceSessionLabel); pairs += Number(session.turns.length === 2);
      for (const turn of session.turns) {
        comparisonFields(turn, ['sourceLabel', 'role', 'content'], 'invalid_comparison_source');
        if (!text(turn.sourceLabel, 200) || labels.has(turn.sourceLabel) || !['user', 'assistant'].includes(turn.role) || !text(turn.content, 240)
          || comparisonWrap(session, turn).length > 800) comparisonFail('invalid_comparison_source');
        labels.add(turn.sourceLabel); local.set(turn.sourceLabel, { session, turn }); hashes[turn.sourceLabel] = comparisonSha(turn.content); turns++;
      }
    }
    if (pairs !== 1) comparisonFail('invalid_comparison_source');
    const used = new Set();
    for (const card of row.scriptedExtraction.cards) {
      comparisonFields(card, ['cardLabel', 'content', 'kind', 'confidence', 'sourcePartitions'], 'invalid_comparison_source');
      if (!text(card.cardLabel, 200) || labels.has(card.cardLabel) || card.kind !== 'context' || card.confidence !== 1
        || !Array.isArray(card.sourcePartitions) || card.sourcePartitions.length !== 1 || !Array.isArray(card.sourcePartitions[0])
        || ![1, 2].includes(card.sourcePartitions[0].length)) comparisonFail('invalid_comparison_source');
      labels.add(card.cardLabel); const partition = card.sourcePartitions[0];
      if (partition.some(label => !local.has(label) || used.has(label))) comparisonFail('invalid_comparison_source');
      const session = local.get(partition[0]).session;
      if (partition.some(label => local.get(label).session !== session) || partition.length !== session.turns.length
        || card.content !== partition.map(label => local.get(label).turn.content).join('\n') || normalize(card.content).length > 600) comparisonFail('invalid_comparison_source');
      partition.forEach(label => used.add(label)); cards++;
    }
    if (used.size !== local.size) comparisonFail('invalid_comparison_source');
  }
  if (cards !== 216 || turns !== 240) comparisonFail('invalid_comparison_source');
  return freeze({ value, sha256: comparisonSha(raw), sourceLiteralHashes: hashes, cardCount: cards, receiptCount: turns,
    variantContract: variants });
}
const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid });
function ancestors(path) {
  let current = parse(path).root;
  for (const part of relative(current, path).split('/').filter(Boolean)) { current = join(current, part); const stat = lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) comparisonFail('comparison_output_unsafe'); }
  if (realpathSync(path) !== path) comparisonFail('comparison_output_unsafe');
}
function checked(path, expected, directory = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)
    || expected && !isDeepStrictEqual(identity(stat), expected)) comparisonFail('comparison_output_unsafe');
  return identity(stat);
}
export function comparisonArtifact(owner, name, text, maximum = 16 * 1024 * 1024) {
  if (!artifactOwners.has(owner)) comparisonFail('invalid_comparison_preparation');
  ancestors(owner.outputRoot); checked(owner.outputRoot, owner.rootIdentity, true);
  if (!/^[\w.-]+$/u.test(name) || typeof text !== 'string' || Buffer.byteLength(text) > maximum) comparisonFail('comparison_artifact_limit');
  const path = join(owner.outputRoot, name), fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(owner.outputRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return freeze({ path, bytes: Buffer.byteLength(text), sha256: comparisonSha(text), identity: checked(path) });
}
export const comparisonJsonArtifact = (owner, name, value) => comparisonArtifact(owner, name, JSON.stringify(value) + '\n');
export function verifyComparisonArtifact(binding) {
  checked(binding.path, binding.identity); const bytes = readFileSync(binding.path);
  if (bytes.length !== binding.bytes || comparisonSha(bytes) !== binding.sha256) comparisonFail('comparison_artifact_drift');
}
function snapshot(path, fileIdentity, DatabaseSync) {
  checked(path, fileIdentity); const db = new DatabaseSync(path, { readOnly: true });
  try { db.exec('BEGIN'); const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const tables = Object.fromEntries(schema.filter(r => r.type === 'table').map(r => [r.name,
      db.prepare('SELECT * FROM "' + r.name.replaceAll('"', '""') + '"').all().map(row => Object.fromEntries(Object.entries(row))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
    db.exec('COMMIT'); return comparisonSha(JSON.stringify({ schema, tables, applicationId: db.prepare('PRAGMA application_id').get(), userVersion: db.prepare('PRAGMA user_version').get() }));
  } finally { db.close(); }
}
function dependencies() {
  const require = createRequire(new URL('../../adapters/openai/package.json', import.meta.url));
  const root = dirname(realpathSync(require.resolve('tiktoken')));
  if (JSON.parse(readFileSync(join(root, 'package.json'))).version !== '1.0.22') comparisonFail('comparison_dependency_drift');
  const pending = [import.meta.url, new URL('./receipt-group-canonical-comparison-runner.mjs', import.meta.url).href,
    ...['../../core/contract.mjs', '../../adapters/openai/index.mjs', '../architecture/receipt-group-canonical-plan.mjs',
      '../architecture/card-plan-projection.mjs', '../architecture/source-bundle-plan-rank-transport.mjs', './transport.mjs',
      './source-bundle-runner.mjs', '../longmemeval/mixed-source.mjs', '../experiment-budget/index.mjs'].map(path => new URL(path, import.meta.url).href)];
  const source = new Map(); let bytes = 0;
  while (pending.length) {
    const url = pending.pop(); if (source.has(url)) continue;
    const body = readFileSync(new URL(url)); bytes += body.length;
    if (source.size > 256 || bytes > 8 * 1024 * 1024 || body.length > 1024 * 1024) comparisonFail('comparison_dependency_drift');
    source.set(url, comparisonSha(body));
    for (const match of body.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"\s]+\.mjs)\1/gu)) pending.push(new URL(match[2], url).href);
  }
  return freeze({ node: process.versions.node, tokenizer: 'tiktoken@1.0.22',
    source: [...source].sort(([a], [b]) => a.localeCompare(b)).map(([url, sha256]) => ({ url, sha256 })),
    tokenizerFiles: ['package.json', 'tiktoken.js', 'tiktoken_bg.js', 'tiktoken_bg.wasm', 'tiktoken.cjs', 'tiktoken_bg.cjs'].map(name => ({ path: join(root, name), sha256: comparisonSha(readFileSync(join(root, name))) })) });
}
export const comparisonUnit = card => ({ text: JSON.stringify({ format: 'card-plan-flat-source-evidence-v1', memoryId: card.memory.id,
  revision: card.memory.revision, sources: card.receipts.map(r => ({ receiptId: r.id, recordedRole: r.role, text: r.excerpt })) }) });
export function certifyComparisonAnswerFit(question, cards, packer, counter) {
  const empty = packer({ question, units: [], countTokens: counter }), base = Buffer.byteLength(JSON.stringify(empty.request));
  const weights = cards.map(card => Buffer.byteLength(JSON.stringify(packer({ question, units: [comparisonUnit(card)], countTokens: counter }).request)) - base);
  const n = Math.min(6, cards.length), upperUtf8Bytes = base + [...weights].sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0) + Math.max(0, n - 1);
  for (const text of ['Q\\"\n\\', '中文😀𝄞', JSON.stringify(empty.request), ...cards.map(card => comparisonUnit(card).text)]) {
    if (counter(text) > Buffer.byteLength(text)) comparisonFail('comparison_tokenizer_property_failed');
  }
  if (upperUtf8Bytes > 6000) comparisonFail('comparison_answer_fit_unproven');
  return freeze({ method: 'exact-escaped-member-byte-upper-bound-v1', baseUtf8Bytes: base, memberUtf8Bytes: weights,
    selectedCardCap: n, upperUtf8Bytes, tokenizer: 'tiktoken@1.0.22/o200k_base/byte-level-no-special-tokens', tokensAtMostUtf8Bytes: true });
}
async function ordinaryWires(request, createOpenAIModel) {
  let count, generation;
  const model = createOpenAIModel({ apiKey: 'synthetic_serializer_only', fetchImpl(url, init) {
    if (url.endsWith('/input_tokens')) { count = init.body; return Response.json({ object: 'response.input_tokens', input_tokens: 0 }); }
    generation = init.body; throw Error('synthetic serializer terminal');
  } });
  try { await model.rank({ ...request, signal: new AbortController().signal }); } catch { /* Deliberate serializer terminal, no external dispatch. */ }
  if (!count || !generation) comparisonFail('comparison_wire_mismatch'); return { count, generation };
}
export async function prepareCanonicalReceiptGroupComparison(options) {
  const { outputRoot } = comparisonFields(options, ['outputRoot'], 'invalid_comparison_preparation');
  if (typeof outputRoot !== 'string' || !isAbsolute(outputRoot) || resolve(outputRoot) !== outputRoot || outputRoot === parse(outputRoot).root) comparisonFail('invalid_comparison_preparation');
  let owner, core, ordinal = 0; const cases = [];
  try {
    ancestors(dirname(outputRoot)); try { mkdirSync(outputRoot, { mode: 0o700 }); } catch { comparisonFail('comparison_output_not_fresh'); }
    owner = { outputRoot, rootIdentity: checked(outputRoot, null, true) };
    artifactOwners.add(owner);
    const raw = readFileSync(fixtureUrl, 'utf8'), source = validateCanonicalComparisonSource(raw);
    if (source.sha256 !== canonicalComparisonSourceSha256) comparisonFail('comparison_source_drift');
    const roster = comparisonJsonArtifact(owner, 'planned-roster.json', { version: comparisonVersion, sourceFileSha256: source.sha256,
      cardCount: 216, receiptCount: 240, sourceLiteralHashes: source.sourceLiteralHashes, cases: comparisonIds.map(id => ({ id, status: 'planned', selections: ['A', 'B'], answers: ['A', 'B'] })) });
    const sourceArtifact = comparisonArtifact(owner, 'frozen-source-fixture.json', raw);
    const { DatabaseSync } = await import('node:sqlite'), { openMemoryCore } = await import('../../core/contract.mjs');
    const { countOpenAITokens: counter, createOpenAIModel } = await import('../../adapters/openai/index.mjs');
    const { prepareMixedSourceCase } = await import('../longmemeval/mixed-source.mjs');
    const { prepareCanonicalReceiptGroupPlan } = await import('../architecture/receipt-group-canonical-plan.mjs');
    const { prepareCardPlanRankRequest } = await import('../architecture/card-plan-rank.mjs');
    const { prepareReceiptGroupPlan } = await import('../architecture/receipt-group-plan.mjs');
    const { packMixedAnswer } = await import('../longmemeval/mixed-answer.mjs');
    const allReceipts = new Set(), allMemories = new Set();
    for (const row of source.value.cases) {
      ordinal++; const path = join(outputRoot, `${row.id}.sqlite`), fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); closeSync(fd);
      const fileIdentity = checked(path);
      const plan = prepareMixedSourceCase({ namespace: row.namespace, history: { question_id: row.namespace.projectId,
        sessions: row.history.sessions.map((session, index) => ({ session_index: index, session_id: 'lme-session-' + comparisonSha(randomUUID()), date: session.date,
          turns: session.turns.map(turn => ({ turn_id: 'lme-turn-' + comparisonSha(randomUUID()), role: turn.role, content: turn.content })) })) },
        question: { question_id: row.namespace.projectId, text: row.query.text, date: row.query.date } });
      if (!plan.cairnPlan.executable || plan.cairnPlan.batches.length !== row.history.sessions.length) comparisonFail('comparison_capture_mismatch');
      let sessionOrdinal = 0; const captures = [], labels = Object.create(null);
      const base = { contextWindow: 8192, countTokens: counter, extract({ input }) {
        const session = row.history.sessions[sessionOrdinal++];
        if (!session || input.messages.length !== session.turns.length) comparisonFail('comparison_capture_mismatch');
        const indices = new Map();
        for (const turn of session.turns) { const matches = input.messages.filter(m => m.role === turn.role && m.content === comparisonWrap(session, turn));
          if (matches.length !== 1) comparisonFail('comparison_capture_mismatch'); indices.set(turn.sourceLabel, matches[0].index); }
        const card = row.scriptedExtraction.cards.find(c => c.sourcePartitions[0].every(label => indices.has(label)));
        if (!card) comparisonFail('comparison_capture_mismatch');
        return { items: [{ content: card.content, kind: 'context', confidence: 1, sourceIndices: card.sourcePartitions[0].map(label => indices.get(label)) }] };
      }, classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
      core = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' });
      for (const [index, session] of row.history.sessions.entries()) {
        const captureInput = plan.cairnPlan.batches[index].captureInput, result = comparisonUnwrap(await core.capture(captureInput));
        if (result.duplicate || result.admission.memories.length !== 1) comparisonFail('comparison_capture_mismatch');
        const detail = comparisonUnwrap(core.get({ namespace: row.namespace, memoryId: result.admission.memories[0].id, receiptLimit: 100 }));
        if (!detail.exhausted || detail.nextReceiptCursor !== null || detail.receipts.length !== session.turns.length || allMemories.has(detail.memory.id)) comparisonFail('comparison_capture_mismatch');
        allMemories.add(detail.memory.id);
        for (const turn of session.turns) {
          const matching = detail.receipts.filter(r => r.role === turn.role && r.excerpt === comparisonWrap(session, turn));
          if (matching.length !== 1 || allReceipts.has(matching[0].id) || matching[0].sessionId !== captureInput.sessionId
            || !captureInput.messages.some(m => m.id === matching[0].eventId)) comparisonFail('comparison_capture_mismatch');
          allReceipts.add(matching[0].id); labels[turn.sourceLabel] = { receiptId: matching[0].id, memoryId: detail.memory.id, role: turn.role, excerpt: matching[0].excerpt, sourceSha256: source.sourceLiteralHashes[turn.sourceLabel] };
        }
        captures.push({ captureInput, result, memory: detail.memory, receipts: detail.receipts });
      }
      core.close(); core = null; const before = snapshot(path, fileIdentity, DatabaseSync);
      const rankRequests = [], recalls = []; let map;
      for (const arm of ['A', 'B']) {
        core = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1', model: { ...base,
          select() { comparisonFail('comparison_select_forbidden'); }, rank(request) {
            rankRequests.push(comparisonData({ system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens })); return { refs: [] };
          } } });
        map = comparisonUnwrap(core.map({ namespace: row.namespace, purpose: 'recall', tokenBudget: 4000 }));
        const recalled = comparisonUnwrap(await core.recall({ readSet: [row.namespace], query: plan.mem0Input.query, limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
        if (!map.exhausted || map.nextCursor !== null || map.items.length !== captures.length || recalled.coverage !== 'complete'
          || recalled.recallTruncated || recalled.selection.strategy !== 'complete-map') comparisonFail('comparison_cold_mismatch');
        recalls.push(recalled); core.close(); core = null;
      }
      if (rankRequests.length !== 2 || !isDeepStrictEqual(rankRequests[0], rankRequests[1]) || before !== snapshot(path, fileIdentity, DatabaseSync)) comparisonFail('comparison_cold_mismatch');
      const rankRequest = rankRequests[0], cards = rankRequest.input.candidates;
      if (cards.length !== captures.length) comparisonFail('comparison_cold_mismatch');
      for (const card of cards) { const capture = captures.find(c => c.memory.id === card.memory.id);
        if (!capture || card.namespaceIndex !== 0 || !isDeepStrictEqual(card.memory, { id: capture.memory.id, revision: capture.memory.revision, currentness: 'current' })
          || card.receiptCount !== capture.receipts.length || card.interpretationStatus !== 'omitted' || card.sourceSelectionCoverage !== 'unassessed'
          || !isDeepStrictEqual(card.receipts, capture.receipts.map(r => ({ id: r.id, role: r.role, excerpt: r.excerpt })))) comparisonFail('comparison_cold_mismatch'); }
      const nativeRequest = { ...rankRequest, signal: new AbortController().signal };
      const canonical = prepareCanonicalReceiptGroupPlan(nativeRequest, counter), cp = prepareCardPlanRankRequest(nativeRequest, counter), rg = prepareReceiptGroupPlan(nativeRequest, counter);
      const ordinary = await ordinaryWires(rankRequest, createOpenAIModel);
      const body = { model: 'gpt-4.1-mini-2025-04-14', instructions: canonical.request.system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(canonical.request.input) }] }],
        text: { format: { type: 'json_schema', name: 'cairn_receipt_group_canonical_plan_rank_v1', strict: true, schema: canonical.request.outputSchema } }, truncation: 'disabled' };
      const wires = { A: ordinary, B: { count: JSON.stringify(body), generation: JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false }) } };
      const ai = JSON.parse(JSON.parse(wires.A.count).input[0].content[0].text), bi = JSON.parse(JSON.parse(wires.B.count).input[0].content[0].text);
      if (!isDeepStrictEqual(ai, { query: bi.query, limit: bi.limit, candidates: bi.cards })) comparisonFail('comparison_wire_mismatch');
      const texts = { ordinaryCount: wires.A.count, ordinaryGeneration: wires.A.generation, canonicalCount: wires.B.count, canonicalGeneration: wires.B.generation,
        canonicalRequest: JSON.stringify(canonical.request), derivedReceiptGroupRequest: JSON.stringify(rg.request), derivedCardPlanRequest: JSON.stringify(cp.request) };
      const tokenWitnesses = Object.fromEntries(Object.entries(texts).map(([name, text]) => { const tokens = counter(text);
        if (tokens > 6000) comparisonFail('context_budget_exceeded'); return [name, { text, sha256: comparisonSha(text), tokens }]; }));
      const observation = freeze({ id: row.id, ordinal, path, fileIdentity, namespace: row.namespace, sourcePlan: plan,
        question: { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate }, query: plan.mem0Input.query,
        captures, labels, rankRequest, canonicalRequest: canonical.request, canonicalRequestSha256: canonical.requestSha256, map, recalls,
        storeSha256: before, wires, tokenWitnesses, answerFit: certifyComparisonAnswerFit({ text: plan.originalQuestion.text, date: plan.canonicalQuestionDate }, cards, packMixedAnswer, counter) });
      const artifact = comparisonJsonArtifact(owner, `${row.id}-preparation.json`, observation); cases.push(freeze({ ...observation, artifact }));
    }
    if (allMemories.size !== 216 || allReceipts.size !== 240) comparisonFail('comparison_capture_mismatch');
    const observation = freeze({ version: comparisonVersion, ...owner, sourceFileSha256: source.sha256, sourceLiteralHashes: source.sourceLiteralHashes,
      roster, sourceArtifact, dependencies: dependencies(), cases, cardCount: 216, receiptCount: 240, extraction: 'scripted-normal-indexed-capture-v1', semanticSufficiency: 'unassessed' });
    artifactOwners.add(observation);
    const preparationArtifact = comparisonJsonArtifact(owner, 'preparation.json', observation), capability = Object.freeze({ observation });
    const context = Object.freeze({ observation, preparationArtifact, DatabaseSync, openMemoryCore, counter });
    preparationContexts.add(context);
    preparations.set(capability, { context, consumed: false }); return capability;
  } catch (error) {
    try { core?.close(); } catch { /* preserve first boundary */ }
    if (owner) try { comparisonJsonArtifact(owner, 'preparation-failed.json', { failure: { code: comparisonErrorCode(error) }, cases: comparisonIds.map((id, index) => ({ id, status: index < cases.length ? 'prepared' : index === ordinal - 1 ? 'failed' : 'not-prepared' })) }); } catch { /* preserve first boundary */ }
    throw error;
  }
}
export function createCanonicalReceiptGroupComparisonManifest(observation) {
  const clean = comparisonData(observation, 'invalid_comparison_manifest');
  if (clean.version !== comparisonVersion || clean.cardCount !== 216 || clean.receiptCount !== 240 || !isDeepStrictEqual(clean.cases.map(c => c.id), comparisonIds)) comparisonFail('invalid_comparison_manifest');
  return freeze({ version: comparisonVersion, sourceFileSha256: clean.sourceFileSha256, preparationSha256: comparisonSha(JSON.stringify(clean)),
    dependencies: clean.dependencies, limits: comparisonLimits, cases: clean.cases.map(c => ({ id: c.id, artifact: c.artifact, storeSha256: c.storeSha256,
      canonicalRequestSha256: c.canonicalRequestSha256, answerFit: c.answerFit })) });
}
// Module-private registry; these purpose-specific coordinator seams grant no
// authority from a serialized manifest or preparation observation.
export function consumeCanonicalComparisonPreparation(options) {
  if (!options || typeof options !== 'object' || types.isProxy(options)) comparisonFail('invalid_comparison_preparation');
  const d = Object.getOwnPropertyDescriptor(options, 'preparation'), entry = d && Object.hasOwn(d, 'value') ? preparations.get(d.value) : null;
  if (!entry || entry.consumed) comparisonFail('invalid_comparison_preparation'); entry.consumed = true; return entry.context;
}
export function verifyCanonicalComparisonPreparation(owner, current) {
  if (!preparationContexts.has(owner)) comparisonFail('invalid_comparison_preparation');
  const obs = owner.observation;
  ancestors(obs.outputRoot); checked(obs.outputRoot, obs.rootIdentity, true);
  if (comparisonSha(readFileSync(fixtureUrl)) !== obs.sourceFileSha256 || !isDeepStrictEqual(dependencies(), obs.dependencies)) comparisonFail('comparison_dependency_drift');
  for (const artifact of [obs.roster, obs.sourceArtifact, owner.preparationArtifact, ...obs.cases.map(c => c.artifact)]) verifyComparisonArtifact(artifact);
  const rows = current ? [current] : obs.cases;
  for (const row of rows) if (snapshot(row.path, row.fileIdentity, owner.DatabaseSync) !== row.storeSha256) comparisonFail('comparison_store_drift');
}

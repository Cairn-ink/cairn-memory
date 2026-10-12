import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/contract.mjs';
import { countOpenAITokens, createOpenAIModel } from '../../adapters/openai/index.mjs';
import { loadCardPlanQaCases, prepareCardPlanQaCase } from './card-plan-profile.mjs';
import { prepareCardPlanRankRequest } from '../architecture/card-plan-rank.mjs';
import { compileOrdinaryCardSelection } from '../architecture/card-plan-projection.mjs';

import { freeze } from '../longmemeval/mixed-validation.mjs';

const preparations = new WeakMap(), cases = new WeakMap();
const sha = text => createHash('sha256').update(text).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid });
function fields(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_card_plan_preparation');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('invalid_card_plan_preparation');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function ancestors(path) {
  let current = parse(path).root;
  for (const part of relative(current, path).split('/').filter(Boolean)) {
    current = join(current, part); const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('card_plan_output_unsafe');
  }
  if (realpathSync(path) !== path) fail('card_plan_output_unsafe');
}
function ownedRoot(root, expected) {
  ancestors(root); const stat = lstatSync(root);
  if ((stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid()
    || expected && !isDeepStrictEqual(identity(stat), expected)) fail('card_plan_output_unsafe');
  return identity(stat);
}
function ownedFile(path, expected) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600
    || expected && !isDeepStrictEqual(identity(stat), expected)) fail('card_plan_output_unsafe');
  return identity(stat);
}
function write(root, rootIdentity, name, value) {
  ownedRoot(root, rootIdentity);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) fail('card_plan_artifact_limit');
  const fd = openSync(join(root, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, encoded); fsyncSync(fd); } finally { closeSync(fd); }
  ownedRoot(root, rootIdentity);
  const directory = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return { path: join(root, name), bytes: Buffer.byteLength(encoded), sha256: sha(encoded) };
}
function snapshot(path, expected) {
  ownedFile(path, expected);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const tables = Object.fromEntries(schema.filter(row => row.type === 'table').map(row => {
      const quoted = '"' + row.name.replaceAll('"', '""') + '"';
      const rows = db.prepare(`SELECT * FROM ${quoted}`).all().map(value => Object.fromEntries(Object.entries(value)))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return [row.name, rows];
    }));
    const logical = { applicationId: db.prepare('PRAGMA application_id').get().application_id,
      userVersion: db.prepare('PRAGMA user_version').get().user_version, schema, tables };
    db.exec('COMMIT'); ownedFile(path, expected);
    return freeze({ sha256: sha(JSON.stringify(logical)), bytes: lstatSync(path).size, logical });
  } finally { db.close(); }
}
const unwrap = result => { if (!result.ok) fail(result.error.code); return result.value; };
const witness = text => {
  const inputTokens = countOpenAITokens(text);
  if (inputTokens > 6000 || inputTokens <= 0) fail('context_budget_exceeded');
  return { text, sha256: sha(text), inputTokens };
};
function cardWires(prepared) {
  const body = { model: 'gpt-4.1-mini-2025-04-14', instructions: prepared.request.system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(prepared.request.input) }] }],
    text: { format: { type: 'json_schema', name: 'cairn_card_budgeted_plan_rank_v1', strict: true,
      schema: prepared.request.outputSchema } }, truncation: 'disabled' };
  return [JSON.stringify(body), JSON.stringify({ ...body, max_output_tokens: 1024, store: false, stream: false })];
}

export async function prepareCardPlanComparison(options) {
  const { outputRoot: requested } = fields(options, ['outputRoot']);
  if (typeof requested !== 'string' || !isAbsolute(requested) || resolve(requested) !== requested
    || requested === parse(requested).root) fail('invalid_card_plan_preparation');
  let rootIdentity, active, currentCase = null;
  const observations = [], caseArtifacts = [];
  try {
    ancestors(dirname(requested));
    try { mkdirSync(requested, { mode: 0o700 }); } catch { fail('card_plan_output_not_fresh'); }
    rootIdentity = ownedRoot(requested);
    const source = await loadCardPlanQaCases(), sourceValueSha256 = sha(JSON.stringify(source));
    const sourceFileSha256 = sha(readFileSync(new URL('./card-plan-cases.json', import.meta.url)));
    const seenMemories = new Set(), seenReceipts = new Set();
    for (const c of source) {
      currentCase = c.id;
      const preparedCase = await prepareCardPlanQaCase(source, c.id), plan = preparedCase.plan;
      const namespace = plan.cairnPlan.batches[0].captureInput.namespace, path = join(requested, `${c.id}.sqlite`);
      ownedRoot(requested, rootIdentity);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      closeSync(fd); const fileIdentity = ownedFile(path); let captureOrdinal = 0;
      const model = { contextWindow: 8192, countTokens: countOpenAITokens,
        extract({ input }) {
          if (input.messages.length !== 1) fail('card_plan_capture_mismatch');
          const expected = plan.cairnPlan.batches[captureOrdinal++].indexedWindows[0];
          if (input.messages[0].content !== expected.content || input.messages[0].role !== expected.role)
            fail('card_plan_capture_mismatch');
          return { items: [{ content: expected.content, kind: 'context',
            confidence: 1, sourceIndices: [input.messages[0].index] }] };
        },
        classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
      };
      active = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1' });
      const captures = [];
      for (const batch of plan.cairnPlan.batches) {
        const result = await active.capture(batch.captureInput), value = unwrap(result);
        if (value.admission.memories.length !== 1 || value.admission.suppressedCount !== 0
          || value.duplicate !== false || value.classification.status !== 'applied') fail('card_plan_capture_mismatch');
        const memory = value.admission.memories[0], detail = unwrap(active.get({ namespace, memoryId: memory.id, receiptLimit: 100 }));
        const expected = batch.indexedWindows[0], receipt = detail.receipts[0];
        if (detail.receipts.length !== 1) fail('card_plan_capture_receipt_count');
        if (receipt.role !== expected.role) fail('card_plan_capture_role');
        if (receipt.excerpt !== expected.content) fail('card_plan_capture_window');
        if (receipt.sessionId !== batch.captureInput.sessionId) fail('card_plan_capture_session');
        if (receipt.eventId !== batch.captureInput.messages[0].id) fail('card_plan_capture_event');
        if (seenMemories.has(memory.id) || seenReceipts.has(receipt.id)) fail('card_plan_capture_identity');
        seenMemories.add(memory.id); seenReceipts.add(receipt.id);
        captures.push({ result, memory: detail.memory, receipts: detail.receipts, batch });
      }
      active.close(); active = null;
      const stateBefore = snapshot(path, fileIdentity);
      let rankRequest, rankCalls = 0, selectCalls = 0, recalling = false, actualRecallMap;
      active = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1', model: { ...model,
        countTokens(text) {
          if (recalling) {
            try { const parsed = JSON.parse(text);
              if (parsed.ok === true && parsed.value?.items?.length === 12
                && parsed.value.items.every(item => item.type === 'unfiled')) actualRecallMap = parsed;
            } catch { /* The actual tokenizer also counts non-JSON source strings. */ }
          }
          return countOpenAITokens(text);
        },
        select() { selectCalls++; fail('card_plan_select_forbidden'); },
        rank(request) { rankCalls++; rankRequest = { system: request.system, input: request.input,
          maxOutputTokens: request.maxOutputTokens }; return { refs: [] }; } } });
      const map = active.map({ namespace, purpose: 'recall', tokenBudget: 4000 }); unwrap(map);
      recalling = true;
      const recall = await active.recall({ readSet: [namespace], query: plan.mem0Input.query, limit: 6,
        contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }); unwrap(recall);
      active.close(); active = null;
      const stateAfter = snapshot(path, fileIdentity), candidates = rankRequest?.input.candidates;
      if (rankCalls !== 1 || selectCalls !== 0) fail('card_plan_cold_call_count');
      if (candidates?.length !== 12 || map.value.items.length !== 12) fail('card_plan_cold_candidate_count');
      if (!map.value.exhausted || map.value.nextCursor !== null) fail('card_plan_cold_map_incomplete');
      if (recall.value.coverage !== 'complete' || recall.value.selection.strategy !== 'complete-map'
        || recall.value.recallTruncated) fail('card_plan_cold_recall_incomplete');
      if (!isDeepStrictEqual(stateBefore, stateAfter)) fail('card_plan_cold_state_drift');
      const captureById = new Map(captures.map(row => [row.memory.id, row]));
      const mapOrder = map.value.items.map(item => item.ref.memoryId);
      const expectedOrder = actualRecallMap?.value.items.map(item => item.ref.memoryId);
      if (!isDeepStrictEqual([...mapOrder].sort(), [...captureById.keys()].sort())
        || actualRecallMap?.value.exhausted !== true || actualRecallMap.value.nextCursor !== null
        || !isDeepStrictEqual([...expectedOrder].sort(), [...captureById.keys()].sort())
        || !isDeepStrictEqual(candidates.map(card => card.memory.id), expectedOrder)) fail('card_plan_cold_mismatch');
      for (const card of candidates) {
        const actual = captureById.get(card.memory.id);
        if (!actual || card.memory.revision !== actual.memory.revision || card.receiptCount !== 1
          || card.receipts.length !== 1 || card.receipts[0].id !== actual.receipts[0].id
          || card.receipts[0].role !== actual.receipts[0].role || card.receipts[0].excerpt !== actual.receipts[0].excerpt)
          fail('card_plan_cold_mismatch');
      }
      const signal = new AbortController().signal, request = { ...rankRequest, signal }, bodies = [];
      const serializer = createOpenAIModel({ apiKey: 'serializer-only', fetchImpl: async (url, init) => {
        bodies.push(init.body);
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: countOpenAITokens(init.body) });
        return Response.json({ object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed',
          error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: '{"refs":[]}' }] }],
          usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101 } });
      } });
      const serializedResult = await serializer.rank(request);
      if (!isDeepStrictEqual(serializedResult, { refs: [] }) || bodies.length !== 2) fail('card_plan_wire_mismatch');
      const cardPrepared = prepareCardPlanRankRequest(request, countOpenAITokens);
      const ordinaryAssembly = compileOrdinaryCardSelection(request, { refs: [] }, countOpenAITokens);
      if (ordinaryAssembly.syntheticAssemblyRequestSha256 !== cardPrepared.requestSha256)
        fail('card_plan_wire_mismatch');
      const [cardCount, cardGeneration] = cardWires(cardPrepared);
      const tokenWitnesses = { ordinaryPrepared: witness(JSON.stringify(rankRequest)), ordinaryCount: witness(bodies[0]),
        ordinaryGeneration: witness(bodies[1]), cardPrepared: witness(JSON.stringify(cardPrepared.request)),
        cardCount: witness(cardCount), cardGeneration: witness(cardGeneration),
        ordinaryAssemblyPrepared: witness(JSON.stringify(ordinaryAssembly.compiled.request)) };
      const observation = freeze({ id: c.id, path, fileIdentity, plan, namespace, question: preparedCase.question,
        sourceProvenance: preparedCase.sourceProvenance, captures, map, actualRecallMap, recallMapOrder: expectedOrder,
        rankRequest, recall, rankCalls, selectCalls,
        candidateReceiptOrder: candidates.map(card => card.receipts[0].id), stateBefore, stateAfter,
        preparedCardRequestSha256: cardPrepared.requestSha256, tokenWitnesses });
      cases.set(observation, { root: requested, rootIdentity, fileIdentity, expected: stateAfter });
      caseArtifacts.push(write(requested, rootIdentity, `${c.id}-preparation.json`, observation));
      observations.push(observation);
    }
    if (seenMemories.size !== 288 || seenReceipts.size !== 288) fail('card_plan_capture_mismatch');
    const observation = freeze({ version: 'card-plan-comparison-preparation-v1', outputRoot: requested, rootIdentity,
      sourceValueSha256, sourceFileSha256, cases: observations, cardCount: 288, receiptCount: 288,
      extraction: 'scripted-exact-window-v1', classification: 'scripted-unfiled-v1', semanticSufficiency: 'unassessed' });
    // Full schema/source/capture snapshots are already retained in each exclusive
    // case artifact. Keep the roster metadata bounded instead of duplicating all.
    write(requested, rootIdentity, 'preparation.json', { ...observation,
      cases: observations.map((c, index) => ({ id: c.id, path: c.path, stateSha256: c.stateAfter.sha256,
        artifact: caseArtifacts[index] })) });
    const capability = Object.freeze({ observation }); preparations.set(capability, { observation, consumed: false });
    return capability;
  } catch (error) {
    if (active) { try { active.close(); } catch { /* Preserve first preparation error. */ } }
    if (rootIdentity) {
      try { const descriptor = !types.isProxy(error) && Object.getOwnPropertyDescriptor(error, 'code');
        write(requested, rootIdentity, 'preparation-failed.json', { version: 'card-plan-comparison-preparation-v1',
          status: 'failed', completedCases: observations.length, currentCase,
          failure: descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
            ? descriptor.value.slice(0, 128) : 'card_plan_preparation_failed' }); }
      catch { /* Failed filesystem cannot promise a durable failure record. */ }
    }
    throw error;
  }
}

export async function assertCardPlanStoreUnchanged(caseObservation) {
  const owner = cases.get(caseObservation);
  if (!owner) fail('invalid_card_plan_preparation');
  ownedRoot(owner.root, owner.rootIdentity);
  const actual = snapshot(caseObservation.path, owner.fileIdentity);
  if (!isDeepStrictEqual(actual, owner.expected)) fail('card_plan_store_drift');
  return freeze({ sha256: actual.sha256, bytes: actual.bytes, tables: Object.keys(actual.logical.tables).length });
}

export async function consumeCardPlanPreparation(capability) {
  const owner = preparations.get(capability);
  if (!owner) fail('invalid_card_plan_preparation');
  if (owner.consumed) fail('card_plan_preparation_consumed');
  owner.consumed = true;
  const source = await loadCardPlanQaCases();
  if (sha(JSON.stringify(source)) !== owner.observation.sourceValueSha256
    || sha(readFileSync(new URL('./card-plan-cases.json', import.meta.url))) !== owner.observation.sourceFileSha256)
    fail('card_plan_hash_drift');
  for (const c of owner.observation.cases) await assertCardPlanStoreUnchanged(c);
  return owner.observation;
}

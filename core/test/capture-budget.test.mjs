import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { qualifyExtractedItems } from '../automatic-qualification.mjs';
import { qualifyCandidateItems } from '../qualification-candidates.mjs';
import { createCjkTokenCounter } from '../testing/cjk-token-counter.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Synthetic data and scripted ports only. The counter is shaped like a real
// tokenizer (CJK about one token per character), not a provider tokenizer.
const namespace = { ownerId: 'cr1-capture', scope: 'personal', projectId: null };
const episodeNamespace = { ownerId: 'cr1-capture', scope: 'project', projectId: 'project' };
const LIMIT = 6000;
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400)); return r.value; };
const passage = '我們今天把部署流程重新整理了一遍，決定先在測試環境驗證資料庫遷移，再請團隊成員檢查設定檔與監控告警。'
  + '下週會議要確認回滾計畫、負責人和時間表，並記錄每一個風險與替代方案。前端頁面的載入速度也要一起量測，避免上線後才發現問題。';
// Already NFKC-normalized, as capture stores it.
const zh = (length, seed = 0) => Array.from({ length }, (_, i) => passage[(seed * 7 + i) % passage.length]).join('')
  .normalize('NFKC');
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];

// v1: anchor the first two units of each item's first shown source.
const qualify = ({ input }) => ({ qualifications: input.items.map(({ itemIndex, sources }) => ({ itemIndex,
  qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null }, value: null,
    attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0, end: 2,
      text: sources[0].excerpt.slice(0, 2), fields: ['attribution'] }] } })) });
// v2: cite each item's first shown candidate.
const qualifyCandidates = ({ input }) => ({ qualifications: input.items.map((entry) => ({ itemIndex: entry.itemIndex,
  ...Object.fromEntries(fields.map((field) => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'subject' ? [entry.candidates[0].candidateIndex] : [] }])) })) });

function fixture(t, { counter = createCjkTokenCounter(), options = {}, ...ports } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'cr1-capture-' });
  const path = join(ws.path, 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: counter, extract: () => ({ items: [] }), ...ports };
  for (const method of ['extract', 'qualify', 'qualifyCandidates', 'interpretEpisode']) {
    const port = model[method];
    if (typeof port === 'function') model[method] = async (request) => {
      calls.push({ method, input: structuredClone(request.input),
        tokens: counter(JSON.stringify({ system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens })) });
      return port(request);
    };
  }
  const core = openMemoryCore({ path, model, ...options });
  ws.defer(() => core.close());
  const db = new DatabaseSync(path);
  ws.defer(() => db.close());
  return { core, db, calls };
}
const capture = (core, messages, eventId = 'batch', patch = {}) => core.capture({ namespace, client: 'wiki',
  sessionId: 'session', eventId, messages, ...patch });
const messagesOf = (lengths) => lengths.map((length, i) => ({ id: `message-${i}`, role: i % 2 ? 'assistant' : 'user',
  content: zh(length, i) }));
const rows = (db, table) => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;

test('CR1 an unplanned oversized batch is refused before any write, and every planned batch is admitted', async (t) => {
  // The review's reproduction: five valid 3,200-character Chinese messages.
  const f = fixture(t);
  const messages = messagesOf([3200, 3200, 3200, 3200, 3200]);
  assert.deepEqual(await capture(f.core, messages), { ok: false, error: { code: 'context_budget_exceeded', retryable: false } });
  assert.deepEqual([rows(f.db, 'admission_claims'), rows(f.db, 'memories'), f.calls.length], [0, 0, 0]);
  const plan = ok(f.core.planCaptureBatches({ messages }));
  assert.deepEqual(plan, { batches: [[0], [1], [2], [3], [4]], oversizedMessageIndices: [] });
  assert.deepEqual(ok(f.core.planCaptureBatches({ messages })), plan, 'deterministic');
  for (const [index, batch] of plan.batches.entries()) {
    ok(await capture(f.core, batch.map((position) => messages[position]), `planned-${index}`));
  }
  assert.equal(f.calls.length, 5);
  assert.ok(f.calls.every((call) => call.tokens <= LIMIT));
});

test('CR1 planner batches are admitted in every capture mode, and one maximum message fits alone', async (t) => {
  const lengths = [4000, 800, 1200, 2500, 300, 4000, 900, 800, 3100, 200, 1500, 4000];
  for (const options of [{}, { captureQualification: 'source-bound-v1' }, { captureQualification: 'source-bound-v2' },
    { captureSourcePolicy: 'indexed-evidence-v1' }]) {
    const f = fixture(t, { options, qualify, qualifyCandidates });
    const messages = messagesOf(lengths);
    const plan = ok(f.core.planCaptureBatches({ messages }));
    assert.deepEqual(plan.oversizedMessageIndices, [], JSON.stringify(options));
    assert.deepEqual(plan.batches.flat(), messages.map((_, index) => index), 'order kept, nothing split or dropped');
    for (const [index, batch] of plan.batches.entries()) {
      ok(await capture(f.core, batch.map((position) => messages[position]), `mode-${index}`));
    }
    assert.ok(f.calls.every((call) => call.tokens <= LIMIT), JSON.stringify(options));
    // A single maximum-length message is a batch by itself.
    assert.deepEqual(ok(f.core.planCaptureBatches({ messages: messagesOf([4000]) })).batches, [[0]]);
  }
});

test('CR1 session-episode batches are planned and admitted without staging an oversized batch', async (t) => {
  const f = fixture(t, { options: { sessionEpisodes: { mode: 'episode-v1' }, captureEvidence: 'staged-v1',
    captureQualification: 'source-bound-v2' }, interpretEpisode: (request) => interpretation(request), qualifyCandidates });
  const messages = messagesOf(Array(12).fill(800)).map((message) => ({ ...message, occurredAt: null }));
  const episode = (batch, eventId) => ({ namespace: episodeNamespace, client: 'synthetic', sessionId: 'session', eventId,
    episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'ordinary' }, messages: batch });
  assert.deepEqual(await f.core.capture(episode(messages, 'unplanned')),
    { ok: false, error: { code: 'context_budget_exceeded', retryable: false } });
  assert.deepEqual([rows(f.db, 'staged_capture_evidence'), rows(f.db, 'admission_claims'), f.calls.length], [0, 0, 0]);
  const plan = ok(f.core.planCaptureBatches({ messages }));
  assert.ok(plan.batches.length > 1 && !plan.oversizedMessageIndices.length);
  for (const [index, batch] of plan.batches.entries()) {
    ok(await f.core.capture(episode(batch.map((position) => messages[position]), `episode-${index}`)));
  }
  assert.ok(f.calls.every((call) => call.tokens <= LIMIT));
});

test('CR1 the planner lists a message that cannot fit alone instead of splitting it', (t) => {
  const f = fixture(t, { counter: (text) => text.length * 2 });
  const messages = messagesOf([100, 4000, 100]);
  assert.deepEqual(ok(f.core.planCaptureBatches({ messages })), { batches: [[0], [2]], oversizedMessageIndices: [1] });
  for (const invalid of [[], Array.from({ length: 241 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'x' })),
    [{ id: 'm', role: 'user', content: 'x'.repeat(4001) }], [{ id: 'm', role: 'other', content: 'x' }],
    [{ id: 'm', role: 'user', content: 'x' }, { id: 'm', role: 'user', content: 'y' }]]) {
    assert.equal(f.core.planCaptureBatches({ messages: invalid }).error.code, 'invalid_input');
  }
});

// Five maximum items: 600 units of content and four 800-unit receipts each.
const maximumItems = () => Array.from({ length: 5 }, (_, i) => ({ content: zh(600, i + 20), kind: 'fact', confidence: 0.8,
  receipts: Array.from({ length: 4 }, (_, r) => ({ client: 'wiki', sessionId: 'session', eventId: `event-${i}-${r}`,
    role: r % 2 ? 'assistant' : 'user', excerpt: zh(800, i * 4 + r) })) }));
function recordingPort(method, port, counter) {
  const calls = [];
  return { calls, model: { contextWindow: 8192, countTokens: counter, [method]: async (request) => {
    calls.push({ input: structuredClone(request.input),
      tokens: counter(JSON.stringify({ system: request.system, input: request.input, maxOutputTokens: 1024 })) });
    return port(request);
  } } };
}
function anchorsHold(items, qualified) {
  for (const [index, item] of qualified.entries()) {
    for (const anchor of item.qualification.anchors) {
      assert.equal(items[index].receipts[anchor.receiptIndex].excerpt.slice(anchor.start, anchor.end), anchor.text);
    }
  }
}

test('CR1 v1 qualification of five maximum CJK items is planned per item and shortened only when needed', async () => {
  for (const [scale, shortened] of [[1.15, 0], [1.5, 5]]) {
    const { calls, model } = recordingPort('qualify', qualify, createCjkTokenCounter({ scale }));
    const items = maximumItems();
    const report = {};
    const qualified = await qualifyExtractedItems(model, items, undefined, report);
    assert.deepEqual(report, { itemsShortened: shortened, itemsUnqualified: 0 }, `scale ${scale}`);
    assert.equal(calls.length, 5);
    for (const call of calls) {
      assert.ok(call.tokens <= LIMIT, `qualify request counted ${call.tokens}`);
      const sources = call.input.items[0].sources;
      assert.deepEqual(sources.map((source) => [source.receiptIndex, source.role]),
        [[0, 'user'], [1, 'assistant'], [2, 'user'], [3, 'assistant']], 'every receipt keeps its identity');
      assert.ok(sources.every((source) => source.excerpt.length >= 120 &&
        Boolean(source.excerptShortened) === (source.excerpt.length < 800)));
    }
    anchorsHold(items, qualified);
  }
});

test('CR1 v2 qualification of five maximum CJK items shortens candidate text per item', async () => {
  const { calls, model } = recordingPort('qualifyCandidates', qualifyCandidates, createCjkTokenCounter());
  const items = maximumItems();
  const report = {};
  const qualified = await qualifyCandidateItems(model, items, undefined, undefined, false, report);
  assert.deepEqual(report, { itemsShortened: 5, itemsUnqualified: 0 });
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.ok(call.tokens <= LIMIT, `qualifyCandidates request counted ${call.tokens}`);
    const candidates = call.input.items[0].candidates;
    assert.ok(candidates.some((candidate) => candidate.textShortened === true));
    assert.ok(candidates.every((candidate) => candidate.text.length > 0));
  }
  anchorsHold(items, qualified);
});

// Capture-level: an extractor's 1,024-token output bounds item content, so
// these items carry 100 units of content with four 800-unit receipts each.
const extractFive = () => ({ items: Array.from({ length: 5 }, (_, i) => ({ content: zh(100, i + 20), kind: 'fact',
  confidence: 0.8, sourceIndices: [0, 1, 2, 3] })) });

test('CR1 a v2 capture with long CJK receipts shortens qualification input and commits every memory', async (t) => {
  const f = fixture(t, { counter: createCjkTokenCounter({ scale: 1.4 }),
    options: { captureQualification: 'source-bound-v2' }, qualifyCandidates, extract: extractFive });
  const result = ok(await capture(f.core, messagesOf([800, 800, 800, 800])));
  assert.deepEqual(result.qualificationTruncated, { itemsShortened: 5, itemsUnqualified: 0, reason: 'context_budget' });
  assert.ok(f.calls.every((call) => call.tokens <= LIMIT));
  assert.equal(result.admission.memories.length, 5);
  for (const memory of result.admission.memories) {
    const stored = ok(f.core.get({ namespace, memoryId: memory.id, includeQualification: true }));
    const [anchor] = stored.qualification.anchors;
    assert.equal(stored.receipts.find((receipt) => receipt.id === anchor.receiptId).excerpt.slice(anchor.start, anchor.end), anchor.text);
  }
});

test('CR1 an item that cannot be qualified even at the floor stays unqualified alone; the capture commits', async (t) => {
  const unfit = zh(100, 22);
  const f = fixture(t, { options: { captureQualification: 'source-bound-v2' }, qualifyCandidates, extract: extractFive,
    fitsQualificationRequest: ({ input }) => input.items.length === 1 && input.items[0].content !== unfit });
  const result = ok(await capture(f.core, messagesOf([800, 800, 800, 800])));
  assert.deepEqual(result.qualificationTruncated, { itemsShortened: 0, itemsUnqualified: 1, reason: 'context_budget' });
  const stored = result.admission.memories.map((memory) =>
    ok(f.core.get({ namespace, memoryId: memory.id, includeQualification: true })));
  assert.equal(stored.length, 5);
  assert.deepEqual(stored.map((entry) => entry.qualification === null), stored.map((entry) => entry.memory.content === unfit));
  // The same batch is a completed replay, not a stuck window.
  assert.equal(ok(await capture(f.core, messagesOf([800, 800, 800, 800]))).duplicate, true);
});

test('CR1 keep shortens only its extraction view when its sources no longer fit', async (t) => {
  let counter = createCjkTokenCounter();
  // Cite every source the interpretation was sent, four per field.
  const citeAll = (request) => {
    const anchors = (from) => request.input.sources.slice(from, from + 4)
      .map((source, i) => ({ sourceIndex: from + i, start: 0, end: 2 }));
    const field = (value, from) => anchors(from).length ? { value, anchors: anchors(from) } : null;
    return { ...interpretation(request), type: field('work', 0), gist: field('Synthetic 中文 activity', 0),
      outcome: field('Synthetic outcome', 4) };
  };
  const f = fixture(t, { counter: (text) => counter(text), options: { sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 },
    captureEvidence: 'staged-v1', captureQualification: 'source-bound-v2' }, interpretEpisode: citeAll, qualifyCandidates });
  const messages = messagesOf(Array(9).fill(800)).map((message) => ({ ...message, occurredAt: null }));
  let episodeId;
  for (const [index, batch] of ok(f.core.planCaptureBatches({ messages })).batches.entries()) {
    episodeId = ok(await f.core.capture({ namespace: episodeNamespace, client: 'synthetic', sessionId: 'session',
      eventId: `keep-${index}`, episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'ordinary' },
      messages: batch.map((position) => messages[position]) })).episode.id;
  }
  const episode = ok(f.core.getEpisode({ namespace: episodeNamespace, episodeId })).episode;
  // A denser tokenizer now: the staged sources no longer fit one extraction.
  counter = createCjkTokenCounter({ scale: 3 });
  f.calls.length = 0;
  const kept = ok(await f.core.keepEpisode({ namespace: episodeNamespace, episodeId,
    expectedRevision: episode.revision, actionId: 'keep-all' }));
  const [extract] = f.calls.filter((call) => call.method === 'extract');
  const sent = extract.input.messages;
  assert.ok(sent.length > 1, 'the kept episode cites several sources');
  assert.ok(extract.tokens <= LIMIT, `keep extraction counted ${extract.tokens} with its prompt`);
  assert.ok(sent.every((message) => message.content.length >= 120 &&
    messages.some((source) => source.content.startsWith(message.content))));
  assert.deepEqual(kept.extractionTruncated, { messagesShortened: sent.length });
  assert.equal(kept.episode.policy, 'explicit-keep');
});

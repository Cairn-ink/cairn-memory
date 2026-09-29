import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { packRank, packSelect, TEXT_FLOOR } from '../model-packing.mjs';
import { createCjkTokenCounter } from '../testing/cjk-token-counter.mjs';
import { parity } from '../testing/recall-budget-parity.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Synthetic data and scripted ports only. The counter is shaped like a real
// tokenizer (CJK about one token per character), not a provider tokenizer.
const personal = { ownerId: 'cr1-budget', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'wiki' };
const countTokens = createCjkTokenCounter();
const LIMIT = 6000;
const prompt = (name) => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400)); return r.value; };
const requestTokens = (system, input, counter = countTokens) =>
  counter(JSON.stringify({ system, input, maxOutputTokens: 1024 }));

const passage = '我們今天把部署流程重新整理了一遍，決定先在測試環境驗證資料庫遷移，再請團隊成員檢查設定檔與監控告警。'
  + '下週會議要確認回滾計畫、負責人和時間表，並記錄每一個風險與替代方案。前端頁面的載入速度也要一起量測，避免上線後才發現問題。';
const zh = (length, seed = 0) => Array.from({ length }, (_, i) => passage[(seed * 7 + i) % passage.length]).join('');
const refOf = (item) => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const visible = (input) => input.maps.flatMap(({ namespaceIndex, items }) =>
  items.flatMap((item) => refOf(item) ? [{ namespaceIndex, ...refOf(item) }] : []));
const selectUpTo = (count) => ({ input }) => {
  const perNamespace = new Map();
  return { refs: visible(input).filter((ref) => {
    const used = perNamespace.get(ref.namespaceIndex) ?? 0;
    if (used === 12) return false;
    perNamespace.set(ref.namespaceIndex, used + 1);
    return true;
  }).slice(0, Math.min(count, input.maxRefs)) };
};
const rankAll = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((candidate) => ({
  namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) });
const fileAll = ({ input }) => {
  const topic = input.map.find((item) => item.type === 'moc' && item.moc.level === 'L1');
  return { items: input.memories.map((memory) => topic ? { memoryId: memory.id, parentIds: [topic.moc.id] }
    : { memoryId: memory.id, parentIds: [], newL1: { title: '部署', parentL2Ids: [] } }) };
};

function fixture(t, { select = selectUpTo(24), rank = rankAll, extract, counter = countTokens } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'cr1-budget-' });
  const calls = [];
  const record = (method, step) => async (request) => {
    calls.push({ method, tokens: requestTokens(request.system, request.input, counter),
      system: request.system, input: structuredClone(request.input) });
    return step(request);
  };
  const model = { contextWindow: 8192, countTokens: counter, select: record('select', select),
    rank: record('rank', rank), ...(extract ? { extract, classify: fileAll } : {}) };
  const core = openMemoryCore({ path: join(ws.path, 'memory.sqlite'), model });
  ws.defer(() => core.close());
  let events = 0;
  const admit = (content, excerpt = content, namespace = personal, eventId = `event-${events++}`) =>
    ok(core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ client: 'wiki', sessionId: 's', eventId, role: 'user', excerpt }] })).memory;
  return { core, model, calls, admit };
}

function withinBudget(calls) {
  assert.ok(calls.length > 0, 'at least one model call ran');
  for (const call of calls) assert.ok(call.tokens <= LIMIT, `${call.method} request counted ${call.tokens} tokens`);
}

// Every receipt a ranked candidate returns was sent with its identity whole;
// only excerpt text may be shorter, marked, and still an original slice.
function sameReceiptIdentities(sent, returned) {
  assert.deepEqual(sent.map((receipt) => receipt.id), returned.map((receipt) => receipt.id));
  for (const [index, receipt] of sent.entries()) {
    const { excerpt, excerptShortened, ...identity } = receipt;
    const { excerpt: original, ...expected } = returned[index];
    assert.deepEqual(identity, expected);
    assert.ok(original.includes(excerpt));
    assert.equal(excerptShortened === true, excerpt !== original);
  }
}

// The candidate exactly as recall assembled it before packing: two fetch pages.
function fullCandidate(core, namespace, namespaceIndex, memory) {
  const request = { namespace, tokenBudget: 4000, refs: [{ memoryId: memory.id, revision: memory.revision }] };
  const first = ok(core.fetch(request));
  const pages = [first, ...(first.exhausted ? [] : [ok(core.fetch({ ...request, cursor: first.nextCursor }))])];
  return { namespaceIndex, ...pages.at(-1).items[0], receipts: pages.flatMap((page) => page.items[0].receipts) };
}

test('CR1 probe 1: one memory re-extracted from many ~300-character Chinese turns stays recallable', async (t) => {
  const content = '部署前先在測試環境驗證資料庫遷移';
  const f = fixture(t, { extract: async () => ({ items: [{ content, kind: 'preference', confidence: 0.9, sourceIndices: [0] }] }) });
  const turn = zh(300, 1);
  const query = '部署 流程 要注意什麼';
  let memory;
  for (let captured = 1; captured <= 40; captured++) {
    ok(await f.core.capture({ namespace: personal, client: 'wiki', eventId: `turn-${captured}`, sessionId: 's',
      messages: [{ id: `message-${captured}`, role: 'user', content: turn }] }));
    // o200k x 1.15 crossed 6,000 at 14 captures; this coarser counter crosses at 15.
    if (![15, 20, 40].includes(captured)) continue;
    memory = ok(f.core.list({ namespace: personal })).memories[0];
    const unpacked = requestTokens(prompt('recall-rank'), { query, limit: 6,
      candidates: [fullCandidate(f.core, personal, 0, memory)] });
    assert.ok(unpacked > LIMIT, `unpacked rank request at ${captured} captures counted ${unpacked}`);
    f.calls.length = 0;
    const result = ok(await f.core.recall({ readSet: [personal], query }));
    withinBudget(f.calls);
    const sent = f.calls.find((call) => call.method === 'rank').input.candidates[0];
    assert.equal(sent.textShortened, true);
    assert.deepEqual([sent.memory.id, sent.memory.revision], [memory.id, memory.revision]);
    assert.equal(result.memories.length, 1);
    assert.deepEqual(result.memories[0].receipts, fullCandidate(f.core, personal, 0, memory).receipts,
      'returned receipts are the complete fetched prefix, never shortened');
    sameReceiptIdentities(sent.receipts, result.memories[0].receipts);
    assert.equal(result.memories[0].memory.content, content);
    assert.deepEqual(result.recallTruncated, { navigationItemsOmitted: 0, candidatesOmitted: 0, candidatesShortened: 1 });
    assert.equal(result.coverage, 'budget_exhausted');
  }
  assert.equal(memory.receiptCount, 40);
});

test('CR1 probe 1: short English turns re-extracting one memory stay recallable past the old limit', async (t) => {
  const f = fixture(t);
  const content = 'Run the deploy checklist before every release.';
  const turn = 'I always want the deploy checklist run before every release, so please remind me next time.';
  for (let i = 0; i < 120; i++) f.admit(content, turn, personal, `turn-${i}`);
  const memory = ok(f.core.list({ namespace: personal })).memories[0];
  assert.equal(memory.receiptCount, 120);
  const query = 'deploy checklist';
  assert.ok(requestTokens(prompt('recall-rank'), { query, limit: 6,
    candidates: [fullCandidate(f.core, personal, 0, memory)] }) > LIMIT);
  const result = ok(await f.core.recall({ readSet: [personal], query }));
  withinBudget(f.calls);
  assert.equal(result.memories[0].receipts.length, fullCandidate(f.core, personal, 0, memory).receipts.length);
  sameReceiptIdentities(f.calls.find((call) => call.method === 'rank').input.candidates[0].receipts,
    result.memories[0].receipts);
  assert.equal(result.recallTruncated.candidatesShortened, 1);
});

test('CR1 a candidate whose receipt identities alone cannot fit is left out whole, never partially', async (t) => {
  const f = fixture(t);
  const kept = f.admit('Deploy checklist owner is Lin.', 'Deploy checklist owner is Lin.');
  // Tiny excerpts let two fetch pages carry about 160 receipts, whose identity
  // fields alone exceed the rank budget.
  for (let i = 0; i < 200; i++) f.admit('Deploy checklist reminder', `r${i}`, personal, `crowded-${i}`);
  const result = ok(await f.core.recall({ readSet: [personal], query: 'deploy checklist' }));
  withinBudget(f.calls);
  const rank = f.calls.find((call) => call.method === 'rank');
  assert.deepEqual(rank.input.candidates.map((candidate) => candidate.memory.id), [kept.id]);
  assert.deepEqual(result.memories.map((item) => item.memory.id), [kept.id]);
  assert.deepEqual(result.recallTruncated, { navigationItemsOmitted: 0, candidatesOmitted: 1, candidatesShortened: 0 });
});

test('CR1 probe 2: ten distinct Chinese memories with a selector returning twelve refs', async (t) => {
  const f = fixture(t, { select: selectUpTo(12) });
  const memories = Array.from({ length: 10 }, (_, i) => f.admit(`第${i}號決定：${zh(200, i)}`, zh(300, i + 50)));
  const query = '部署 決定';
  const unpacked = requestTokens(prompt('recall-rank'), { query, limit: 6,
    candidates: memories.map((memory) => fullCandidate(f.core, personal, 0, memory)) });
  assert.ok(unpacked > LIMIT, `unpacked rank request counted ${unpacked}`);
  const result = ok(await f.core.recall({ readSet: [personal], query }));
  withinBudget(f.calls);
  const sent = f.calls.find((call) => call.method === 'rank').input.candidates;
  assert.equal(sent.length, 10, 'every selected candidate still reaches the ranker');
  assert.equal(result.memories.length, 6);
  for (const item of result.memories) {
    const stored = ok(f.core.get({ namespace: personal, memoryId: item.memory.id }));
    assert.equal(item.memory.content, stored.memory.content);
    assert.deepEqual(item.receipts, stored.receipts);
  }
  assert.deepEqual(result.recallTruncated, { navigationItemsOmitted: 0, candidatesOmitted: 0, candidatesShortened: 10 });
});

test('CR1 probe 2: fifty-nine Chinese memories over personal and project with a selector returning six', async (t) => {
  const f = fixture(t, { select: selectUpTo(6) });
  for (let i = 0; i < 59; i++) f.admit(`第${i}號記錄：${zh(160, i)}`, zh(300, i + 9), i % 2 ? project : personal);
  const query = '部署 記錄';
  const maps = [personal, project].map((namespace, namespaceIndex) => {
    const page = ok(f.core.map({ namespace, purpose: 'recall', tokenBudget: 4000 }));
    return { namespaceIndex, items: page.items, exhausted: page.exhausted };
  });
  const unpacked = requestTokens(prompt('recall-select'), { query, maps, maxRefs: 24 });
  assert.ok(unpacked > LIMIT, `unpacked select request counted ${unpacked}`);
  const result = ok(await f.core.recall({ readSet: [personal, project], query }));
  withinBudget(f.calls);
  const [first] = f.calls;
  assert.ok(first.input.maps.every((map) => map.items.length > 0), 'round-robin keeps both namespaces visible');
  assert.ok(first.input.maps.every((map) => map.exhausted === false));
  assert.ok(result.memories.length > 0 && result.memories.length <= 6);
  assert.ok(result.recallTruncated.navigationItemsOmitted > 0);
  assert.equal(result.coverage, 'budget_exhausted');
});

test('CR1 one hundred distinct Chinese memories in each of two namespaces', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 100; i++) {
    f.admit(`個人第${i}則：${zh(220, i)}`, zh(400, i + 3), personal);
    f.admit(`專案第${i}則：${zh(220, i + 1)}`, zh(400, i + 4), project);
  }
  const result = ok(await f.core.recall({ readSet: [personal, project], query: '部署 流程', limit: 12 }));
  withinBudget(f.calls);
  assert.deepEqual(f.calls.map((call) => call.method), ['select', 'select', 'rank']);
  assert.ok(result.memories.length > 0 && result.memories.length <= 12);
  assert.ok(result.recallTruncated.navigationItemsOmitted > 0);
  const sent = f.calls.at(-1).input.candidates;
  assert.ok(sent.every((candidate) => candidate.receipts.length <= candidate.receiptCount));
});

test('CR1 very long single memories are shortened or, when unfetchable, omitted and reported', async (t) => {
  const f = fixture(t);
  const english = Array.from({ length: 5 }, (_, i) =>
    f.admit(`Long English note ${i}: ${'The rollout owner reviews the migration plan and dashboards. '.repeat(64)}`.slice(0, 3900),
      'Source turn for the rollout review. '.repeat(22).slice(0, 800)));
  const chinese = Array.from({ length: 3 }, (_, i) => f.admit(`長篇記錄${i}：${zh(2000, i)}`, zh(300, i + 20)));
  const oversized = f.admit(`超長記錄：${zh(3600, 5)}`, zh(300, 30));
  assert.equal(f.core.fetch({ namespace: personal, tokenBudget: 4000,
    refs: [{ memoryId: oversized.id, revision: oversized.revision }] }).error.code, 'context_item_too_large');
  const result = ok(await f.core.recall({ readSet: [personal], query: 'rollout 部署', limit: 12 }));
  withinBudget(f.calls);
  const rank = f.calls.find((call) => call.method === 'rank');
  assert.ok(!rank.input.candidates.some((candidate) => candidate.memory.id === oversized.id));
  assert.ok(!result.memories.some((item) => item.memory.id === oversized.id));
  assert.equal(result.recallTruncated.candidatesOmitted, 1, 'the unfetchable memory is reported, not fatal');
  const byId = new Map([...english, ...chinese].map((memory) => [memory.id, memory]));
  for (const candidate of rank.input.candidates) {
    const original = ok(f.core.get({ namespace: personal, memoryId: candidate.memory.id }));
    assert.ok(byId.has(candidate.memory.id));
    assert.ok(original.memory.content.includes(candidate.memory.content), 'shortened text is an original slice');
    assert.ok([...candidate.memory.content].length >= Math.min(TEXT_FLOOR, [...original.memory.content].length));
  }
  for (const item of result.memories) {
    assert.equal(item.memory.content, ok(f.core.get({ namespace: personal, memoryId: item.memory.id })).memory.content);
  }
});

test('CR1 source-evidence recall leaves out a memory whose complete source set cannot be fetched', async (t) => {
  const f = fixture(t);
  const kept = f.admit('部署 前先備份資料庫', '部署 前先備份資料庫');
  const crowded = f.admit('部署 與監控的逐次記錄', zh(40, 0));
  for (let i = 1; i <= 100; i++) f.admit('部署 與監控的逐次記錄', zh(40, i));
  assert.equal(ok(f.core.get({ namespace: personal, memoryId: crowded.id })).memory.receiptCount, 101);
  const result = ok(await f.core.recall({ readSet: [personal], query: '部署', contextMode: 'source-evidence' }));
  withinBudget(f.calls);
  assert.deepEqual(result.memories.map((item) => item.memory.id), [kept.id]);
  assert.equal(result.recallTruncated.candidatesOmitted, 1);
  assert.equal(result.coverage, 'budget_exhausted');
});

test('CR1 a receipt page that cannot fit keeps earlier receipts and reports incomplete fetch', async (t) => {
  const f = fixture(t);
  const content = `長篇記錄：${zh(3000, 2)}`;
  const memory = f.admit(content, '短');
  await new Promise((resolve) => setTimeout(resolve, 5));
  f.admit(content, zh(800, 4));
  const result = ok(await f.core.recall({ readSet: [personal], query: '部署' }));
  withinBudget(f.calls);
  assert.equal(result.memories[0].memory.id, memory.id);
  assert.deepEqual(result.memories[0].receipts.map((receipt) => receipt.excerpt), ['短']);
  assert.equal(result.memories[0].receiptCount, 2);
  assert.equal(result.namespaces[0].fetchExhausted, false);
  assert.equal(result.coverage, 'budget_exhausted');
});

test('CR1 mixed Chinese and code memories keep exact slices and identities', async (t) => {
  const f = fixture(t);
  const code = 'const plan = await deploy({ env: "staging", dryRun: true }); if (!plan.ok) throw new Error(plan.code); ';
  const memories = Array.from({ length: 8 }, (_, i) => f.admit(
    `部署腳本${i}：${zh(300, i)} ${code.repeat(6)} ${zh(300, i + 1)}`, `${code} ${zh(250, i + 2)}`));
  const query = 'deploy staging 部署';
  assert.ok(requestTokens(prompt('recall-rank'), { query, limit: 6,
    candidates: memories.map((memory) => fullCandidate(f.core, personal, 0, memory)) }) > LIMIT);
  const result = ok(await f.core.recall({ readSet: [personal], query }));
  withinBudget(f.calls);
  const sent = f.calls.find((call) => call.method === 'rank').input.candidates;
  assert.equal(sent.length, 8);
  for (const candidate of sent) {
    const stored = ok(f.core.get({ namespace: personal, memoryId: candidate.memory.id }));
    assert.equal(candidate.memory.revision, stored.memory.revision);
    assert.ok(stored.memory.content.includes(candidate.memory.content));
    sameReceiptIdentities(candidate.receipts, stored.receipts);
  }
  assert.equal(result.memories.length, 6);
});

test('CR1 packing is deterministic for the same inputs', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 30; i++) f.admit(`第${i}號：${zh(400, i)}`, zh(500, i + 1));
  const first = ok(await f.core.recall({ readSet: [personal], query: '部署 測試' }));
  const requests = f.calls.splice(0).map(({ method, input }) => ({ method, input }));
  const second = ok(await f.core.recall({ readSet: [personal], query: '部署 測試' }));
  assert.deepEqual(f.calls.map(({ method, input }) => ({ method, input })), requests);
  assert.deepEqual(second, first);
  assert.ok(first.recallTruncated);
});

test('CR1 small fitting recalls keep main 3a1c17d request and result bytes', async (t) => {
  const ws = createTestWorkspace(t, { prefix: 'cr1-parity-' });
  const fixture = JSON.parse(readFileSync(new URL('../testing/recall-budget-main-fixture.json', import.meta.url), 'utf8'));
  assert.equal(fixture.base, '3a1c17d9c888b28e878f5e2d8de0180d9b49fa4e');
  assert.deepEqual(await parity(openMemoryCore, join(ws.path, 'memory.sqlite')), fixture.cases);
});

test('CR1 a selector cannot pick a ref that packing left out of its request', async (t) => {
  let hidden;
  const f = fixture(t, { select: ({ input }) => {
    const shown = new Set(visible(input).map((ref) => ref.memoryId));
    hidden = ok(f.core.list({ namespace: personal, limit: 100 })).memories.find((memory) => !shown.has(memory.id));
    return { refs: [{ namespaceIndex: 0, memoryId: hidden.id, revision: hidden.revision }] };
  } });
  for (let i = 0; i < 60; i++) f.admit(`第${i}號：${zh(160, i)}`, zh(100, i), personal);
  for (let i = 0; i < 60; i++) f.admit(`專案${i}號：${zh(160, i)}`, zh(100, i), project);
  const result = await f.core.recall({ readSet: [personal, project], query: '部署' });
  assert.ok(hidden, 'packing left at least one personal ref out');
  assert.deepEqual(result, { ok: false, error: { code: 'invalid_model_output', retryable: false } });
});

test('CR1 a maximal Chinese query still recalls; only a query that cannot fit alone is refused', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) f.admit(`第${i}號：${zh(200, i)}`, zh(300, i));
  const result = ok(await f.core.recall({ readSet: [personal], query: zh(4000, 3) }));
  withinBudget(f.calls);
  assert.ok(result.memories.length > 0);
  const heavy = fixture(t, { counter: (text) => text.length * 2 });
  heavy.admit('Short note');
  assert.deepEqual(await heavy.core.recall({ readSet: [personal], query: 'q'.repeat(3100) }),
    { ok: false, error: { code: 'context_budget_exceeded', retryable: false } });
  assert.equal(heavy.calls.length, 0);
});

// Direct packer contracts on synthetic requests.
const units = (text) => [...text].length;
const lengthCounter = (text) => units(text);

test('CR1 packSelect returns the same object when it fits and shares room round-robin otherwise', () => {
  const item = (i) => ({ type: 'unfiled', ref: { memoryId: `m${i}`, revision: 1 }, label: 'x'.repeat(100) });
  const input = { query: 'q', maps: [
    { namespaceIndex: 0, items: Array.from({ length: 30 }, (_, i) => item(i)), exhausted: true },
    { namespaceIndex: 1, items: Array.from({ length: 30 }, (_, i) => item(i + 30)), exhausted: true }], maxRefs: 24 };
  const roomy = { countTokens: () => 1 };
  assert.equal(packSelect(roomy, 'system', input).input, input);
  const model = { countTokens: lengthCounter };
  const packed = packSelect(model, 'system', input);
  assert.ok(lengthCounter(JSON.stringify({ system: 'system', input: packed.input, maxOutputTokens: 1024 })) <= LIMIT);
  const [left, right] = packed.input.maps.map((map) => map.items.length);
  assert.ok(Math.abs(left - right) <= 1 && left + right === 60 - packed.omitted && packed.omitted > 0);
  assert.deepEqual(packed.input.maps.map((map) => map.exhausted), [false, false]);
  assert.deepEqual(packed.input.maps[0].items, input.maps[0].items.slice(0, left));
  assert.deepEqual(packSelect(model, 'system', input), packed);
  const overflow = packSelect({ countTokens: () => LIMIT + 1 }, 'system', input);
  assert.equal(overflow.overflow, true);
  assert.ok(overflow.input.maps.every((map) => map.items.length === 0));
});

test('CR1 packRank keeps atomic candidates whole, admits in order and shortens only text', () => {
  const candidate = (i, text, extra = {}) => ({ namespaceIndex: 0, memory: { id: `m${i}`, revision: 1, content: text },
    receipts: [{ id: `r${i}`, client: 'c', excerpt: text }], receiptCount: 1, ...extra });
  const shorten = (value) => ({ points: units(value.memory.content) + units(value.receipts[0].excerpt), view: (n) => ({
    ...value, memory: { ...value.memory, content: value.memory.content.slice(0, Math.min(n, units(value.memory.content))) },
    receipts: n > units(value.memory.content) ? [{ ...value.receipts[0],
      excerpt: value.receipts[0].excerpt.slice(0, n - units(value.memory.content)) }] : [], textShortened: true }) });
  const model = { countTokens: lengthCounter };
  const big = candidate(0, 'a'.repeat(5000));
  const small = [1, 2].map((i) => candidate(i, 'b'.repeat(200)));
  const input = { query: 'q', limit: 6, candidates: [big, ...small] };
  const atomic = packRank(model, 'system', input, () => null);
  assert.deepEqual(atomic.included, [1, 2], 'a candidate that cannot fit whole is skipped, not cut');
  assert.deepEqual(atomic.input.candidates, small);
  assert.equal(atomic.shortened, 0);
  const qualified = { ...input, candidates: input.candidates.map((value, i) =>
    ({ ...value, qualification: { anchors: [{ receiptId: `r${i}`, text: 'kept whole' }] } })) };
  const packed = packRank(model, 'system', qualified, shorten);
  assert.deepEqual(packed.included, [0, 1, 2]);
  assert.ok(lengthCounter(JSON.stringify({ system: 'system', input: packed.input, maxOutputTokens: 1024 })) <= LIMIT);
  for (const [position, sent] of packed.input.candidates.entries()) {
    const original = qualified.candidates[position];
    assert.deepEqual(sent.qualification, original.qualification);
    assert.deepEqual([sent.memory.id, sent.memory.revision, sent.receiptCount], [original.memory.id, 1, 1]);
    assert.ok(original.memory.content.startsWith(sent.memory.content));
  }
  assert.equal(packed.input.candidates[1], qualified.candidates[1], 'a candidate under the cap stays the same object');
  assert.deepEqual(packRank(model, 'system', qualified, shorten), packed);
  const fits = { query: 'q', limit: 6, candidates: small };
  assert.equal(packRank(model, 'system', fits, shorten).input, fits);
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { countOpenAITokens } from '../index.mjs';

// Exact local o200k_base counts, padded 15% as a host counter does. Synthetic
// data and scripted ports only: no key, transport or generation.
const countTokens = (text) => Math.ceil(countOpenAITokens(text) * 1.15);
const personal = { ownerId: 'cr1-o200k', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'wiki' };
const prompt = (name) => readFileSync(new URL(`../../../core/prompts/${name}.md`, import.meta.url), 'utf8');
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400)); return r.value; };
const requestTokens = (system, input) => countTokens(JSON.stringify({ system, input, maxOutputTokens: 1024 }));
const passage = '我們今天把部署流程重新整理了一遍，決定先在測試環境驗證資料庫遷移，再請團隊成員檢查設定檔與監控告警。'
  + '下週會議要確認回滾計畫、負責人和時間表，並記錄每一個風險與替代方案。前端頁面的載入速度也要一起量測，避免上線後才發現問題。';
const zh = (length, seed = 0) => Array.from({ length }, (_, i) => passage[(seed * 7 + i) % passage.length]).join('');
const refOf = (item) => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;

function fixture(t, selectCount) {
  const calls = [];
  const record = (method, step) => async (request) => {
    calls.push({ method, tokens: requestTokens(request.system, request.input), input: request.input });
    return step(request);
  };
  const model = { contextWindow: 8192, countTokens,
    extract: async () => ({ items: [{ content: '部署前先在測試環境驗證資料庫遷移', kind: 'preference',
      confidence: 0.9, sourceIndices: [0] }] }),
    select: record('select', ({ input }) => {
      const used = new Map();
      return { refs: input.maps.flatMap(({ namespaceIndex, items }) => items.flatMap((item) =>
        refOf(item) ? [{ namespaceIndex, ...refOf(item) }] : [])).filter((ref) => {
        const count = used.get(ref.namespaceIndex) ?? 0;
        used.set(ref.namespaceIndex, count + 1);
        return count < 12;
      }).slice(0, Math.min(selectCount, input.maxRefs)) };
    }),
    rank: record('rank', ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((candidate) => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) })) };
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cr1-o200k-')), 'memory.sqlite'), model });
  t.after(() => core.close());
  return { core, calls };
}

function fullCandidate(core, namespace, memory) {
  const request = { namespace, tokenBudget: 4000, refs: [{ memoryId: memory.id, revision: memory.revision }] };
  const first = ok(core.fetch(request));
  const pages = [first, ...(first.exhausted ? [] : [ok(core.fetch({ ...request, cursor: first.nextCursor }))])];
  return { namespaceIndex: 0, ...pages.at(-1).items[0], receipts: pages.flatMap((page) => page.items[0].receipts) };
}

test('CR1 o200k probe 1: re-extracting one memory from long Chinese turns stays within 6,000 tokens', async (t) => {
  const f = fixture(t, 24);
  const turn = zh(300, 1);
  for (let captured = 1; captured <= 20; captured++) {
    ok(await f.core.capture({ namespace: personal, client: 'wiki', eventId: `turn-${captured}`, sessionId: 's',
      messages: [{ id: `message-${captured}`, role: 'user', content: turn }] }));
    if (![15, 20].includes(captured)) continue;
    const memory = ok(f.core.list({ namespace: personal })).memories[0];
    const unpacked = requestTokens(prompt('recall-rank'), { query: '部署 流程', limit: 6,
      candidates: [fullCandidate(f.core, personal, memory)] });
    assert.ok(unpacked > 6000, `unpacked rank request at ${captured} captures counted ${unpacked}`);
    f.calls.length = 0;
    const result = ok(await f.core.recall({ readSet: [personal], query: '部署 流程' }));
    assert.ok(f.calls.every((call) => call.tokens <= 6000), JSON.stringify(f.calls.map((call) => call.tokens)));
    assert.equal(result.memories.length, 1);
    assert.equal(result.recallTruncated.candidatesShortened, 1);
  }
});

test('CR1 o200k probe 2: distinct Chinese memories with twelve or six selected refs', async (t) => {
  for (const [count, selectCount, readSet] of [[10, 12, [personal]], [59, 6, [personal, project]]]) {
    const f = fixture(t, selectCount);
    for (let i = 0; i < count; i++) ok(f.core.admit({ namespace: readSet[i % readSet.length],
      memory: { content: `第${i}號決定：${zh(200, i)}`, kind: 'fact' },
      receipts: [{ client: 'wiki', sessionId: 's', eventId: `event-${i}`, role: 'user', excerpt: zh(300, i + 50) }] }));
    const result = ok(await f.core.recall({ readSet, query: '部署 決定' }));
    assert.ok(f.calls.every((call) => call.tokens <= 6000), JSON.stringify(f.calls.map((call) => call.tokens)));
    assert.equal(result.memories.length, 6);
    assert.ok(result.recallTruncated, 'these requests only fit because they were packed');
  }
});

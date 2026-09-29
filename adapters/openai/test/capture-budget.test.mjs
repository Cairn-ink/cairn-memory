import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { qualifyExtractedItems } from '../../../core/automatic-qualification.mjs';
import { qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { countOpenAITokens } from '../index.mjs';

// Exact local o200k_base counts, padded 15% as a host counter does. Synthetic
// text and scripted ports only: no key, transport or generation.
const countTokens = (text) => Math.ceil(countOpenAITokens(text) * 1.15);
const fill = (alphabet, units) => {
  const points = [...alphabet];
  let text = '';
  for (let i = 0; ; i++) {
    const point = points[i % points.length];
    if (text.length + point.length > units) return text.normalize('NFKC');
    text += point;
  }
};
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).join('');
const ordinary = {
  Chinese: '我們今天把部署流程重新整理了一遍決定先在測試環境驗證資料庫遷移再請團隊成員檢查設定檔與監控告警',
  Japanese: '今日はデプロイの手順を見直しましたテスト環境で移行を確認してから本番に反映します',
  Korean: '오늘배포절차를다시정리했습니다테스트환경에서데이터베이스이전을먼저검증합니다',
  English: 'We reviewed the deployment steps and verified the database migration before release. ',
};
// The densest scripts measured: CJK Extension A and Yi syllables.
const dense = { 'CJK Extension A': range(0x3400, 0x4dbf), Yi: range(0xa000, 0xa48c) };
const modes = {
  plain: {}, 'source-bound-v1': { captureQualification: 'source-bound-v1' },
  'source-bound-v2': { captureQualification: 'source-bound-v2' },
  'indexed-evidence-v1': { captureSourcePolicy: 'indexed-evidence-v1' },
  episodes: { sessionEpisodes: { mode: 'episode-v1' }, captureEvidence: 'staged-v1', captureQualification: 'source-bound-v2' },
};
function open(t, options) {
  const ws = createTestWorkspace(t, { prefix: 'cr1-o200k-capture-' });
  const core = openMemoryCore({ path: join(ws.path, 'memory.sqlite'), ...options,
    model: { contextWindow: 8192, countTokens, extract: () => ({ items: [] }) } });
  ws.defer(() => core.close());
  return core;
}
const plan = (core, content) => {
  const result = core.planCaptureBatches({ messages: [{ id: 'maximum', role: 'user', content }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

test('CR1 o200k: one maximum-length message of ordinary text fits alone in every capture mode', (t) => {
  for (const [mode, options] of Object.entries(modes)) {
    const core = open(t, options);
    for (const [script, alphabet] of Object.entries(ordinary)) {
      assert.deepEqual(plan(core, fill(alphabet, 4000)), { batches: [[0]], oversizedMessageIndices: [] }, `${mode} ${script}`);
    }
  }
});

test('CR1 o200k: 800-unit views fit dense rare scripts; a dense 4,000-unit plain message is reported, not split', (t) => {
  for (const [mode, options] of Object.entries(modes)) {
    const core = open(t, options);
    for (const [script, alphabet] of Object.entries(dense)) {
      const viewed = ['source-bound-v2', 'episodes'].includes(mode);
      assert.deepEqual(plan(core, fill(alphabet, 4000)), viewed
        ? { batches: [[0]], oversizedMessageIndices: [] } : { batches: [], oversizedMessageIndices: [0] }, `${mode} ${script}`);
    }
  }
});

test('CR1 o200k: maximum dense-script qualification items are shortened, never left unqualified', async () => {
  const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
  for (const alphabet of Object.values(dense)) {
    const items = Array.from({ length: 5 }, (_, i) => ({ content: fill(alphabet.slice(i * 7), 600), kind: 'fact',
      confidence: 0.8, receipts: Array.from({ length: 4 }, (_, r) => ({ client: 'wiki', sessionId: 'session',
        eventId: `event-${i}-${r}`, role: 'user', excerpt: fill(alphabet.slice(i * 4 + r), 800) })) }));
    const tokens = [];
    const legacy = { contextWindow: 8192, countTokens, qualify: ({ system, input }) => {
      tokens.push(countTokens(JSON.stringify({ system, input, maxOutputTokens: 1024 })));
      return { qualifications: input.items.map(({ itemIndex, sources }) => ({ itemIndex, qualification: { version: 1,
        slot: { subject: null, property: null, scope: null, applies: null }, value: null, attribution: 'unknown',
        commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0, end: 1, text: sources[0].excerpt.slice(0, 1),
          fields: ['attribution'] }] } })) };
    } };
    const v1 = {};
    await qualifyExtractedItems(legacy, items, undefined, v1);
    const candidates = { contextWindow: 8192, countTokens, qualifyCandidates: ({ system, input }) => {
      tokens.push(countTokens(JSON.stringify({ system, input, maxOutputTokens: 1024 })));
      return { qualifications: input.items.map((entry) => ({ itemIndex: entry.itemIndex, ...Object.fromEntries(fields.map((field) =>
        [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
          evidenceIndices: field === 'subject' ? [entry.candidates[0].candidateIndex] : [] }])) })) };
    } };
    const v2 = {};
    await qualifyCandidateItems(candidates, items, undefined, undefined, false, v2);
    assert.deepEqual([v1.itemsUnqualified, v2.itemsUnqualified], [0, 0]);
    assert.deepEqual([v1.itemsShortened, v2.itemsShortened], [5, 5]);
    assert.ok(tokens.every((count) => count <= 6000), JSON.stringify(tokens));
  }
});

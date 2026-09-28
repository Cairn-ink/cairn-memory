import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createQueryScore } from '../query-candidates.mjs';
import { packMixedAnswer } from '../../evaluation/longmemeval/mixed-answer.mjs';
import { verifiedEvidence } from '../../evaluation/longmemeval/mixed-evidence.mjs';
import { INGESTION_CLIENT } from '../../evaluation/longmemeval/ingestion.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'synthetic-recall-diagnosis', scope: 'personal', projectId: null };
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = (row, namespaceIndex) => ({ namespaceIndex, ...(row.type === 'unfiled'
  ? row.ref : { memoryId: row.ref.childId, revision: row.ref.childRevision }) });
const answerText = packed => JSON.parse(packed.request.messages[1].content).evidence
  .map(unit => unit.text).join('\n');
// Fixed public-language substitutions stand in for a model's semantic reading;
// both callbacks still score only their visible input, never a fixture identity.
const visibleScore = query => {
  const normalize = text => text.replaceAll('whistle', 'signal').replaceAll('dawn', 'morning');
  const score = createQueryScore(normalize(query));
  const required = new Set(normalize(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).size;
  return text => score(normalize(text)) === required;
};

async function scenario(t, { receiptCount = 5, distractors = 12, queryMode = 'exact' } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-indexed-recall-' });
  const path = join(workspace.path, 'store.sqlite');
  const frames = { select: [], rank: [] };
  const model = {
    contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{
      content: input.messages[0].content.startsWith('ARCHIVE')
        ? 'Generic archive interpretation' : input.messages[0].content,
      kind: 'context', confidence: 0.8, sourceIndices: [0],
    }] }),
    classify: ({ input }) => ({ items: input.memories.map(memory =>
      ({ memoryId: memory.id, parentIds: [] })) }),
    select: ({ input }) => {
      frames.select.push(structuredClone(input));
      const matches = visibleScore(input.query);
      return { refs: input.maps.flatMap(page => page.items
        .filter(row => matches(row.label))
        .map(row => ref(row, page.namespaceIndex))).slice(0, input.maxRefs) };
    },
    rank: ({ input }) => {
      frames.rank.push(structuredClone(input));
      const matches = visibleScore(input.query);
      return { refs: input.candidates
        .filter(row => row.receipts.some(receipt => matches(receipt.excerpt)))
        .slice(0, input.limit).map(row => ({ namespaceIndex: row.namespaceIndex,
          memoryId: row.memory.id, revision: row.memory.revision })) };
    },
  };
  let core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core.close());
  const plan = { cairnPlan: { batches: [] }, originMap: { turns: [], windows: [] } };
  const capture = async (source, index) => {
    const sessionId = index < receiptCount ? 'earlier-session' : 'later-session';
    const messageId = `message-${index}`, turnId = `turn-${index}`;
    const captureInput = { namespace, client: INGESTION_CLIENT, sessionId,
      eventId: `event-${index}`, messages: [{ id: messageId, role: 'user', content: source }] };
    const captured = value(await core.capture(captureInput));
    plan.cairnPlan.batches.push({ batchIndex: index, captureInput,
      sourceMap: [{ messageId, messageIndex: 0, turnId, role: 'user' }],
      indexedWindows: [{ id: messageId, messageIndex: 0, role: 'user', content: source, index: 0 }] });
    plan.originMap.turns.push({ renderedTurnId: turnId,
      originalSessionIndex: index < receiptCount ? 0 : 1, originalTurnIndex: index });
    plan.originMap.windows.push({ batchIndex: index, windowIndex: 0,
      renderedTurnId: turnId, classification: 'synthetic',
      originalStartUtf16: 0, originalEndUtf16: source.length });
    return captured;
  };
  let target;
  for (let index = 0; index < receiptCount; index++) {
    const source = `ARCHIVE marker${index} records the whistle event at dawn.`;
    target = (await capture(source, index)).admission.memories[0];
  }
  for (let index = receiptCount; index < receiptCount + distractors; index++)
    await capture(`Unrelated item ${index}.`, index);
  const retained = value(core.get({ namespace, memoryId: target.id }));
  assert.equal(retained.receipts.length, receiptCount);
  // Query the actual index traversal order; no stored row or ID is rewritten.
  const db = new DatabaseSync(path, { readOnly: true });
  let ordered;
  try { ordered = db.prepare('SELECT excerpt FROM receipts WHERE memory_id = ? ORDER BY id').all(target.id); }
  finally { db.close(); }
  assert.equal(ordered.length, receiptCount);
  const targetSource = ordered.at(-1).excerpt;
  const marker = targetSource.match(/marker\d+/u)?.[0];
  assert.ok(marker);
  const query = queryMode === 'paraphrase' ? `${marker} morning signal`
    : queryMode === 'unknown' ? 'unseen comet' : marker;
  core.close();
  core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  const recalled = value(await core.recall({ readSet: [namespace], query, limit: 6,
    contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  const evidence = verifiedEvidence(recalled, input => core.get(input), plan, namespace);
  const packed = packMixedAnswer({ question: { text: 'When was the whistle event?', date: '2026-01-01' },
    units: evidence.units, countTokens: () => 1 });
  return { retained, target, targetSource, marker, recalled, evidence, packed, frames };
}

test('thirteen-card select can miss a cold-retained source beyond the four-receipt preview', async t => {
  const { retained, target, marker, recalled, packed, frames } = await scenario(t);
  assert.equal(retained.receipts.length, 5);
  assert.equal(frames.select.length, 1);
  assert.ok(frames.select[0].maps[0].items.some(row => row.ref?.memoryId === target.id));
  assert.ok(frames.select[0].maps[0].items.every(row => !row.label.includes(marker)));
  assert.equal(recalled.memories.length, 0);
  assert.equal(packed.selectedIndices.length, 0);
  assert.equal(answerText(packed), '');
});

test('fourth receipt control: same thirteen-card route reaches rank and pack', async t => {
  const { marker, recalled, packed, frames } = await scenario(t, { receiptCount: 4 });
  assert.equal(recalled.selection.strategy, 'model-selected');
  assert.equal(frames.select.length, 1);
  assert.equal(frames.rank.length, 1);
  assert.ok(answerText(packed).includes(marker));
});

test('twelve-card control: complete-map route fetches the fifth receipt', async t => {
  const { marker, recalled, packed, frames } = await scenario(t, { distractors: 11 });
  assert.equal(recalled.selection.strategy, 'complete-map');
  assert.equal(frames.select.length, 0);
  assert.equal(frames.rank.length, 1);
  assert.ok(answerText(packed).includes(marker));
});

test('paraphrased temporal question across sessions loses the hidden fifth source', async t => {
  const { targetSource, recalled, packed, frames } = await scenario(t, { queryMode: 'paraphrase' });
  assert.ok(targetSource.includes('whistle event at dawn'));
  assert.equal(frames.select.length, 1);
  assert.equal(frames.rank.length, 0);
  assert.equal(recalled.memories.length, 0);
  assert.equal(answerText(packed), '');
});

test('unknown question stays unknown without matching visible evidence', async t => {
  const { recalled, packed } = await scenario(t, { queryMode: 'unknown' });
  assert.equal(recalled.memories.length, 0);
  assert.equal(answerText(packed), '');
});

test('completed indexed capture catalogs both windows but retains only selected source', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-indexed-coverage-' });
  const path = join(workspace.path, 'store.sqlite');
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [{ content: 'Copper garden note', kind: 'context',
      confidence: 0.8, sourceIndices: [0] }] }),
    classify: ({ input }) => ({ items: input.memories.map(memory =>
      ({ memoryId: memory.id, parentIds: [] })) }),
    select: () => assert.fail('one complete map must not call select'),
    rank: ({ input }) => ({ refs: input.candidates
      .filter(candidate => candidate.receipts.some(receipt =>
        visibleScore(input.query)(receipt.excerpt)))
      .map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
        memoryId: candidate.memory.id, revision: candidate.memory.revision })) }),
  };
  let core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core.close());
  const source = ['Copper garden was mapped on Tuesday.', 'Silver lighthouse flashed at dusk.'];
  const capture = value(await core.capture({ namespace, client: INGESTION_CLIENT,
    sessionId: 'one-session', eventId: 'two-source-batch',
    messages: source.map((content, index) => ({ id: `message-${index}`, role: 'user', content })) }));
  assert.equal(capture.sourceWindowCatalog.messageCount, 2);
  assert.equal(capture.sourceWindowCatalog.windowCount, 2);
  assert.equal(capture.admission.memories.length, 1);
  const memoryId = capture.admission.memories[0].id;
  core.close();
  core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  const retained = value(core.get({ namespace, memoryId }));
  assert.deepEqual(retained.receipts.map(receipt => receipt.excerpt), [source[0]]);
  const known = value(await core.recall({ readSet: [namespace], query: 'Copper',
    limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  assert.deepEqual(known.memories[0].receipts.map(receipt => receipt.excerpt), [source[0]]);
  const missing = value(await core.recall({ readSet: [namespace], query: 'lighthouse',
    limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  assert.deepEqual(missing.memories, []);
  assert.equal(missing.coverage, 'complete');
});

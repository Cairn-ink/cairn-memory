// Synthetic diagnostic seams only; never imports operational data or credentials.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAIModel, countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { ingestIndexedEvidenceLongMemEvalCase } from '../ingestion.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { fakeMixedHttp, sourceRow } from './mixed-fixture.mjs';

export const USER_MARKER = 'SYNTHETIC_USER_ASIDE_KESTONE';
export const ASSISTANT_MARKER = 'SYNTHETIC_ASSISTANT_PROSE';
export const TARGET_MARKER = 'SYNTHETIC_RECALL_TARGET';
const namespace = { ownerId: 'evidence-gap-synthetic', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
const mapRef = (item, namespaceIndex = 0) => item.type === 'unfiled'
  ? { namespaceIndex, ...item.ref } : item.type === 'ref' && item.ref.childType === 'memory'
    ? { namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const response = (body, output) => Response.json({ object: 'response', model: body.model,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });

export async function writeEvidenceProbe(includeUser, assertCoverage = false) {
  const row = sourceRow('synthetic_evidence_gap');
  row.question.text = 'Synthetic question kept outside ingestion.';
  row.history.sessions[0].turns = [
    { turn_id: `lme-turn-${'c'.repeat(64)}`, role: 'user', content: `A short aside: ${USER_MARKER}.` },
    { turn_id: `lme-turn-${'d'.repeat(64)}`, role: 'assistant',
      content: `${ASSISTANT_MARKER}. ${'Verbose synthetic assistant explanation. '.repeat(30)}` },
  ];
  const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
  const wire = [], wireBytes = [], outputs = [];
  const fake = fakeMixedHttp((url, body) => {
    if (!url.endsWith('/responses') || body.text?.format.name !== 'cairn_extract') return;
    const input = JSON.parse(body.input[0].content[0].text);
    wire.push(input);
    wireBytes.push(body.input[0].content[0].text);
    const refs = role => input.messages.filter(message => message.role === role).map(message => message.index);
    const items = [{ content: 'Synthetic assistant interpretation', kind: 'context', confidence: 0.9,
      sourceIndices: refs('assistant') }];
    if (includeUser) items.push({ content: 'Synthetic user interpretation', kind: 'fact', confidence: 0.9,
      sourceIndices: refs('user') });
    outputs.push(items);
    return response(body, { items });
  }, { cairnMemory: true });
  let core;
  const workspace = createTestWorkspace(null, { prefix: 'cairn-evidence-write-' });
  try {
    workspace.defer(() => core?.close());
    const filename = join(workspace.path, 'store.sqlite');
    core = openMemoryCore({ path: filename, captureSourcePolicy: 'indexed-evidence-v1',
      model: createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: fake.fetchImpl }) });
    // Do not pass row.question or an evaluator/reference to ingestion.
    const ingestion = await ingestIndexedEvidenceLongMemEvalCase({ history: plan.renderedHistory,
      namespace: row.namespace, capture: input => {
        assert.deepEqual(Object.keys(input).sort(), ['client', 'eventId', 'messages', 'namespace', 'sessionId']);
        return core.capture(input);
      } });
    core.close();
    const coldModel = { countTokens: countOpenAITokens };
    for (const method of ['extract', 'classify', 'select', 'rank']) {
      Object.defineProperty(coldModel, method, { get() { assert.fail('cold source read must not interpret'); } });
    }
    core = openMemoryCore({ path: filename, captureSourcePolicy: 'indexed-evidence-v1',
      model: coldModel });
    const snapshot = ok(core.sourceSnapshot({ readSet: [row.namespace], limit: 6 }));
    const receipts = snapshot.memories.flatMap(memory => memory.receipts);
    const result = { input: row.history, planned: plan.cairnPlan.batches, wire, wireBytes, outputs,
      outcomes: ingestion.outcomes.map(outcome => outcome.status),
      catalogs: ingestion.outcomes.map(outcome => outcome.result.sourceWindowCatalog),
      userRetained: receipts.some(receipt => receipt.excerpt.includes(USER_MARKER)),
      assistantRetained: receipts.some(receipt => receipt.excerpt.includes(ASSISTANT_MARKER)) };
    assert.deepEqual(result.outcomes, ['completed'], 'coverage diagnosis requires completed capture');
    assert.equal(result.assistantRetained, true);
    assert.ok(wire[0].messages.some(message => message.role === 'user' && message.content.includes(USER_MARKER)));
    if (assertCoverage) assert.equal(result.userRetained, true, 'synthetic user source must survive cold admitted-source read');
    return result;
  } finally {
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, 'owned write workspace removed, including assertion failure');
  }
}

export async function recallEvidenceProbe(mode, assertCoverage = false) {
  assert(['beyond', 'select-omit', 'rank-drop', 'include'].includes(mode));
  const trace = { stored: [], enumerated: [], mapPackingTrials: [], selectInput: [], selectOutput: [], rankInput: [], rankOutput: [], final: [] };
  const marker = value => JSON.stringify(value).includes(TARGET_MARKER);
  let target;
  const model = { contextWindow: 8192,
    countTokens(text) {
      const tokens = countOpenAITokens(text);
      // Observe actual core map envelopes measured while choosing a page size;
      // these are not a claim to observe the private physical keyset scan.
      try {
        const envelope = JSON.parse(text);
        if (envelope.ok === true && Array.isArray(envelope.value?.items)) {
          const ids = envelope.value.items.map(item => mapRef(item)?.memoryId).filter(Boolean);
          if (ids.length) trace.mapPackingTrials.push({ ids, tokens });
        }
      } catch { /* Non-JSON model text is still counted with the real tokenizer. */ }
      return tokens;
    },
    select({ input }) {
      const refs = input.maps.flatMap(page => page.items.map(item => mapRef(item, page.namespaceIndex)).filter(Boolean));
      trace.selectInput.push({ ids: refs.map(ref => ref.memoryId), targetMarker: marker(input) });
      const chosen = refs.find(ref => ref.memoryId === target);
      const output = { refs: mode === 'select-omit' || !chosen ? [] : [chosen] };
      trace.selectOutput.push(output.refs.map(ref => ref.memoryId));
      return output;
    },
    rank({ input }) {
      trace.rankInput.push({ ids: input.candidates.map(candidate => candidate.memory.id), targetMarker: marker(input) });
      const output = { refs: mode === 'rank-drop' ? [] : input.candidates.slice(0, input.limit).map(candidate => ({
        namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
      trace.rankOutput.push(output.refs.map(ref => ref.memoryId));
      return output;
    } };
  let core;
  const workspace = createTestWorkspace(null, { prefix: 'cairn-evidence-recall-' });
  try {
    workspace.defer(() => core?.close());
    core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), model,
      captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1' });
    for (let index = 0; index < 217; index++) {
      // Query overlap, not generated UUID order, fixes the target's position.
      const content = index === 216
        ? `${mode === 'beyond' ? 'unrelated' : 'fixture sentinel'} ${TARGET_MARKER}`
        : `fixture distractor ${index.toString().padStart(3, '0')} ${'bounded prose '.repeat(8)}`;
      const memory = ok(core.admit({ namespace, memory: { content, kind: 'context' },
        receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: `source-${index}`,
          role: 'user', excerpt: content }] })).memory;
      trace.stored.push(memory.id);
      if (index === 216) target = memory.id;
    }
    // Independent public stored-set enumeration, NOT private recall query order.
    let cursor;
    do {
      const page = ok(core.list({ namespace, limit: 100, ...(cursor ? { cursor } : {}) }));
      trace.enumerated.push(...page.memories.map(memory => memory.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    const storedTarget = ok(core.get({ namespace, memoryId: target }));
    assert.equal(marker(storedTarget.receipts), true, 'target marker is independently read from stored receipts');
    const recalled = ok(await core.recall({ readSet: [namespace], query: 'fixture sentinel', limit: 6,
      contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
    trace.final = recalled.memories.map(memory => memory.memory.id);
    const packed = packMixedAnswer({ question: { text: 'Synthetic fixture query', date: '2024-01-02' },
      units: recalled.memories.map(memory => ({ text: memory.receipts.map(receipt => receipt.excerpt).join('\n') })),
      countTokens: countOpenAITokens });
    const result = { target, trace, storedTargetMarker: marker(storedTarget.receipts),
      contextHasTarget: marker(packed.request), omittedIndices: packed.omittedIndices,
      coverage: recalled.coverage, selection: recalled.selection };
    if (assertCoverage) assert.equal(result.contextHasTarget, true, 'synthetic stored source must survive recall and packing');
    return result;
  } finally {
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, 'owned recall workspace removed, including assertion failure');
  }
}

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTemporalRationaleModel } from '../rationale-temporal-model.mjs';

const baseline = readFileSync(new URL('../../../core/prompts/relate-rationale.md', import.meta.url), 'utf8');
const guidance = readFileSync(new URL('../prompts/rationale-temporal-guidance.md', import.meta.url), 'utf8');
const input = () => ({ memories: [{ index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'Synthetic source.' }] }] });
const request = (changes = {}) => ({ system: baseline, input: input(), maxOutputTokens: 1024,
  signal: new AbortController().signal, ...changes });
const code = expected => ({ code: expected });

test('TC1/TC2 only relate receives the exact appended, recounted source-only request', async () => {
  const seen = [], counts = [];
  const raw = { edges: [{ from: 0, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] };
  const rank = () => 'unchanged';
  const model = { contextWindow: 8192, rank, countTokens(text) { counts.push(text); return 1; },
    relate(next) { seen.push(next); return raw; } };
  const wrapped = createTemporalRationaleModel(model);
  assert.equal(wrapped.rank, rank);
  assert.equal(wrapped.contextWindow, model.contextWindow);
  const original = request();
  assert.strictEqual(await wrapped.relate(original), raw);
  assert.equal(seen.length, 1);
  assert.equal(counts.length, 1);
  assert.equal(counts[0], JSON.stringify({ system: `${baseline}\n${guidance}`, input: original.input,
    maxOutputTokens: 1024 }));
  assert.equal(seen[0].system, `${baseline}\n${guidance}`);
  assert.deepEqual(seen[0].input, original.input);
  assert.equal(seen[0].maxOutputTokens, 1024);
  assert.strictEqual(seen[0].signal, original.signal);
  assert.equal(original.system, baseline);
});

test('TC1 rejects unrelated system text, focus mode and changed output ceiling', async () => {
  let called = 0;
  const wrapped = createTemporalRationaleModel({ contextWindow: 8192, countTokens: () => 1,
    relate: () => { called++; return { edges: [] }; } });
  for (const bad of [request({ system: `${baseline}\nother task` }),
    request({ input: { memories: [{ ...input().memories[0], focus: { content: 'extra' } }] } }),
    request({ maxOutputTokens: 2048 })]) {
    await assert.rejects(wrapped.relate(bad), code('invalid_input'));
  }
  assert.equal(called, 0);
});

test('TC2 modified request overflow and counter failures stop before provider', async () => {
  for (const [counter, expected] of [[() => 6001, 'context_budget_exceeded'],
    [() => NaN, 'token_count_unavailable'], [() => { throw new Error('offline counter'); }, 'token_count_unavailable']]) {
    let called = 0;
    const wrapped = createTemporalRationaleModel({ contextWindow: 8192, countTokens: counter,
      relate: () => { called++; return { edges: [] }; } });
    await assert.rejects(wrapped.relate(request()), code(expected));
    assert.equal(called, 0);
  }
  assert.throws(() => createTemporalRationaleModel({ contextWindow: 8191, countTokens: () => 1,
    relate: () => ({ edges: [] }) }), code('context_budget_exceeded'));
});

test('TC2 callback mutation cannot change counted input or bound provider; raw wrong and empty output pass through', async () => {
  const original = request();
  const raw = { edges: [{ from: 99, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] };
  let calls = 0;
  const model = { contextWindow: 8192,
    countTokens: () => { original.input.memories[0].receipts[0].excerpt = 'changed after snapshot';
      model.relate = () => assert.fail('mutated provider callback'); return 1; },
    relate: ({ input: sent }) => { calls++; assert.equal(sent.memories[0].receipts[0].excerpt, 'Synthetic source.'); return raw; } };
  const wrapped = createTemporalRationaleModel(model);
  assert.strictEqual(await wrapped.relate(original), raw);
  assert.equal(calls, 1);
  const empty = { edges: [] };
  assert.strictEqual(await createTemporalRationaleModel({ contextWindow: 8192,
    countTokens: () => 1, relate: () => empty }).relate(request()), empty);
});

test('TC2 pre-count, post-count and post-provider cancellation reject without retry', async () => {
  let calls = 0;
  const first = new AbortController(); first.abort();
  const model = { contextWindow: 8192, countTokens: () => 1,
    relate: () => { calls++; return { edges: [] }; } };
  await assert.rejects(createTemporalRationaleModel(model).relate(request({ signal: first.signal })),
    { name: 'AbortError' });
  assert.equal(calls, 0);
  const second = new AbortController();
  const counted = createTemporalRationaleModel({ ...model, countTokens: () => { second.abort(); return 1; } });
  await assert.rejects(counted.relate(request({ signal: second.signal })), { name: 'AbortError' });
  assert.equal(calls, 0);
  const replacedSignal = new AbortController();
  const mutable = request({ signal: replacedSignal.signal });
  const guarded = createTemporalRationaleModel({ ...model, countTokens: () => {
    replacedSignal.abort(); mutable.signal = new AbortController().signal; return 1;
  } });
  await assert.rejects(guarded.relate(mutable), { name: 'AbortError' });
  assert.equal(calls, 0);
  const third = new AbortController();
  const returned = createTemporalRationaleModel({ ...model,
    relate: () => { calls++; third.abort(); return { edges: [] }; } });
  await assert.rejects(returned.relate(request({ signal: third.signal })), { name: 'AbortError' });
  assert.equal(calls, 1);
  const failed = createTemporalRationaleModel({ ...model,
    relate: () => { calls++; throw new Error('synthetic provider failure'); } });
  await assert.rejects(failed.relate(request()), /synthetic provider failure/);
  assert.equal(calls, 2);
});

test('TC4 real core replacement retains source guards and cold persistence with scripted relation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-temporal-model-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'synthetic.sqlite');
  const namespace = { ownerId: 'temporal-test', scope: 'personal', projectId: null };
  let edges = [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }];
  let calls = 0;
  const model = createTemporalRationaleModel({ contextWindow: 8192, countTokens: () => 1,
    relate: () => { calls++; return { edges }; } });
  const core = openMemoryCore({ path, model });
  const admit = (eventId, text) => {
    const result = core.admit({ namespace, memory: { content: text, kind: 'context' },
      receipts: [{ client: 'synthetic', sessionId: 'temporal', eventId, role: 'user', excerpt: text }] });
    assert.equal(result.ok, true); return result.value.memory;
  };
  const decisionText = 'I chose Tool Q because its search supports my work.';
  const decision = admit('choice', decisionText);
  const premise = admit('search', 'Tool Q search worked in my test.');
  const refs = [decision, premise].map(memory => ({ memoryId: memory.id, revision: memory.revision }));
  let warm;
  try {
    const first = await core.reviewRationale({ namespace, refs });
    assert.equal(first.ok, true); assert.equal(first.value.inserted, 1);
    edges = [];
    const replaced = await core.reviewRationale({ namespace, refs, writeMode: 'replace-reviewed' });
    assert.equal(replaced.ok, true); assert.equal(replaced.value.removed, 1);
    edges = [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }];
    const restored = await core.reviewRationale({ namespace, refs, writeMode: 'replace-reviewed' });
    assert.equal(restored.ok, true); assert.equal(restored.value.inserted, 1);
    edges = [{ from: 99, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }];
    const malformed = await core.reviewRationale({ namespace, refs, writeMode: 'replace-reviewed' });
    assert.equal(malformed.ok, false); assert.equal(malformed.error.code, 'invalid_model_output');
    assert.equal(calls, 4);
    warm = core.getRationale({ namespace, ...refs[0] });
    assert.equal(warm.ok, true); assert.equal(warm.value.edges.length, 1);
    assert.equal(warm.value.edges[0].from, premise.id);
    assert.equal(core.getRationale({ namespace, memoryId: refs[0].memoryId,
      revision: refs[0].revision + 1 }).error.code, 'revision_conflict');
    const source = core.get({ namespace, memoryId: decision.id });
    assert.equal(source.ok, true); assert.equal(source.value.receipts[0].excerpt, decisionText);
  } finally { core.close(); }
  const cold = openMemoryCore({ path });
  try {
    const result = cold.getRationale({ namespace, ...refs[0] });
    assert.deepEqual(result, warm);
    assert.equal(cold.get({ namespace, memoryId: decision.id }).value.receipts[0].excerpt, decisionText);
    const correctedText = 'I chose Tool R for a different source-backed reason.';
    const corrected = cold.correct({ namespace, memoryId: decision.id, expectedRevision: refs[0].revision,
      content: correctedText, kind: 'context', receipt: { client: 'synthetic', sessionId: 'temporal',
        eventId: 'corrected', role: 'user', excerpt: correctedText } });
    assert.equal(corrected.ok, true);
    assert.equal(cold.getRationale({ namespace, ...refs[0] }).error.code, 'revision_conflict');
  } finally { cold.close(); }
});

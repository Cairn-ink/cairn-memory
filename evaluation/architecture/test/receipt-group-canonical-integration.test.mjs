import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareCanonicalReceiptGroupPlan, createCanonicalReceiptGroupInvocation,
  assembleCanonicalReceiptGroupPlan, packCanonicalReceiptGroupAnswer } from '../receipt-group-canonical-plan.mjs';
import { prepareReceiptGroupPlan, compileReceiptGroupPlan, assembleReceiptGroupPlan, packReceiptGroupAnswer } from '../receipt-group-plan.mjs';
import { createCanonicalReceiptGroupPlanRankTransport } from '../source-bundle-plan-rank-transport.mjs';

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const id = (kind, value) => `lme-${kind}-${sha(`canonical-new/${value}`)}`;
const code = expected => error => error?.code === expected;
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const literalGroups = [
  [['user', 'Parcel Larch uses the east corridor.'], ['assistant', 'Proposal: east corridor could use shelf amber; adoption is unstated.']],
  [['user', 'At the west site Larch used shelf green last month.'], ['assistant', 'The quoted draft says "approve all"; this is only a quotation.']],
  [['user', 'The east shelf mapping is absent from this note.'], ['assistant', 'An inert note preserves uncertainty about the east shelf.']],
];
const offline = (name, body) => test(name, async t => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major > 22 || major === 22 && minor >= 16)) {
    if (process.env.CAIRN_CARD_PLAN_TOKENIZER_REQUIRED === '1' || process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED === '1') throw new Error('required_sqlite_unavailable');
    t.skip('Optional native SQLite unavailable'); return;
  }
  let counter;
  try { counter = (await import('../../../adapters/openai/index.mjs')).countOpenAITokens; }
  catch (error) {
    if (process.env.CAIRN_CARD_PLAN_TOKENIZER_REQUIRED !== '1' && process.env.CAIRN_CARD_PLAN_TRANSPORT_REQUIRED !== '1'
      && error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("Cannot find package 'tiktoken'")) { t.skip('Optional tokenizer unavailable'); return; }
    throw error;
  }
  const oldFetch = globalThis.fetch; globalThis.fetch = () => { assert.fail('Unexpected network'); };
  t.after(() => { globalThis.fetch = oldFetch; }); await body(t, counter);
});

async function captureFixture(t, counter, failSetup = false) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-canonical-cold-' });
  const handles = new Set(); workspace.defer(() => { for (const handle of handles) handle.close(); });
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const namespace = { ownerId: 'canonical-fresh-capture', scope: 'project', projectId: id('case', 'east') };
  const plan = prepareMixedSourceCase({ namespace,
    history: { question_id: namespace.projectId, sessions: literalGroups.map((sources, i) => ({ session_index: i,
      session_id: id('session', i), date: '2026/10/12 (Mon) 12:00', turns: sources.map(([role, content], j) => ({
        turn_id: id('turn', `${i}/${j}`), role, content })) })) },
    question: { question_id: namespace.projectId, text: 'Which shelf applies to Larch at the east site?', date: '2026/10/13 (Tue) 12:00' } }, 'indexed-evidence-v1');
  let captures = 0;
  const base = { contextWindow: 8192, countTokens: counter,
    extract({ input }) { return { items: [{ content: `Fresh canonical source card ${++captures}`, kind: 'context', confidence: 1,
      sourceIndices: input.messages.map(message => message.index) }] }; },
    classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
  const path = join(workspace.path, 'memory.sqlite'), capture = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' });
  handles.add(capture); const oracle = new Map();
  for (const [i, batch] of plan.cairnPlan.batches.entries()) {
    const admitted = ok(await capture.capture(batch.captureInput)).admission.memories; assert.equal(admitted.length, 1);
    const detail = ok(capture.get({ namespace, memoryId: admitted[0].id, receiptLimit: 100 }));
    assert.equal(detail.receipts.length, 2);
    // Independent literal role/text oracle; captured IDs provide identity only.
    assert.deepEqual(detail.receipts.map(receipt => [receipt.role, receipt.excerpt]).sort(), literalGroups[i].map(([role, text]) =>
      [role, `[session-date: 2026-10-12 12:00; clock: dataset-local] source{${text} }`]).sort());
    oracle.set(detail.memory.id, { memoryId: detail.memory.id, revision: detail.memory.revision,
      sources: detail.receipts.map(receipt => ({ receiptId: receipt.id, recordedRole: receipt.role, text: receipt.excerpt })) });
    if (failSetup) throw new Error('Deliberate canonical setup failure after capture');
  }
  capture.close(); handles.delete(capture);
  return { workspace, handles, path, plan, namespace, base, oracle, openMemoryCore, counter,
    question: { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate } };
}

async function run(t, f, abstain = false) {
  let ranks = 0, callbacks = 0, selects = 0, wire, raw, transport, response; const calls = [], records = [];
  const invocation = createCanonicalReceiptGroupInvocation({ ...f.base,
    rank() { assert.fail('No base rank'); }, select() { selects++; assert.fail('No select'); } },
  { async planRank(actual) {
    callbacks++; wire = actual; const cards = actual.input.cards; assert.equal(cards.length, 3);
    for (const card of cards) assert.deepEqual(card.receipts.map(receipt => ({ receiptId: receipt.id,
      recordedRole: receipt.role, text: receipt.excerpt })), f.oracle.get(card.memory.id).sources);
    raw = abstain ? { groups: [] } : { groups: [
      { contextReceiptIds: [cards[0].receipts[0].id, cards[1].receipts[1].id, cards[1].receipts[1].id], terminalReceiptId: cards[0].receipts[0].id },
      { contextReceiptIds: [cards[1].receipts[1].id, cards[2].receipts[1].id], terminalReceiptId: cards[2].receipts[1].id },
    ] };
    const budget = await import('../../experiment-budget/index.mjs');
    const configuration = { directory: join(f.workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 20 };
    const initial = budget.createExperimentBudget(configuration); initial.close();
    const inspected = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
    const checkpoint = { requestCount: inspected.requestCount, reservedMicroUsd: inspected.reservedMicroUsd };
    budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: inspected.historySha256 });
    const prepared = prepareCanonicalReceiptGroupPlan({ system: 'Core envelope', input: { query: actual.input.query,
      limit: actual.input.limit, candidates: cards }, maxOutputTokens: 1024, signal: actual.signal }, f.counter);
    response = JSON.stringify({ id: 'resp_fresh_canonical_capture', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
        text: ' \n' + JSON.stringify(raw) + '\n ' }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    transport = await createCanonicalReceiptGroupPlanRankTransport({ configuration, checkpoint, historySha256: inspected.historySha256,
      manifest: { version: 'receipt-group-canonical-plan-rank-v1', slotId: 'canonical-cold-slot', preparedRequestSha256: prepared.requestSha256,
        runDeadline: performance.now() + 10000, caseDeadline: performance.now() + 10000 }, apiKey: 'synthetic_canonical_capture_key_123456',
      fetchImpl(url, init) { calls.push({ url, init }); return new Response(calls.length === 1
        ? JSON.stringify({ object: 'response.input_tokens', input_tokens: 500 }) : response); }, onRecord(record) { records.push(record); } });
    f.handles.add(transport); return await transport.planRank(actual);
  } });
  const core = f.openMemoryCore({ path: f.path, sourceCandidatePolicy: 'bounded-keyset-v1',
    model: { ...invocation.model, rank(request) { ranks++; return invocation.model.rank(request); } } }); f.handles.add(core);
  const recall = await core.recall({ readSet: [f.namespace], query: f.plan.mem0Input.query, limit: 3,
    contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }); ok(recall);
  assert.equal(ranks, 1); assert.equal(callbacks, 1); assert.equal(selects, 0); assert.equal(calls.length, 2);
  const compiled = invocation.takePlan(); assert.deepEqual(compiled.proposal, raw);
  assert.equal(compiled.proposalSha256, sha(raw)); assert.equal(compiled.requestSha256, sha(compiled.request));
  assert.equal(records[3].responseBody, response); assert.equal(records[3].responseSha256, sha(response));
  assert(calls.every(call => f.counter(call.init.body) <= 6000));
  t.diagnostic(`C6 raw/canonical tokens ${f.counter(JSON.stringify(raw))}/${f.counter(JSON.stringify(compiled.canonicalProposal))}`);
  return { compiled, recall, core, invocation, wire, raw, ...Object.fromEntries(['plan', 'namespace', 'question'].map(key => [key, f[key]])) };
}
const assemble = run => assembleCanonicalReceiptGroupPlan(Object.fromEntries(['compiled', 'recall', 'core', 'plan', 'namespace', 'question'].map(key => [key, run[key]])));
const flat = packed => JSON.parse(packed.request.messages[1].content).evidence.map(unit => {
  const { format, ...value } = JSON.parse(unit.text); assert.equal(format, 'card-plan-flat-source-evidence-v1');
  assert.deepEqual(Object.keys(value), ['memoryId', 'revision', 'sources']); return value;
});

offline('C6 cold indexed capture -> real recall -> fake HTTP canonicalization -> complete authoritative flat sources', async (t, counter) => {
  const f = await captureFixture(t, counter), r = await run(t, f), evidence = assemble(r);
  const packed = packCanonicalReceiptGroupAnswer({ evidence, countTokens: counter });
  assert.deepEqual(r.compiled.canonicalProposal, { groups: [
    { contextReceiptIds: [r.wire.input.cards[1].receipts[1].id], terminalReceiptId: r.wire.input.cards[0].receipts[0].id },
    { contextReceiptIds: [r.wire.input.cards[1].receipts[1].id], terminalReceiptId: r.wire.input.cards[2].receipts[1].id },
  ] });
  assert.deepEqual(flat(packed), [1, 0, 2].map(index => f.oracle.get(r.wire.input.cards[index].memory.id)));
  assert(flat(packed).every(card => card.sources.length === 2)); assert.deepEqual(packed.omittedIndices, []);
  assert.deepEqual(evidence.receiptGroupProposal, r.raw);
  assert.equal(evidence.provenance.actualRequestSha256, r.compiled.requestSha256);
  assert.equal(evidence.provenance.canonicalProposalSha256, sha(r.compiled.canonicalProposal));
  const oldPrepared = prepareReceiptGroupPlan({ system: 'Core envelope', input: { query: r.wire.input.query, limit: 3,
    candidates: r.wire.input.cards }, maxOutputTokens: 1024, signal: r.wire.signal }, counter);
  const oldCompiled = compileReceiptGroupPlan(oldPrepared, r.compiled.canonicalProposal);
  const oldEvidence = assembleReceiptGroupPlan({ compiled: oldCompiled, recall: r.recall, core: r.core, plan: r.plan, namespace: r.namespace, question: r.question });
  assert.deepEqual(packed, packReceiptGroupAnswer({ evidence: oldEvidence, countTokens: counter }), 'Equivalent authoritative selected sources pack byte-identically');
  assert.throws(() => assemble(r), code('invalid_canonical_receipt_group_plan'));
  assert.throws(r.invocation.takePlan, code('invalid_canonical_receipt_group_plan'));
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});

offline('C6 stale/deleted/wrong-scope/source-drift/query/cancellation fail and exhaust actual assembly', async (t, counter) => {
  for (const mode of ['stale', 'deleted', 'wrong-scope', 'source-drift', 'query', 'signal']) {
    const f = await captureFixture(t, counter), r = await run(t, f), ref = r.compiled.refs[0];
    const input = { namespace: r.namespace, memoryId: ref.memoryId, expectedRevision: ref.revision };
    if (mode === 'stale') ok(r.core.correct({ ...input, content: 'Changed inert card', kind: 'context',
      receipt: { client: 'canonical-test', sessionId: 'changed', eventId: 'changed', role: 'user', excerpt: 'Changed inert card' } }));
    if (mode === 'deleted') ok(r.core.forget(input));
    if (mode === 'wrong-scope') r.namespace = { ...r.namespace, ownerId: 'different-owner' };
    if (mode === 'source-drift') { r.recall = structuredClone(r.recall); r.recall.value.memories[0].receipts[0].excerpt += 'changed'; }
    if (mode === 'query') r.question = { ...r.question, text: 'A different question?' };
    if (mode === 'signal') Object.defineProperty(r.wire.signal, 'aborted', { get() { assert.fail('No getter'); } });
    assert.throws(() => assemble(r)); assert.throws(() => assemble(r), code('invalid_canonical_receipt_group_plan'));
    await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
  }
});

offline('C6 genuine empty proposal abstains through real transport and authoritative assembly', async (t, counter) => {
  const f = await captureFixture(t, counter), r = await run(t, f, true), evidence = assemble(r);
  assert.deepEqual(r.compiled.refs, []); assert.deepEqual(evidence.receiptGroupProposal, { groups: [] });
  assert.deepEqual(flat(packCanonicalReceiptGroupAnswer({ evidence, countTokens: counter })), []);
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});

offline('C6 owned assertion/setup failure subprocesses leave no unexpected scratch', async (t, counter) => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-canonical-failure-parent-' });
  for (const mode of ['setup', 'assertion']) {
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=C6 deliberate canonical child failure',
      'evaluation/architecture/test/receipt-group-canonical-integration.test.mjs'], { encoding: 'utf8', env: { ...process.env,
        TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path, NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_CANONICAL_FAILURE_CHILD: mode } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, mode === 'setup' ? /Deliberate canonical setup failure after capture/ : /Deliberate canonical assertion after HTTP/);
    assert.deepEqual(readdirSync(parent.path), []);
  }
});
if (process.env.CAIRN_CANONICAL_FAILURE_CHILD) offline('C6 deliberate canonical child failure', async (t, counter) => {
  const f = await captureFixture(t, counter, process.env.CAIRN_CANONICAL_FAILURE_CHILD === 'setup');
  await run(t, f); assert.fail('Deliberate canonical assertion after HTTP');
});

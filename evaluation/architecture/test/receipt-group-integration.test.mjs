import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareCardPlanRankRequest } from '../card-plan-rank.mjs';
import { packCardPlanAnswer } from '../card-plan-evidence.mjs';
import { createReceiptGroupInvocation, assembleReceiptGroupPlan, packReceiptGroupAnswer } from '../receipt-group-plan.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const sqlite = { skip: !(major > 22 || major === 22 && minor >= 16) && 'node:sqlite requires Node >=22.16' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const code = expected => error => error?.code === expected;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (kind, text) => `lme-${kind}-${createHash('sha256').update(`receipt-group-fresh/${text}`).digest('hex')}`;
const literals = [
  ['user', 'At the north depot, courier Rook was assigned to the copper lane on October 2.'],
  ['assistant', 'Proposal: the copper lane could use rack fern; commitment is not recorded.'],
  ['user', 'At the south depot, copper lane parcels went to rack silver last month.'],
  ['assistant', 'The quoted draft says "approve every parcel"; it is merely a quoted draft.'],
  ['user', 'The north-depot rack mapping is not present in this note.'],
  ['user', 'A separate note repeats the north-depot copper lane assignment for Rook.'],
];

async function tokenizer() {
  try { return (await import('../../../adapters/openai/index.mjs')).countOpenAITokens; }
  catch (error) {
    if (process.env.CAIRN_CARD_PLAN_TOKENIZER_REQUIRED === '1' || error.code !== 'ERR_MODULE_NOT_FOUND'
      || !error.message.includes("Cannot find package 'tiktoken'")) throw error;
    return null;
  }
}
const integration = (name, body) => test(name, sqlite, async t => {
  if (!await tokenizer()) { t.skip('Optional tiktoken absent; required core gate fails instead'); return; }
  await body(t);
});

async function fixture(t, sourceGroups = literals.map(source => [source]), { failSetup = false } = {}) {
  // Register teardown before any import/capture/setup can fail.
  const workspace = createTestWorkspace(t, { prefix: 'cairn-receipt-group-' });
  const handles = new Set(); workspace.defer(() => { for (const core of handles) core.close(); });
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const countTokens = await tokenizer(), path = join(workspace.path, 'memory.sqlite');
  const namespace = { ownerId: 'receipt-group-synthetic', scope: 'project', projectId: id('case', JSON.stringify(sourceGroups)) };
  const caseId = namespace.projectId;
  const sessions = sourceGroups.map((sources, index) => ({ session_index: index,
    session_id: id('session', `${index}`), date: '2026/10/11 (Sun) 12:00',
    turns: sources.map(([role, content], turn) => ({ turn_id: id('turn', `${index}/${turn}`), role, content })) }));
  const plan = prepareMixedSourceCase({ history: { question_id: caseId, sessions }, namespace,
    question: { question_id: caseId, text: 'Which rack applies to Rook at the north depot?',
      date: '2026/10/13 (Tue) 12:00' } }, 'indexed-evidence-v1');
  const question = { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate };
  let captures = 0;
  const base = { contextWindow: 8192, countTokens,
    extract({ input }) {
      const content = `Inert parcel card ${++captures}`;
      // Ordinary capture accepts at most four source endpoints per item. Two
      // exact same-content items use normal admission dedup to retain six
      // receipts on one card without changing the capture limit.
      return { items: Array.from({ length: Math.ceil(input.messages.length / 4) }, (_, i) => ({ content,
        kind: 'context', confidence: 1, sourceIndices: input.messages.slice(i * 4, (i + 1) * 4).map(window => window.index) })) };
    },
    classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
  };
  const capture = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' }); handles.add(capture);
  const oracle = new Map();
  for (const [index, batch] of plan.cairnPlan.batches.entries()) {
    const admitted = ok(await capture.capture(batch.captureInput)).admission.memories;
    assert.equal(admitted.length, 1, 'Normal same-content admission dedup produces exactly one whole card');
    const memory = admitted[0];
    assert(memory, 'Normal indexed capture admits the source-backed synthetic card');
    const detail = ok(capture.get({ namespace, memoryId: memory.id, receiptLimit: 100 }));
    assert.equal(detail.receipts.length, sourceGroups[index].length, 'Every literal endpoint retained on the one admitted card');
    assert.equal(new Set(detail.receipts.map(source => source.id)).size, sourceGroups[index].length,
      'All actual captured receipt identities are distinct, including the six-endpoint dedup fixture');
    // This literal source oracle is independent of rank, compiler and packer.
    assert.deepEqual(detail.receipts.map(source => [source.role, source.excerpt]).sort(),
      sourceGroups[index].map(([role, content]) => [role,
        `[session-date: 2026-10-11 12:00; clock: dataset-local] source{${content} }`]).sort());
    oracle.set(memory.id, { memoryId: memory.id, revision: detail.memory.revision,
      sources: detail.receipts.map(source => ({ receiptId: source.id, recordedRole: source.role, text: source.excerpt })) });
    if (failSetup) throw new Error('Deliberate setup failure after actual capture');
  }
  capture.close(); handles.delete(capture);
  // The recall opens a cold handle after capture closed its SQLite connection.
  async function run({ makeProposal = cards => ({ groups: [...cards].reverse().map(card => ({
    contextReceiptIds: [], terminalReceiptId: card.receipts[0].id })) }), limit = 6 } = {}) {
    let calls = 0, ranks = 0, selects = 0, wire, raw, derivedRequest;
    const invocation = createReceiptGroupInvocation({ ...base,
      select() { selects++; assert.fail('Bounded source scan may not select'); },
      rank() { assert.fail('No base rank fallback'); },
    }, { planRank(actual) {
      calls++; wire = actual;
      assert.equal(actual.input.cards.length, sourceGroups.length);
      assert.deepEqual(actual.input.cards.map(card => card.receipts.map(source => source.id)).flat(),
        actual.outputSchema.properties.groups.items.properties.terminalReceiptId.enum);
      for (const card of actual.input.cards) {
        assert.equal(Object.hasOwn(card, 'candidateIndex'), false);
        assert.deepEqual(card.receipts.map(source => ({ receiptId: source.id, recordedRole: source.role, text: source.excerpt })),
          oracle.get(card.memory.id).sources);
      }
      // Independent genuine old-CP preparation for hash/token assertions only.
      // This derived request is never dispatched to the generation callback.
      derivedRequest = prepareCardPlanRankRequest({ system: 'Actual core source rank instruction',
        input: { query: actual.input.query, limit: actual.input.limit, candidates: actual.input.cards },
        maxOutputTokens: 1024, signal: actual.signal }, countTokens).request;
      raw = makeProposal(actual.input.cards); return raw;
    } });
    const model = { ...invocation.model, rank(request) { ranks++; return invocation.model.rank(request); } };
    const core = openMemoryCore({ path, model, sourceCandidatePolicy: 'bounded-keyset-v1' }); handles.add(core);
    const recall = await core.recall({ readSet: [namespace], query: plan.mem0Input.query, limit,
      contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
    assert.equal(calls, 1); assert.equal(ranks, 1); assert.equal(selects, 0);
    const compiled = recall.ok ? invocation.takePlan() : null;
    const actualRequest = wire && Object.fromEntries(Object.entries(wire).filter(([key]) => key !== 'signal'));
    const measurements = actualRequest && { actualRequest: countTokens(JSON.stringify(actualRequest)),
      actualProposal: countTokens(JSON.stringify(raw)), derivedAssemblyRequest: countTokens(JSON.stringify(derivedRequest)),
      ...(compiled ? { derivedAssemblyProposal: countTokens(JSON.stringify(compiled.diagnostics.derivedAssemblyProposal)),
        refs: countTokens(JSON.stringify({ refs: compiled.refs })) } : {}) };
    t.diagnostic(`RG8 local tokenizer counts ${JSON.stringify(measurements)}`);
    if (compiled) {
      assert.equal(compiled.requestSha256, sha(actualRequest)); assert.equal(compiled.proposalSha256, sha(raw));
      assert.equal(compiled.derivedAssemblyRequestSha256, sha(derivedRequest));
      assert.equal(compiled.diagnostics.derivedAssemblyProposalSha256, sha(compiled.diagnostics.derivedAssemblyProposal));
      assert(measurements.actualRequest <= 6000); assert(measurements.derivedAssemblyRequest <= 6000);
      assert(measurements.actualProposal <= 1024); assert(measurements.derivedAssemblyProposal <= 1024); assert(measurements.refs <= 1024);
    }
    return { compiled, recall, core, plan, namespace, question, wire, raw, measurements, invocation };
  }
  return { run, oracle, workspace, countTokens };
}
const assemble = run => assembleReceiptGroupPlan(Object.fromEntries(
  ['compiled', 'recall', 'core', 'plan', 'namespace', 'question'].map(name => [name, run[name]])));
const packedCards = packed => JSON.parse(packed.request.messages[1].content).evidence.map(unit => {
  const value = JSON.parse(unit.text);
  assert.deepEqual(Object.keys(value), ['format', 'memoryId', 'revision', 'sources']);
  assert.equal(value.format, 'card-plan-flat-source-evidence-v1');
  for (const source of value.sources) assert.deepEqual(Object.keys(source), ['receiptId', 'recordedRole', 'text']);
  return { memoryId: value.memoryId, revision: value.revision, sources: value.sources };
});

integration('RG8 cold SQLite capture/recall/new invocation/authoritative reread/complete flat packing', async t => {
  const f = await fixture(t), run = await f.run(); ok(run.recall);
  const evidence = assemble(run), packed = packReceiptGroupAnswer({ evidence, countTokens: f.countTokens });
  const expectedIds = run.wire.input.cards.map(card => card.memory.id).reverse();
  assert.deepEqual(packedCards(packed), expectedIds.map(id => f.oracle.get(id)));
  assert.equal(packedCards(packed).length, 6);
  assert.deepEqual(Object.keys(evidence), ['assemblyEvidence', 'provenance', 'receiptGroupProposal']);
  assert(Object.isFrozen(evidence)); assert(Object.isFrozen(evidence.provenance));
  assert.deepEqual(evidence.receiptGroupProposal, run.raw);
  assert.deepEqual(evidence.provenance, { origin: 'receipt-group-derived-card-assembly-v1',
    actualRequestSha256: run.compiled.requestSha256, actualProposalSha256: run.compiled.proposalSha256,
    derivedAssemblyRequestSha256: run.compiled.derivedAssemblyRequestSha256,
    derivedAssemblyProposalSha256: run.compiled.diagnostics.derivedAssemblyProposalSha256 });
  assert.equal(evidence.assemblyEvidence.requestSha256, run.compiled.derivedAssemblyRequestSha256);
  assert.deepEqual(evidence.assemblyEvidence.proposal, run.compiled.diagnostics.derivedAssemblyProposal);
  assert.notEqual(evidence.provenance.actualRequestSha256, evidence.assemblyEvidence.requestSha256);
  assert.deepEqual(packCardPlanAnswer({ evidence: evidence.assemblyEvidence, countTokens: f.countTokens }), packed);
  const { PUBLIC_ANSWER_INSTRUCTION } = await import('../../longmemeval/public-comparison.mjs');
  const { MIXED_ANSWER_MODEL, MIXED_ANSWER_OUTPUT_TOKENS } = await import('../../longmemeval/mixed-answer.mjs');
  assert.equal(packed.request.messages[0].content, PUBLIC_ANSWER_INSTRUCTION);
  assert.equal(packed.request.model, MIXED_ANSWER_MODEL); assert.equal(packed.request.max_tokens, MIXED_ANSWER_OUTPUT_TOKENS);
  assert.deepEqual(JSON.parse(packed.request.messages[1].content).currentQuestion, run.question);
  assert.equal(f.countTokens(JSON.stringify(packed.request)), packed.inputTokens); assert(packed.inputTokens <= 6000);
  assert.deepEqual(packed.omittedIndices, []); assert.deepEqual(packed.duplicateIndices, []);
  assert.throws(() => assemble(run), code('invalid_receipt_group_plan'));
  assert.throws(() => packReceiptGroupAnswer({ evidence: structuredClone(evidence), countTokens: f.countTokens }), code('invalid_card_plan_evidence'));
  assert.throws(() => packReceiptGroupAnswer({ evidence, countTokens: () => 6001 }), code('card_plan_answer_incomplete'));
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});

integration('RG8 candidate5/1/0/shared-context/represented-card terminal and whole multi-role cards', async t => {
  const f = await fixture(t, literals.map((source, i) => [source, ['assistant', `Inert second receipt on card ${i}.`]]));
  const run = await f.run({ makeProposal: cards => ({ groups: [
    { contextReceiptIds: [cards[5].receipts[1].id, cards[1].receipts[0].id], terminalReceiptId: cards[0].receipts[1].id },
    { contextReceiptIds: [cards[5].receipts[1].id, cards[0].receipts[0].id], terminalReceiptId: cards[5].receipts[0].id },
  ] }) }); ok(run.recall);
  const packed = packReceiptGroupAnswer({ evidence: assemble(run), countTokens: f.countTokens });
  const expectedIds = [5, 1, 0].map(i => run.wire.input.cards[i].memory.id);
  assert.deepEqual(packedCards(packed), expectedIds.map(id => f.oracle.get(id)));
  assert.equal(packedCards(packed).length, 3); assert(packedCards(packed).every(card => card.sources.length === 2));
  const multi = await fixture(t, [literals]);
  const six = await multi.run({ makeProposal: cards => ({ groups: [{ contextReceiptIds: cards[0].receipts.slice(0, 5).map(r => r.id),
    terminalReceiptId: cards[0].receipts[5].id }] }) }); ok(six.recall);
  assert.deepEqual(packedCards(packReceiptGroupAnswer({ evidence: assemble(six), countTokens: multi.countTokens })),
    [multi.oracle.get(six.wire.input.cards[0].memory.id)]);
  const copies = await fixture(t, [[literals[0]], [literals[0]]]), twin = await copies.run(); ok(twin.recall);
  const twins = packedCards(packReceiptGroupAnswer({ evidence: assemble(twin), countTokens: copies.countTokens }));
  assert.equal(twins.length, 2); assert.notEqual(twins[0].memoryId, twins[1].memoryId);
  assert.equal(twins[0].sources[0].text, twins[1].sources[0].text);
  const empty = await f.run({ makeProposal: () => ({ groups: [] }) }); ok(empty.recall);
  assert.deepEqual(packedCards(packReceiptGroupAnswer({ evidence: assemble(empty), countTokens: f.countTokens })), []);
});

integration('RG8 dense exact captured-ID groups obey measured real output budget without raising caps', async t => {
  const f = await fixture(t, [literals]);
  const run = await f.run({ makeProposal: cards => ({ groups: Array.from({ length: 6 }, () => ({
    contextReceiptIds: cards[0].receipts.slice(0, 5).map(receipt => receipt.id), terminalReceiptId: cards[0].receipts[5].id })) }) });
  // Captured UUIDs are intentionally opaque and their real token counts vary.
  // Budget fit and visible rejection are separate outcomes; no ID is shortened.
  if (run.measurements.actualProposal > 1024) {
    t.diagnostic('RG8 dense shape: actual-output-overflow rejected; not a budget-fit success');
    assert.equal(run.recall.ok, false); assert.equal(run.recall.error.code, 'invalid_model_output');
    assert.equal(run.compiled, null); assert.throws(run.invocation.takePlan, code('invalid_receipt_group_plan'));
  } else {
    t.diagnostic('RG8 dense shape: actual captured-ID output fits unchanged 1024-token cap');
    ok(run.recall);
    assert.deepEqual(packedCards(packReceiptGroupAnswer({ evidence: assemble(run), countTokens: f.countTokens })),
      [f.oracle.get(run.wire.input.cards[0].memory.id)]);
  }
});

integration('RG8 stale/deleted/altered/foreign/query/proxy/cloned controls consume failed assembly', async t => {
  const f = await fixture(t);
  const changes = [
    run => { run.recall = { ok: false, error: { code: 'inert-failure' } }; },
    run => { run.question = { ...run.question, text: 'A different synthetic question?' }; },
    run => { run.namespace = { ...run.namespace, ownerId: 'foreign-synthetic-owner' }; },
    run => { run.plan = structuredClone(run.plan); run.plan.mem0Input.query = 'Other source query'; },
    run => { run.plan = structuredClone(run.plan); run.plan.cairnPlan.batches[1].captureInput.namespace.ownerId = 'foreign'; },
    run => { run.recall = structuredClone(run.recall); run.recall.value.memories.reverse(); },
    run => { run.recall = structuredClone(run.recall); run.recall.value.memories[0].receipts[0].excerpt = 'Changed source bytes'; },
    run => { run.recall = structuredClone(run.recall); const receipt = run.recall.value.memories[0].receipts[0];
      receipt.role = receipt.role === 'user' ? 'assistant' : 'user'; },
    run => { run.recall = structuredClone(run.recall); run.recall.value.memories[0].receipts.pop(); },
    run => { run.plan = structuredClone(run.plan); run.plan.originMap.windows = []; },
    run => { run.plan = structuredClone(run.plan); const source = run.plan.cairnPlan.batches[0].sourceMap[0];
      source.role = source.role === 'user' ? 'assistant' : 'user'; },
  ];
  for (const change of changes) {
    const run = await f.run(); ok(run.recall); change(run);
    assert.throws(() => assemble(run)); assert.throws(() => assemble(run), code('invalid_receipt_group_plan'));
  }
  const clone = await f.run(); ok(clone.recall); clone.compiled = structuredClone(clone.compiled);
  assert.throws(() => assemble(clone), code('invalid_receipt_group_plan'));
  for (const action of ['correct', 'forget']) {
    const isolated = await fixture(t), run = await isolated.run(); ok(run.recall);
    const ref = run.compiled.refs[0], input = { namespace: run.namespace, memoryId: ref.memoryId, expectedRevision: ref.revision };
    ok(action === 'forget' ? run.core.forget(input) : run.core.correct({ ...input, content: 'Changed assertion', kind: 'context',
      receipt: { client: 'inert-receipt-group', sessionId: 'changed', eventId: 'changed', role: 'user', excerpt: 'Changed assertion' } }));
    assert.throws(() => assemble(run), code('invalid_recall_provenance'));
    assert.throws(() => assemble(run), code('invalid_receipt_group_plan'));
  }
  let hooks = 0;
  const proxy = await f.run(); ok(proxy.recall);
  proxy.recall = new Proxy(proxy.recall, { ownKeys() { hooks++; throw new Error('Untrusted recall hook'); } });
  assert.throws(() => assemble(proxy), code('invalid_card_plan_evidence'));
  assert.throws(() => assemble(proxy), code('invalid_receipt_group_plan')); assert.equal(hooks, 0);
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});

integration('RG8 owned assertion and setup failure child cleanup has zero residue', async t => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-receipt-group-parent-' });
  for (const mode of ['assertion', 'setup']) {
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=RG8 deliberate owned child failure',
      'evaluation/architecture/test/receipt-group-integration.test.mjs'], { encoding: 'utf8',
      env: { ...process.env, TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path,
        NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_RECEIPT_GROUP_FAILURE_CHILD: mode } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, mode === 'setup' ? /Deliberate setup failure after actual capture/
      : /Deliberate assertion after actual captured workspace/);
    assert.deepEqual(readdirSync(parent.path), [], `${mode} child runner and fixture scratch removed`);
  }
  await parent.cleanup(); assert.equal(existsSync(parent.path), false);
});

if (process.env.CAIRN_RECEIPT_GROUP_FAILURE_CHILD) integration('RG8 deliberate owned child failure', async t => {
  const f = await fixture(t, [[literals[0]]], { failSetup: process.env.CAIRN_RECEIPT_GROUP_FAILURE_CHILD === 'setup' });
  ok((await f.run()).recall);
  assert.fail('Deliberate assertion after actual captured workspace');
});

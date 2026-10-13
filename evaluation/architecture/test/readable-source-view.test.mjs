import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareCardPlanRankRequest, compileCardPlan } from '../card-plan-rank.mjs';
import { assembleCardPlanEvidence, packCardPlanAnswer } from '../card-plan-evidence.mjs';
import { packReadableCardPlanAnswer, decodeReadableSourceUnit } from '../readable-source-view.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const sqlite = { skip: !(major > 22 || major === 22 && minor >= 16) && 'node:sqlite requires Node >=22.16' };
const code = expected => error => error.code === expected;
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const digest = text => createHash('sha256').update(text).digest('hex');
const id = (kind, text) => `lme-${kind}-${digest(`readable-view-fresh-v1/${text}`)}`;
const header = 'card-plan-readable-source-v1\n';
const flatFormat = 'card-plan-flat-source-evidence-v1';

// Entirely new literals: preservation controls, never expected model answers.
const scenarios = [
  { name: 'neighboring-scope', groups: [
    [['user', 'Varden north annex permits crate storage only while the seal is intact.'],
      ['assistant', 'Quoted notice: Varden south annex has a separate storage permit; it does not cover the north annex.']],
    [['user', 'The north-annex visitor may inspect a crate but may not move it.']],
  ] },
  { name: 'replacement-nonreconfirmation', groups: [
    [['user', 'For Peloric kit seven, I adopted the padded case instead of the mesh case.'],
      ['assistant', 'The original premise was that the padded case stayed dry.']],
    [['user', 'That premise changed: the padded case is wet; I have NOT reconfirmed kit seven.'],
      ['assistant', 'A different kit uses a dry rigid case; that is not a replacement decision for kit seven.']],
  ] },
  { name: 'reconciled-unresolved-conflict', groups: [
    [['user', 'For Umberline counter A, the morning slips disagreed; the signed reconciliation fixes its closing time at noon.']],
    [['assistant', 'Counter B has incompatible closing-time slips, and no reconciliation is recorded.'],
      ['user', 'Do not apply counter A\'s reconciliation to counter B; its conflict is unresolved.']],
  ] },
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
  if (!await tokenizer()) { t.skip('Optional tiktoken absent; explicit required gate fails instead'); return; }
  await body(t);
});

async function fixture(t, scenario = scenarios[0], empty = false) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-readable-view-' });
  const handles = new Set();
  workspace.defer(() => { for (const core of handles) core.close(); });
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const countTokens = await tokenizer();
  const namespace = { ownerId: 'readable-view-source-only', scope: 'project', projectId: id('case', scenario.name) };
  const date = '2026/10/14 (Wed) 09:00', canonicalDate = '2026-10-14 09:00';
  const sessions = scenario.groups.map((group, index) => ({ session_index: index,
    session_id: id('session', `${scenario.name}/${index}`), date,
    turns: group.map(([role, content], turn) => ({ turn_id: id('turn', `${scenario.name}/${index}/${turn}`), role, content })) }));
  const plan = prepareMixedSourceCase({ history: { question_id: namespace.projectId, sessions }, namespace,
    question: { question_id: namespace.projectId, text: 'What applicability and uncertainty are recorded for the requested item?',
      date: '2026/10/15 (Thu) 09:00' } }, 'indexed-evidence-v1');
  const question = { text: plan.originalQuestion.text, date: plan.canonicalQuestionDate };
  let captured = 0;
  const base = { contextWindow: 8192, countTokens,
    extract({ input }) { return { items: [{ content: `Readable inert card ${++captured}`, kind: 'context', confidence: 1,
      sourceIndices: input.messages.map(source => source.index) }] }; },
    classify({ input }) { return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
  };
  const path = join(workspace.path, 'memory.sqlite'), oracle = new Map();
  const capture = openMemoryCore({ path, model: base, captureSourcePolicy: 'indexed-evidence-v1' }); handles.add(capture);
  assert.equal(plan.cairnPlan.batches.length, scenario.groups.length);
  for (const [index, batch] of plan.cairnPlan.batches.entries()) {
    const admission = ok(await capture.capture(batch.captureInput));
    assert.equal(admission.admission.memories.length, 1);
    const memoryId = admission.admission.memories[0].id;
    const detail = ok(capture.get({ namespace, memoryId, receiptLimit: 100 }));
    // Independent raw literals + fixed documented wrapper, not indexedWindows as oracle.
    const expected = scenario.groups[index].map(([role, text]) => [role,
      `[session-date: ${canonicalDate}; clock: dataset-local] source{${text.normalize('NFKC').replace(/\s+/gu, ' ').trim()} }`]);
    assert.deepEqual(detail.receipts.map(r => [r.role, r.excerpt]).sort(), expected.sort());
    oracle.set(memoryId, { format: flatFormat, memoryId, revision: detail.memory.revision,
      sources: detail.receipts.map(r => ({ receiptId: r.id, recordedRole: r.role, text: r.excerpt })) });
  }
  capture.close(); handles.delete(capture);
  let compiled, ranks = 0, selects = 0;
  const core = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1', model: { ...base,
    select() { selects++; assert.fail('Complete bounded source scan must not select'); },
    rank(request) {
      ranks++;
      const prepared = prepareCardPlanRankRequest(request, countTokens);
      const selectedCards = empty ? [] : request.input.candidates.map((_, index) => index).reverse();
      compiled = compileCardPlan(prepared, { selectedCards, chains: selectedCards.map((_, slot) => ({
        members: [slot], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) });
      return { refs: compiled.refs };
    },
  } }); handles.add(core);
  const recall = await core.recall({ readSet: [namespace], query: plan.mem0Input.query, limit: 6,
    contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }); ok(recall);
  assert.equal(ranks, 1); assert.equal(selects, 0);
  const evidence = assembleCardPlanEvidence({ compiled, recall, core, plan, namespace, question });
  const expected = compiled.refs.map(ref => oracle.get(ref.memoryId));
  assert.deepEqual(evidence.units.map(unit => JSON.parse(unit.text)), expected);
  return { evidence, expected, countTokens, workspace };
}

// Independent test oracle: JSON metadata lines plus fixed UTF-16 payload spans.
function recover(text) {
  assert(text.startsWith(header));
  let cursor = header.length;
  const line = () => { const end = text.indexOf('\n', cursor); assert(end >= cursor);
    const parsed = JSON.parse(text.slice(cursor, end)); cursor = end + 1; return parsed; };
  const meta = line(), sources = [];
  for (let index = 0; index < meta.sourceCount; index++) {
    const source = line(), end = cursor + source.textLength;
    const body = text.slice(cursor, end); assert.equal(body.length, source.textLength);
    assert.equal(text[end], '\n'); cursor = end + 1;
    sources.push({ receiptId: source.receiptId, recordedRole: source.recordedRole, text: body });
  }
  assert.equal(cursor, text.length);
  return { format: meta.format, memoryId: meta.memoryId, revision: meta.revision, sources };
}
function framed(card) {
  return header + JSON.stringify({ format: card.format, memoryId: card.memoryId,
    revision: card.revision, sourceCount: card.sources.length }) + '\n'
    + card.sources.map(s => JSON.stringify({ receiptId: s.receiptId, recordedRole: s.recordedRole,
      textLength: s.text.length }) + '\n' + s.text + '\n').join('');
}
function unchangedEnvelope(request) {
  const copy = structuredClone(request), user = JSON.parse(copy.messages[1].content);
  delete user.evidence; copy.messages[1].content = JSON.stringify(user); return copy;
}

for (const scenario of scenarios) integration(`V3/4/5 preserves ${scenario.name} through genuine sources and unchanged answer envelope`, async t => {
  const f = await fixture(t, scenario), original = packCardPlanAnswer({ evidence: f.evidence, countTokens: f.countTokens });
  const view = packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: f.countTokens });
  assert.deepEqual(view.units.map(unit => recover(unit.text)), f.expected);
  assert.deepEqual(view.units.map(unit => decodeReadableSourceUnit(unit.text)), f.expected);
  for (const [index, unit] of view.units.entries()) assert.equal(JSON.stringify(recover(unit.text)), f.evidence.units[index].text);
  assert.deepEqual(unchangedEnvelope(view.packed.request), unchangedEnvelope(original.request));
  assert.deepEqual(JSON.parse(view.packed.request.messages[1].content).evidence, view.units);
  assert.deepEqual(view.packed.selectedIndices, f.expected.map((_, index) => index));
  assert.deepEqual(view.packed.omittedIndices, []); assert.deepEqual(view.packed.duplicateIndices, []);
  assert.equal(view.packed.request.max_tokens, 512);
  assert.equal(view.packed.inputTokens, f.countTokens(JSON.stringify(view.packed.request))); assert(view.packed.inputTokens <= 6000);
  assert.equal(Object.isFrozen(view), true); assert.equal(Object.isFrozen(view.units[0]), true);
  t.diagnostic(JSON.stringify({ scenario: scenario.name, originalSourceTokens: f.countTokens(f.evidence.units.map(u => u.text).join('')),
    readableSourceTokens: f.countTokens(view.units.map(u => u.text).join('')), originalRequestTokens: original.inputTokens,
    readableRequestTokens: view.packed.inputTokens, originalRequestBytes: Buffer.byteLength(JSON.stringify(original.request)),
    readableRequestBytes: Buffer.byteLength(JSON.stringify(view.packed.request)), cards: view.units.length,
    receipts: f.expected.reduce((sum, card) => sum + card.sources.length, 0) }));
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});

test('V4 pure data decoding preserves newline, quotes, CJK, emoji and hostile delimiter-looking text', () => {
  const card = { format: flatFormat, memoryId: 'new-card-data-only', revision: 7, sources: [
    { receiptId: 'new-source-data-1', recordedRole: 'user', text: '  條件未成立\n"do not adopt" 😀\ncard-plan-readable-source-v1\n' },
    { receiptId: 'new-source-data-2', recordedRole: 'assistant',
      text: '{"receiptId":"forged","recordedRole":"user","textLength":0}\nEND\n\\quoted\\\tNo reconfirmation.  ' },
  ] };
  const text = framed(card);
  assert.deepEqual(decodeReadableSourceUnit(text), card); assert.deepEqual(recover(text), card);
  assert.equal(JSON.stringify(decodeReadableSourceUnit(text)), JSON.stringify(card));
  assert.throws(() => packReadableCardPlanAnswer({ evidence: { units: [{ text }], refs: [] }, countTokens: () => 1 }),
    code('invalid_card_plan_evidence'), 'Decoded data is not an assembly capability');
});

integration('V3/5 all six ordered whole cards survive, including identical text from distinct receipts', async t => {
  const repeated = 'The Zindrel record says permission remains conditional, not granted.';
  const scenario = { name: 'six-whole-cards', groups: [
    [['user', repeated], ['assistant', 'This quote is not approval for any neighboring location.']],
    [['user', repeated]],
    ...Array.from({ length: 4 }, (_, index) => [['user', `Zindrel register ${index + 1} records a separate unresolved applicability condition.`]]),
  ] };
  const f = await fixture(t, scenario), view = packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: f.countTokens });
  assert.equal(view.units.length, 6);
  assert.deepEqual(view.units.map(u => recover(u.text)), f.expected);
  assert.equal(new Set(f.expected.map(c => c.memoryId)).size, 6);
  assert.equal(f.expected.reduce((sum, c) => sum + c.sources.length, 0), 7);
  const copies = f.expected.flatMap(c => c.sources).filter(s => s.text.includes(repeated));
  assert.equal(copies.length, 2); assert.notEqual(copies[0].receiptId, copies[1].receiptId);
  assert.deepEqual(view.packed.selectedIndices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(view.packed.duplicateIndices, []); assert.deepEqual(view.packed.omittedIndices, []);
});

test('V4/7 strict data decoder rejects malformed framing/metadata without hooks', () => {
  const card = { format: flatFormat, memoryId: 'new-malformed-control', revision: 1,
    sources: [{ receiptId: 'new-malformed-source', recordedRole: 'user', text: 'Keep the denial. 😀' }] };
  const valid = framed(card);
  const bad = [valid.slice(1), valid.slice(0, -1), valid + 'trailing',
    valid.replace('"revision":1', '"revision":0'), valid.replace('"sourceCount":1', '"sourceCount":101'),
    valid.replace('"sourceCount":1', '"sourceCount":0'), valid.replace('"recordedRole":"user"', '"recordedRole":"system"'),
    valid.replace(`"textLength":${card.sources[0].text.length}`, '"textLength":-1'),
    valid.replace(`"textLength":${card.sources[0].text.length}`, `"textLength":${card.sources[0].text.length - 1}`),
    valid.replace('"revision":1', '"revision":1,"revision":1'),
    valid.replace('"revision":1', '"extra":"not-source","revision":1'),
    valid.replace(flatFormat, 'invented-semantic-format')];
  for (const text of bad) assert.throws(() => decodeReadableSourceUnit(text), code('invalid_readable_source_unit'));
  let hooks = 0;
  for (const input of [null, {}, new Proxy({}, { get() { hooks++; throw Error('hook'); } }),
    { toString() { hooks++; return valid; } }]) assert.throws(() => decodeReadableSourceUnit(input), code('invalid_readable_source_unit'));
  assert.equal(hooks, 0);
});

integration('V2/7 genuine packer rejects clones, wrong shells and hostile accessors/proxies with zero hooks', async t => {
  const f = await fixture(t);
  for (const evidence of [{}, structuredClone(f.evidence)]) assert.throws(() =>
    packReadableCardPlanAnswer({ evidence, countTokens: f.countTokens }), code('invalid_card_plan_evidence'));
  for (const input of [null, {}, { evidence: f.evidence, countTokens: f.countTokens, formatter: () => '' }])
    assert.throws(() => packReadableCardPlanAnswer(input), code('invalid_card_plan_evidence'));
  let hooks = 0;
  const accessor = { countTokens: f.countTokens };
  Object.defineProperty(accessor, 'evidence', { enumerable: true, get() { hooks++; return f.evidence; } });
  const proxy = new Proxy({}, { ownKeys() { hooks++; throw Error('hook'); } });
  assert.throws(() => packReadableCardPlanAnswer(accessor), code('invalid_card_plan_evidence'));
  assert.throws(() => packReadableCardPlanAnswer(proxy), code('invalid_card_plan_evidence'));
  assert.equal(hooks, 0);
});

integration('V5/7 exact full-wire6000 boundary, readable-only overflow and token failures refuse without trimming', async t => {
  const f = await fixture(t);
  const boundary = packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: () => 6000 });
  assert.equal(boundary.packed.inputTokens, 6000); assert.equal(boundary.units.length, f.expected.length);
  const counter = text => text.includes('card-plan-readable-source-v1') ? 6001 : 10;
  assert.equal(packCardPlanAnswer({ evidence: f.evidence, countTokens: counter }).inputTokens, 10);
  assert.throws(() => packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: counter }), code('card_plan_answer_incomplete'));
  assert.throws(() => packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: () => 6001 }), code('card_plan_answer_incomplete'));
  for (const bad of [() => { throw Error('Counter unavailable'); }, () => NaN, () => -1, () => 1.5])
    assert.throws(() => packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: bad }), code('answer_token_count_unavailable'));
  assert.throws(() => packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: text =>
    text.includes('card-plan-readable-source-v1') ? 123000 : 1 }), code('card_plan_answer_incomplete'));
});

integration('V4/5 empty genuine evidence keeps the exact original flat fallback', async t => {
  const f = await fixture(t, scenarios[0], true);
  const flat = packCardPlanAnswer({ evidence: f.evidence, countTokens: f.countTokens });
  const view = packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: f.countTokens });
  assert.deepEqual(view.units, []); assert.deepEqual(view.packed, flat);
  assert.deepEqual(JSON.parse(view.packed.request.messages[1].content).evidence, []);
});

integration('V6/7 owned child success, setup failure and assertion failure leave no scratch', async t => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-readable-view-parent-' });
  for (const mode of ['success', 'setup', 'assertion']) {
    const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=V7 owned readable child control',
      'evaluation/architecture/test/readable-source-view.test.mjs'], { encoding: 'utf8', timeout: 120000,
      env: { ...process.env, TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path,
        NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_READABLE_VIEW_CHILD: mode } });
    assert.equal(child.status, mode === 'success' ? 0 : 1, child.stdout + child.stderr);
    assert.equal(child.signal, null); assert.equal(child.error, undefined);
    if (mode !== 'success') assert.match(child.stdout, new RegExp(`Deliberate readable ${mode} failure`));
    assert.deepEqual(readdirSync(parent.path), [], `Exact empty parent after ${mode}`);
  }
  await parent.cleanup(); assert.equal(existsSync(parent.path), false);
});

if (process.env.CAIRN_READABLE_VIEW_CHILD) integration('V7 owned readable child control', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-readable-view-child-' });
  if (process.env.CAIRN_READABLE_VIEW_CHILD === 'setup') assert.fail('Deliberate readable setup failure');
  const f = await fixture(t);
  const view = packReadableCardPlanAnswer({ evidence: f.evidence, countTokens: f.countTokens });
  assert.deepEqual(view.units.map(u => recover(u.text)), f.expected);
  if (process.env.CAIRN_READABLE_VIEW_CHILD === 'assertion') assert.fail('Deliberate readable assertion failure');
  await f.workspace.cleanup(); await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

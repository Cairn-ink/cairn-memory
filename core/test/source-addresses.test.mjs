import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryCore } from '../index.mjs';
import { compileDecisionBasis } from '../source-basis.mjs';
import { sourceParts, sourceAddressAnchor } from '../source-addresses.mjs';

const mode = 'source-addressed-v1';
const unknown = () => ({ subject: null, applies: null, scope: null, commitment: null });
const namespace = { ownerId: 'synthetic-addressed', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const excerpts = ['I chose the early train because my meeting started at nine.',
  'My meeting now starts at one, so I chose the later train. I have changed my choice.'];
const sources = excerpts.map((excerpt, i) => ({ memory: { id: `source-${i}`, revision: 1 },
  receipts: [{ id: `receipt-${i}`, role: 'user', excerpt }] }));
function range(excerpt, quote) {
  const start = excerpt.indexOf(quote); assert.notEqual(start, -1);
  const boundaries = [0];
  for (const { text } of sourceParts(excerpt)) boundaries.push(boundaries.at(-1) + text.length);
  const startPart = boundaries.indexOf(start), endPart = boundaries.indexOf(start + quote.length);
  assert.ok(startPart >= 0 && endPart > startPart);
  return { startPart, endPart };
}
function proposal() {
  return { units: [
    [0, 'I chose the early train', 'decision'], [0, 'my meeting started at nine', 'premise'],
    [1, 'My meeting now starts at one', 'premise-update'], [1, 'I chose the later train', 'decision'],
  ].map(([memory, quote, role]) => ({ memory, receipt: 0, ...range(excerpts[memory], quote), role, context: unknown() })),
  links: [{ from: 1, to: 0, relation: 'supports-decision' },
    { from: 2, to: 1, relation: 'challenges-current-basis' }, { from: 2, to: 3, relation: 'supports-decision' }] };
}
test('SA1 deterministic parts retain all Unicode and whitespace; repeated occurrences have different exact anchors', () => {
  for (const excerpt of ['I chose A. I chose B.', 'ABC我B今天🙂\r\n e\u0301', '👩‍💻\t選擇。']) {
    const parts = sourceParts(excerpt);
    assert.equal(parts.map(p => p.text).join(''), excerpt);
    assert.deepEqual(parts.map(p => p.index), parts.map((_, i) => i));
    for (const p of parts) assert.ok(p.text.isWellFormed());
  }
  assert.deepEqual(sourceParts('ABC我B').map(p => p.text), ['ABC', '我', 'B']);
  const text = 'I chose A. I chose B.';
  const occurrences = sourceParts(text).filter(p => p.text === 'I').map(p =>
    sourceAddressAnchor({ startPart: p.index, endPart: p.index + 1 }, text));
  assert.deepEqual(occurrences, [{ start: 0, end: 1, text: 'I' }, { start: 11, end: 12, text: 'I' }]);
  assert.deepEqual(sourceAddressAnchor({ startPart: 0, endPart: 2 }, '🙂我'), { start: 0, end: 3, text: '🙂我' });
});
test('SA2 invalid, empty, extra-key and oversized source addresses fail without repair', () => {
  for (const r of [null, {}, { startPart: 0 }, { startPart: -1, endPart: 1 },
    { startPart: 1, endPart: 1 }, { startPart: 2, endPart: 1 }, { startPart: 0, endPart: 99 },
    { startPart: 0.5, endPart: 1 }, { startPart: '0', endPart: 1 },
    { startPart: 0, endPart: 1, quote: 'repair' }]) assert.throws(() => sourceAddressAnchor(r, 'A B'));
  assert.throws(() => sourceAddressAnchor({ startPart: 1, endPart: 2 }, 'A B'));
  assert.throws(() => sourceAddressAnchor({ startPart: 0, endPart: 1 }, 'x'.repeat(201)));
  assert.throws(() => sourceParts('\ud800'));
});
test('SA3 explicit dual role connects changed old basis and new recorded choice without duplicating a unit', () => {
  const compiled = compileDecisionBasis(proposal(), sources, mode);
  assert.equal(compiled.units.length, 4); assert.equal(compiled.links.length, 3);
  assert.equal(compiled.units[2].role, 'premise-update');
  assert.equal(compiled.units[2].anchor.text, 'My meeting now starts at one');
  assert.ok(compiled.units.every(u => u.interpretationStatus === 'model-proposed'));
  const legacy = proposal();
  legacy.units = legacy.units.map(u => ({ memory: u.memory, receipt: u.receipt, role: u.role,
    quote: sourceAddressAnchor({ startPart: u.startPart, endPart: u.endPart }, excerpts[u.memory]).text }));
  assert.throws(() => compileDecisionBasis(legacy, sources));
  legacy.units = legacy.units.map(u => ({ ...u, context: unknown() }));
  assert.throws(() => compileDecisionBasis(legacy, sources, 'source-context-v1'));
});
test('SA4 dual-role mode retains direction, chain, duplicates, strict unit and context checks', () => {
  for (const change of [
    p => { p.units[2].role = 'update'; }, p => { p.units[2].role = 'premise'; },
    p => { p.units[2].role = 'decision-update'; }, p => { p.units[0].quote = 'I'; },
    p => { p.units[0].endPart = 999; }, p => { p.units[0].receipt = 9; },
    p => { p.units[0].context.subject = { startPart: 0, endPart: 999 }; },
    p => { p.units[0].context.subject = { memory: 1, startPart: 0, endPart: 1 }; },
    p => { delete p.units[0].context.scope; },
    p => { p.links.push({ ...p.links[0] }); }, p => { p.units.push({ ...p.units[0] }); },
    p => { p.links[0].from = 0; }, p => { p.links = p.links.slice(1); },
  ]) { const p = proposal(); change(p); assert.throws(() => compileDecisionBasis(p, sources, mode)); }
  const p = proposal();
  p.units.push({ ...p.units[2], role: 'update' });
  p.links.push({ from: 4, to: 2, relation: 'challenges-current-basis' });
  assert.equal(compileDecisionBasis(p, sources, mode).links.length, 4);
});
test('SA5 actual core sends addressed sources, compiles selected repeated subject and cold-reopens without inference writes', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-addressed-')), 'memory.sqlite');
  const requests = [];
  const model = { contextWindow: 8192, countTokens: () => 1, reviewBasis(request) {
    requests.push(request); const p = proposal(); p.units[3].context.subject = range(excerpts[1], 'I'); return p;
  } };
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  const refs = excerpts.map((excerpt, i) => {
    const { memory } = ok(core.admit({ namespace, memory: { content: `Private generated ${i}`, kind: 'context' },
      receipts: [{ client: 'private-client', sessionId: 'private-session', eventId: `source-${i}`, role: 'user', excerpt }] }));
    return { memoryId: memory.id, revision: memory.revision };
  });
  const before = refs.map(ref => core.get({ namespace, memoryId: ref.memoryId }));
  const index = core.map({ namespace });
  const value = ok(await core.reviewDecisionBasis({ namespace, refs, inputMode: mode }));
  assert.equal(value.inputMode, mode); assert.equal(value.status, 'unassessed'); assert.equal(value.persistence, 'not-stored');
  assert.equal(value.units[3].context.subject.text, 'I');
  assert.equal(value.units[3].context.subject.start, excerpts[1].indexOf('I'));
  const input = requests[0].input;
  assert.deepEqual(input.memories[1].receipts[0].parts, sourceParts(excerpts[1]));
  for (const privateValue of ['Private generated', 'private-client', 'private-session', namespace.ownerId]) {
    assert.equal(JSON.stringify(input).includes(privateValue), false);
  }
  assert.match(requests[0].system, /premise-update/);
  assert.deepEqual(refs.map(ref => core.get({ namespace, memoryId: ref.memoryId })), before);
  assert.deepEqual(core.map({ namespace }), index);
  model.countTokens = text => text.includes('"parts"') ? 6001 : 1;
  assert.equal((await core.reviewDecisionBasis({ namespace, refs, inputMode: mode })).error.code, 'context_budget_exceeded');
  assert.equal(requests.length, 1);
  model.countTokens = () => 1;
  model.reviewBasis = () => {
    ok(core.correct({ namespace, memoryId: refs[0].memoryId, expectedRevision: refs[0].revision,
      content: 'Changed', kind: 'context', receipt: { client: 'synthetic', sessionId: 'synthetic',
        eventId: 'changed', role: 'user', excerpt: 'Changed' } }));
    return proposal();
  };
  assert.equal((await core.reviewDecisionBasis({ namespace, refs, inputMode: mode })).error.code, 'revision_conflict');
  core.close(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.equal(ok(cold.getRationale({ namespace, ...refs[1] })).edges.length, 0);
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../qualification-candidates.mjs';

// New handcrafted interpretations exercise binding and policy, not whether an
// LLM entails these descriptions or follows the revised guidance.
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const namespace = { ownerId: 'meaning-guidance-synthetic', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const cases = [
  { name: 'settled scoped preference', text: 'For evening sketches, I prefer charcoal.', kind: 'preference',
    subject: 'I', property: 'drawing medium', scope: 'evening sketches', applies: null, value: 'charcoal', attribution: 'direct', commitment: 'adopted' },
  { name: 'observed setting', text: 'The gallery thermostat read 19 degrees on June 7.', kind: 'fact',
    subject: 'gallery thermostat', property: 'reading', scope: 'gallery', applies: 'June 7', value: '19 degrees', attribution: 'direct', commitment: 'unknown' },
  { name: 'dated mood', text: '我在六月八日整理相簿時覺得平靜。', kind: 'context',
    subject: '我', property: '心情', scope: '整理相簿時', applies: '六月八日', value: '平靜', attribution: 'direct', commitment: 'unknown' },
  { name: 'assistant proposal with claimant', text: 'The assistant suggested a cork noticeboard for the studio.', kind: 'context', role: 'assistant',
    subject: 'studio', property: 'noticeboard material', scope: 'studio', applies: null, value: 'cork', attribution: 'proposed', commitment: 'unknown' },
  { name: 'explicit choice with independent premise', text: 'For this exhibition, I chose the east room because it has skylights.', kind: 'decision',
    subject: 'I', property: 'room choice', scope: 'exhibition', applies: 'this exhibition', value: 'east room', attribution: 'direct', commitment: 'adopted' },
  { name: 'premise in a decision mixture', text: 'For this exhibition, I chose the east room because it has skylights.', kind: 'fact',
    subject: 'east room', property: 'lighting', scope: 'exhibition', applies: 'this exhibition', value: 'skylights', attribution: 'direct', commitment: 'unknown' },
  { name: 'reported third-party choice', text: 'Mira said she chose linen for the autumn banners.', kind: 'decision',
    subject: 'Mira', property: 'fabric choice', scope: 'banners', applies: 'autumn', value: 'linen', attribution: 'reported', commitment: 'adopted' },
  { name: 'quoted third-party choice', text: 'Mira said, "For autumn banners, I chose linen."', kind: 'decision',
    subject: 'Mira', property: 'fabric choice', scope: 'banners', applies: 'autumn', value: 'linen', attribution: 'quoted', commitment: 'adopted' },
  { name: 'explicit consideration', text: 'For the winter display, I am considering paper lanterns.', kind: 'context',
    subject: 'I', property: 'decoration choice', scope: 'display', applies: 'winter', value: 'paper lanterns', attribution: 'direct', commitment: 'considered' },
  { name: 'explicit rejection', text: 'For the winter display, I rejected paper lanterns.', kind: 'context',
    subject: 'I', property: 'decoration choice', scope: 'display', applies: 'winter', value: 'paper lanterns', attribution: 'direct', commitment: 'rejected' },
];
function compile(item) {
  const snapshot = createQualificationCandidateSnapshot([{ content: item.text, kind: item.kind, confidence: 0.8,
    receipts: [{ client: 'synthetic', sessionId: 'meaning-guidance', eventId: item.name, role: item.role ?? 'user', excerpt: item.text }] }]);
  const descriptions = Object.fromEntries(fields.map(field => [field, { value: item[field], evidenceIndices: [0] }]));
  return compileQualificationCandidates({ qualifications: [{ itemIndex: 0, ...descriptions }] }, snapshot)[0];
}

for (const item of cases) test(`M4 ${item.name}: exact original source bindings preserve the specified interpretation`, () => {
  const compiled = compile(item);
  assert.equal(compiled.qualification.commitment, item.commitment);
  assert.equal(compiled.qualification.attribution, item.attribution);
  assert.equal(compiled.qualification.value, item.value);
  assert.deepEqual(compiled.qualification.slot, Object.fromEntries(['subject', 'property', 'scope', 'applies'].map(field => [field, item[field]])));
  assert.equal(compiled.receipts[0].excerpt, item.text);
  assert.equal(compiled.qualification.anchors[0].text, item.text);
  assert.equal(compiled.qualification.anchors[0].start, 0);
  assert.equal(compiled.qualification.anchors[0].end, item.text.length);
});

test('M4 exact citations do not reject an unsupported adoption interpretation', () => {
  const observation = cases[1];
  // Deliberate semantic counterexample: structural compilation is not a grader.
  assert.equal(compile({ ...observation, commitment: 'adopted' }).qualification.commitment, 'adopted');
  assert.equal(compile({ ...cases[3], attribution: 'direct', commitment: 'adopted' }).qualification.commitment, 'adopted');
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-meaning-guidance-')); const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
    rank: ({ input }) => { calls.push(structuredClone(input)); return { refs: input.candidates.map(item => ({
      namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) }; } };
  const core = openMemoryCore({ path: join(root, 'synthetic.sqlite'), model });
  t.after(() => { core.close(); rmSync(root, { recursive: true, force: true }); });
  return { core, calls };
}
function admit(core, item) {
  const compiled = compile(item);
  return ok(core.admit({ namespace, memory: { content: item.text, kind: item.kind },
    receipts: compiled.receipts, qualification: compiled.qualification })).memory;
}
for (const item of cases.filter(item => ['observed setting', 'dated mood'].includes(item.name))) {
  test(`M5 ${item.name}: supported fields and unknown commitment survive admission/get/fetch/qualified recall`, async t => {
    const { core, calls } = fixture(t); const memory = admit(core, item);
    const expected = ok(core.get({ namespace, memoryId: memory.id, includeQualification: true })).qualification;
    assert.equal(expected.commitment, 'unknown'); assert.equal(expected.value, item.value);
    assert.equal(expected.slot.applies, item.applies);
    const fetched = ok(core.fetch({ namespace, refs: [{ memoryId: memory.id, revision: memory.revision }], includeQualification: true }));
    assert.deepEqual(fetched.items[0].qualification, expected);
    const recalled = ok(await core.recall({ readSet: [namespace], query: item.text, includeQualification: true }));
    assert.deepEqual(recalled.memories[0].qualification, expected);
    assert.deepEqual(calls[0].candidates[0].qualification, expected);
    assert.equal(recalled.memories[0].memory.state, 'active');
    const sourceOnly = ok(core.fetch({ namespace, refs: [{ memoryId: memory.id, revision: memory.revision }], contextMode: 'source-evidence' }));
    assert.equal(Object.hasOwn(sourceOnly.items[0], 'qualification'), false);
  });
}

for (const stance of ['unknown', 'considered', 'rejected']) test(`M5 ${stance} choice cannot retire a bound adopted choice`, t => {
  const { core } = fixture(t); const choice = cases[4];
  const before = admit(core, choice);
  const descriptions = { unknown: 'have not decided whether to use', considered: 'am considering', rejected: 'rejected' };
  const after = admit(core, { ...choice, name: `new-${stance}`, text: `For this exhibition, I ${descriptions[stance]} the west room.`,
    value: 'west room', commitment: stance });
  const ref = memory => ({ memoryId: memory.id, expectedRevision: memory.revision });
  const slotId = ok(core.bindQualifiedClaim({ namespace, ...ref(before), slotId: null, singleClaim: true })).slotId;
  ok(core.bindQualifiedClaim({ namespace, ...ref(after), slotId, singleClaim: true }));
  const prior = ok(core.get({ namespace, memoryId: before.id, includeQualification: true }));
  const next = ok(core.get({ namespace, memoryId: after.id, includeQualification: true }));
  const result = ok(core.transitionQualified({ namespace, predecessor: ref(before), replacement: ref(after) }));
  assert.equal(result.status, 'unresolved'); assert.equal(result.reason, 'commitment_unsupported'); assert.equal(result.retiredCount, 0);
  assert.deepEqual(ok(core.get({ namespace, memoryId: before.id, includeQualification: true })), prior);
  assert.deepEqual(ok(core.get({ namespace, memoryId: after.id, includeQualification: true })), next);
});

test('M2/M3 revised guidance explicitly separates stance, claimant and times', () => {
  const qualification = readFileSync(new URL('../prompts/qualify-candidates-shared.md', import.meta.url), 'utf8');
  const extraction = readFileSync(new URL('../prompts/extract-retained-sources.md', import.meta.url), 'utf8');
  for (const phrase of ['selected subject/property/value', 'dated feeling alone has unknown', 'reporter\'s adoption', 'Not adopted does not mean rejected'])
    assert.ok(qualification.includes(phrase), phrase);
  for (const phrase of ['receipt roles alone', 'event, decision and import times', 'approval into completed execution', 'decision/premise mixtures'])
    assert.ok(extraction.includes(phrase), phrase);
});

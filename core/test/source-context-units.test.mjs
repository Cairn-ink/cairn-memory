import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSourceContextUnits, prepareSourceContextUnits } from '../index.mjs';

const field = (value, evidence = []) => ({ value, evidence });
const input = (excerpt = 'The team chose A because its audit trail is clear.') =>
  ({ sources: [{ receipts: [{ role: 'user', excerpt }] }] });
function fact(evidence = [0]) {
  return { source: 0, receipt: 0, kind: 'factual_claim',
    subject: field(null, evidence), property: field(null), scope: field(null),
    applies: field(null), value: field(null), attribution: field('unknown'),
    polarity: field('unknown'), quantifier: field('unknown'),
    eventTimeContext: [], reporterContext: [] };
}
const decision = (evidence = [0], state = 'adopted') =>
  ({ ...fact(evidence), kind: 'decision_state', state: field(state, evidence) });
const units = (...items) => ({ units: items });
const rejectedInput = value => assert.throws(() => prepareSourceContextUnits(value),
  { code: 'invalid_input' });
const rejectedOutput = (raw, value) => assert.throws(() => compileSourceContextUnits(raw, value),
  { code: 'invalid_model_output' });

test('CU1/2 pure preparation keeps exact source-only original passages and strict typed schema', () => {
  const raw = input('  Ａ 🚚\nline!  ');
  const prepared = prepareSourceContextUnits(raw);
  assert.deepEqual(Object.keys(prepared), ['input', 'responseSchema']);
  assert.deepEqual(Object.keys(prepared.input), ['sources']);
  assert.equal(prepared.input.sources[0].receipts[0].passages[0].text, raw.sources[0].receipts[0].excerpt);
  assert.equal(Object.isFrozen(prepared.input.sources[0].receipts[0].passages[0]), true);
  assert.equal(JSON.stringify(prepared).includes('edges'), false);
  const [factual, choice] = prepared.responseSchema.properties.units.items.anyOf;
  for (const branch of [factual, choice]) {
    assert.equal(branch.additionalProperties, false);
    assert.equal(Object.hasOwn(branch.properties, 'focus'), false);
    assert.equal(Object.hasOwn(branch.properties, 'eventTime'), false);
    assert.equal(Object.hasOwn(branch.properties, 'reporter'), false);
    assert.equal(branch.properties.eventTimeContext.maxItems, 4);
  }
  assert.equal(Object.hasOwn(factual.properties, 'state'), false);
  assert.equal(Object.hasOwn(choice.properties, 'state'), true);
  assert.equal(prepared.responseSchema.properties.units.maxItems, 8);
  raw.sources[0].receipts[0].excerpt = 'changed';
  assert.equal(prepared.input.sources[0].receipts[0].passages[0].text, '  Ａ 🚚\nline!  ');
});

test('CU1 rejects malformed/secret raw without normalizing retained source text', () => {
  for (const bad of [
    { ...input(), edges: [] }, { sources: [] },
    { sources: [{ receipts: [] }] },
    { sources: [{ receipts: [{ role: 'system', excerpt: 'known' }] }] },
    { sources: [{ receipts: [{ role: 'user', excerpt: ' ' }] }] },
    { sources: [{ receipts: [{ role: 'user', excerpt: 'x\ud800' }] }] },
    { sources: [{ receipts: [{ role: 'user', excerpt: 'x'.repeat(801) }] }] },
    { sources: [{ receipts: [{ role: 'user', excerpt: 'sk-' + 'a'.repeat(24) }] }] },
    { sources: [{ receipts: [{ role: 'user', excerpt: 'ｓｋ-' + 'a'.repeat(24) }] }] },
  ]) rejectedInput(bad);
  const sparse = input(); sparse.sources = [, sparse.sources[0]]; rejectedInput(sparse);
  const accessor = input(); Object.defineProperty(accessor.sources[0].receipts[0], 'excerpt',
    { get: () => 'forged', enumerable: true }); rejectedInput(accessor);
  const cycle = input(); cycle.self = cycle; rejectedInput(cycle);
  const nullProto = Object.assign(Object.create(null), input()); rejectedInput(nullProto);
});

test('CU2 independently bounds serialized raw and prepared input at 6000 UTF16', () => {
  const rawTooLarge = { sources: Array.from({ length: 6 }, () => ({ receipts: [
    { role: 'user', excerpt: 'a'.repeat(800) },
    { role: 'assistant', excerpt: 'b'.repeat(800) },
  ] })) };
  assert.ok(JSON.stringify(rawTooLarge).length > 6000);
  rejectedInput(rawTooLarge);
  const preparedTooLarge = { sources: Array.from({ length: 6 }, (_, i) => ({ receipts: [
    { role: 'user', excerpt: 'a'.repeat(800) },
    ...(i < 4 ? [{ role: 'assistant', excerpt: 'b'.repeat(20) }] : []),
  ] })) };
  assert.ok(JSON.stringify(preparedTooLarge).length < 6000);
  assert.equal(preparedTooLarge.sources.length, 6);
  assert.ok(preparedTooLarge.sources.every(source => source.receipts.length <= 4
    && source.receipts.every(receipt => receipt.excerpt.length <= 800)));
  rejectedInput(preparedTooLarge);
});

test('CU3 derives exact nonadjacent focus and retains original source/context anchors', () => {
  const raw = input('🚚' + 'a'.repeat(198) + '。' + 'b'.repeat(199) + '!');
  const item = fact([0]); item.property = field('separate context', [2]);
  item.eventTimeContext = [2, 0]; item.reporterContext = [2];
  const result = compileSourceContextUnits(raw, units(item));
  const compiled = result.units[0];
  assert.deepEqual(compiled.focus.map(anchor => anchor.passage), [0, 2]);
  assert.deepEqual(compiled.eventTimeContext.anchors.map(anchor => anchor.passage), [0, 2]);
  assert.deepEqual(compiled.eventTimeContext.anchors.map(anchor => [anchor.start, anchor.end]),
    [[0, 200], [400, 401]]);
  assert.equal(compiled.focus[0].text.startsWith('🚚'), true);
  assert.equal(compiled.focus[1].text, '!');
  assert.equal(compiled.qualification.anchors[0].fields.includes('subject'), true);
  assert.equal(compiled.qualification.anchors[0].fields.includes('property'), false);
  assert.equal(compiled.qualification.anchors[1].fields.includes('property'), true);
  assert.equal(compiled.eventTimeContext.interpretationStatus, 'model-proposed-unverified');
  assert.equal(Object.hasOwn(compiled.eventTimeContext, 'quote'), false);
  assert.equal(result.status, 'assessment-only');
  assert.equal(result.persistence, 'not-stored');
  assert.equal(Object.isFrozen(compiled.eventTimeContext.anchors[0]), true);
});

test('CU3 maps seven decision states through the existing qualification validator', () => {
  for (const state of ['considered', 'adopted', 'rejected', 'not_approved',
    'not_withdrawn', 'pending_reconfirmation', 'unknown']) {
    const item = decision([0], state);
    const compiled = compileSourceContextUnits(input(), units(item)).units[0];
    assert.equal(compiled.state.value, state);
    assert.equal(compiled.qualification.commitment,
      ['considered', 'adopted', 'rejected'].includes(state) ? state : 'unknown');
    assert.equal(compiled.qualification.anchors[0].receiptIndex, 0);
    assert.equal(Object.hasOwn(compiled.qualification, 'client'), false);
    assert.equal(compiled.interpretationStatus, 'model-proposed-unverified');
  }
  const wrong = fact(); wrong.state = field('adopted', [0]); rejectedOutput(input(), units(wrong));
  const old = decision(); old.focus = [0]; rejectedOutput(input(), units(old));
});

test('CU3 rejects every foreign, duplicate and missing field/state/context reference', () => {
  const raw = input();
  for (const name of ['subject', 'property', 'scope', 'applies', 'value',
    'attribution', 'polarity', 'quantifier']) {
    const bad = fact(); bad[name].evidence = [1]; rejectedOutput(raw, units(bad));
    const repeated = fact(); repeated[name].evidence = [0, 0];
    rejectedOutput(raw, units(repeated));
  }
  for (const name of ['eventTimeContext', 'reporterContext']) {
    const bad = fact(); bad[name] = [1]; rejectedOutput(raw, units(bad));
    const repeated = fact(); repeated[name] = [0, 0]; rejectedOutput(raw, units(repeated));
  }
  const state = decision(); state.state.evidence = [1]; rejectedOutput(raw, units(state));
  const missing = decision(); missing.state.evidence = []; rejectedOutput(raw, units(missing));
  const known = fact(); known.property = field('claim'); rejectedOutput(raw, units(known));
  const noQualification = fact(); noQualification.subject.evidence = [];
  noQualification.eventTimeContext = [0]; rejectedOutput(raw, units(noQualification));
  const scenarios = [
    { name: 'other receipt', raw: { sources: [{ receipts: [
      { role: 'user', excerpt: 'f'.repeat(201) },
      { role: 'assistant', excerpt: 'own receipt' }] }] }, source: 0, receipt: 1 },
    { name: 'other source', raw: { sources: [
      { receipts: [{ role: 'user', excerpt: 'f'.repeat(201) }] },
      { receipts: [{ role: 'assistant', excerpt: 'own source' }] },
    ] }, source: 1, receipt: 0 },
  ];
  for (const scenario of scenarios) {
    const prepared = prepareSourceContextUnits(scenario.raw);
    const schemaIds = prepared.responseSchema.properties.units.items.anyOf[0]
      .properties.subject.properties.evidence.items.enum;
    assert.ok(schemaIds.includes(1), scenario.name); // Globally valid, foreign locally.
    assert.deepEqual(prepared.input.sources[scenario.source].receipts[scenario.receipt]
      .passages.map(passage => passage.index), [0], scenario.name);
    const ownFact = fact(); ownFact.source = scenario.source; ownFact.receipt = scenario.receipt;
    const ownDecision = decision(); ownDecision.source = scenario.source;
    ownDecision.receipt = scenario.receipt;
    assert.equal(compileSourceContextUnits(scenario.raw, units(ownFact)).units.length, 1);
    assert.equal(compileSourceContextUnits(scenario.raw, units(ownDecision)).units.length, 1);
    for (const name of ['subject', 'property', 'scope', 'applies', 'value',
      'attribution', 'polarity', 'quantifier']) {
      const foreign = structuredClone(ownFact);
      foreign[name].evidence = [1];
      rejectedOutput(scenario.raw, units(foreign));
    }
    for (const name of ['eventTimeContext', 'reporterContext']) {
      const foreign = structuredClone(ownFact);
      foreign[name] = [1];
      rejectedOutput(scenario.raw, units(foreign));
    }
    const foreignState = structuredClone(ownDecision);
    foreignState.state.evidence = [1]; rejectedOutput(scenario.raw, units(foreignState));
    for (const stateRefs of [[0, 0], [99]]) {
      const malformedState = structuredClone(ownDecision);
      malformedState.state.evidence = stateRefs;
      rejectedOutput(scenario.raw, units(malformedState));
    }
    for (const name of ['source', 'receipt']) {
      for (const badId of [-1, 99, '0', undefined]) {
        const malformedId = structuredClone(ownFact);
        malformedId[name] = badId;
        rejectedOutput(scenario.raw, units(malformedId));
      }
      const missingId = structuredClone(ownFact);
      delete missingId[name];
      rejectedOutput(scenario.raw, units(missingId));
    }
  }
});

test('CU3 five passages within valid 800 UTF16 cannot widen four-passage focus', () => {
  const raw = input('a'.repeat(199) + '🚚' + 'b'.repeat(599));
  const passages = prepareSourceContextUnits(raw).input.sources[0].receipts[0].passages;
  assert.deepEqual(passages.map(passage => passage.text.length), [199, 200, 200, 200, 1]);
  const item = fact([0, 1, 2, 3]); item.reporterContext = [4];
  rejectedOutput(raw, units(item));
});

test('CU3 duplicate equivalent order and malformed batches reject atomically', () => {
  const raw = input('a'.repeat(400));
  const first = fact([0, 1]); first.eventTimeContext = [1, 0];
  const reversed = fact([1, 0]); reversed.eventTimeContext = [0, 1];
  rejectedOutput(raw, units(first, reversed));
  const wrong = fact(); wrong.extra = true; rejectedOutput(raw, units(first, wrong));
  const empty = compileSourceContextUnits(raw, units()); assert.equal(empty.units.length, 0);
  const tooMany = Array.from({ length: 9 }, (_, i) => {
    const item = fact(); item.subject.value = `unit ${i}`; return item;
  });
  rejectedOutput(raw, units(...tooMany));
});

test('CU3 proposed and expanded compiled outputs each have a 24000 UTF16 boundary', () => {
  const raw = input('x'.repeat(800));
  const oversizedProposal = fact(); oversizedProposal.subject.value = 'a'.repeat(24_001);
  assert.ok(JSON.stringify(units(oversizedProposal)).length > 24_000);
  rejectedOutput(raw, units(oversizedProposal));
  const expansive = Array.from({ length: 8 }, (_, i) => {
    const item = decision([0, 1, 2, 3], 'adopted');
    item.subject = field(`unit ${i}`, [0, 1, 2, 3]);
    for (const name of ['property', 'scope', 'applies', 'value', 'attribution',
      'polarity', 'quantifier']) item[name].evidence = [0, 1, 2, 3];
    item.eventTimeContext = [0, 1, 2, 3]; item.reporterContext = [0, 1, 2, 3];
    return item;
  });
  assert.ok(JSON.stringify(units(...expansive)).length < 24_000);
  for (const item of expansive) assert.equal(compileSourceContextUnits(raw, units(item)).units.length, 1);
  rejectedOutput(raw, units(...expansive));
});

test('CU5 strict trees, detached input and wrong semantic context remain unverified', () => {
  const raw = input('The committee chose A because the shelves were unsafe.');
  for (const make of [
    () => ({ units: [, fact()] }),
    () => { const x = fact(); x.eventTimeContext = [0, ,]; return units(x); },
    () => { const x = fact(); Object.defineProperty(x, 'subject',
      { get: () => field(null, [0]), enumerable: true }); return units(x); },
    () => { const x = fact(); x.subject.evidence.push(x); return units(x); },
    () => { const x = fact(); x.source = { valueOf: () => 0 }; return units(x); },
  ]) rejectedOutput(raw, make());
  const item = fact(); item.eventTimeContext = [0];
  const compiled = compileSourceContextUnits(raw, units(item));
  raw.sources[0].receipts[0].excerpt = 'changed'; item.eventTimeContext[0] = 9;
  assert.match(compiled.units[0].eventTimeContext.anchors[0].text, /because the shelves were unsafe/u);
  assert.equal(compiled.units[0].eventTimeContext.interpretationStatus,
    'model-proposed-unverified');
});

const v2Input = (excerpt = 'Mina relays Lee’s tentative view that a sensor failed.') =>
  ({ version: 2, sources: [{ receipts: [{ role: 'user', excerpt }] }] });
const v2Fact = () => ({ ...fact(), epistemicState: field('tentative', [0]),
  claimant: field('Lee', [0]), reporter: field('Mina', [0]) });

test('SCS1/2 version 2 preparation and compilation keep stance on the proposition', () => {
  const raw = v2Input();
  const prepared = prepareSourceContextUnits(raw);
  assert.equal(prepared.input.version, 2);
  assert.deepEqual(Object.keys(prepared.responseSchema.properties), ['units']);
  for (const branch of prepared.responseSchema.properties.units.items.anyOf) {
    for (const name of ['epistemicState', 'claimant', 'reporter']) {
      assert.equal(Object.hasOwn(branch.properties, name), true);
      assert.equal(branch.required.includes(name), true);
      assert.equal(branch.properties[name].properties.evidence.maxItems, 4);
    }
  }
  const result = compileSourceContextUnits(raw, units(v2Fact()));
  assert.equal(result.version, 2);
  assert.equal(result.units.length, 1);
  const unit = result.units[0];
  assert.equal(unit.qualification.slot.subject, null);
  assert.equal(unit.epistemicState.value, 'tentative');
  assert.equal(unit.claimant.value, 'Lee');
  assert.equal(unit.reporter.value, 'Mina');
  assert.deepEqual(unit.focus.map(anchor => anchor.passage), [0]);
  for (const name of ['epistemicState', 'claimant', 'reporter']) {
    assert.equal(unit[name].anchors[0].text, raw.sources[0].receipts[0].excerpt);
    assert.equal(unit[name].interpretationStatus, 'model-proposed-unverified');
  }
  assert.equal(unit.interpretationStatus, 'model-proposed-unverified');
  assert.equal(result.persistence, 'not-stored');
  raw.sources[0].receipts[0].excerpt = 'changed';
  assert.match(unit.claimant.anchors[0].text, /Mina relays Lee/u);
});

test('SCS1/2 legacy and explicit v2 shapes reject cross-version and malformed stance fields', () => {
  for (const version of [1, 4, null, '2']) rejectedInput({ ...input(), version });
  rejectedInput({ ...v2Input(), extra: true });
  rejectedOutput(input(), units(v2Fact()));
  rejectedOutput(v2Input(), units(fact()));
  rejectedOutput(v2Input(), { version: 2, units: [v2Fact()] });
  for (const name of ['epistemicState', 'claimant', 'reporter']) {
    const missing = v2Fact(); delete missing[name]; rejectedOutput(v2Input(), units(missing));
    const wrong = v2Fact(); wrong[name].evidence = [1]; rejectedOutput(v2Input(), units(wrong));
    const repeated = v2Fact(); repeated[name].evidence = [0, 0];
    rejectedOutput(v2Input(), units(repeated));
    const noEvidence = v2Fact(); noEvidence[name].evidence = [];
    rejectedOutput(v2Input(), units(noEvidence));
  }
  for (const value of ['confirmed', 2, ['tentative']]) {
    const wrong = v2Fact(); wrong.epistemicState.value = value;
    rejectedOutput(v2Input(), units(wrong));
  }
  for (const name of ['claimant', 'reporter']) {
    for (const value of ['sk-' + 'a'.repeat(24), 'ｓｋ-' + 'a'.repeat(24),
      'x'.repeat(161), '㍍'.repeat(41), '   ', '\ud800', 'Lee\0', ' Lee', 'Lee  Team']) {
      const wrong = v2Fact(); wrong[name].value = value;
      rejectedOutput(v2Input(), units(wrong));
    }
  }
  const extra = v2Fact(); extra.confirmed = true; rejectedOutput(v2Input(), units(extra));
});

const v3Input = (excerpt = 'The committee considered A because the export is auditable.') =>
  ({ ...v2Input(excerpt), version: 3 });
const v3Fact = (source = 0, receipt = 0) => ({ ...v2Fact(), source, receipt,
  epistemicState: field('asserted', [0]), claimant: field(null), reporter: field(null) });
const v3Decision = (source = 0, receipt = 0, state = 'considered') => ({
  ...v3Fact(source, receipt), kind: 'decision_state', state: field(state, [0]),
});
const linked = (items, reasonLinks = []) => ({ units: items, reasonLinks });
const reason = (from = 0, to = 1, evidence = [0]) =>
  ({ from, to, relation: 'stated-reason-for', evidence });

test('SCC2/3 v3 generation schema requires citations for every interpreted field', () => {
  const raw = v3Input('The panel reported that route B was rejected because its export failed.');
  const schema = prepareSourceContextUnits(raw).responseSchema;
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  const [factual, decisionSchema] = schema.properties.units.items.anyOf;
  const cases = [
    ['subject', 'panel', null], ['property', 'export failed', null],
    ['scope', 'route B', null], ['applies', 'panel', null], ['value', 'failed', null],
    ['attribution', 'reported', 'unknown'], ['polarity', 'negated', 'unknown'],
    ['quantifier', 'unspecified', 'unknown'], ['epistemicState', 'tentative', 'unknown'],
    ['claimant', 'panel', null], ['reporter', 'panel', null],
  ];
  const accepts = (fieldSchema, value, evidence) => (fieldSchema.anyOf ?? [fieldSchema])
    .some(branch => {
      const candidate = branch.properties.value;
      const refs = branch.properties.evidence;
      return (candidate.enum ? candidate.enum.includes(value)
        : candidate.type === 'null' ? value === null : typeof value === candidate.type)
        && evidence.length >= refs.minItems && evidence.length <= refs.maxItems
        && evidence.every(id => refs.items.enum.includes(id));
    });
  for (const branch of [factual, decisionSchema]) {
    for (const [name, known, unknown] of cases) {
      const fieldSchema = branch.properties[name];
      assert.equal(fieldSchema.anyOf?.length, 2, name);
      for (const variant of fieldSchema.anyOf) {
        assert.equal(variant.type, 'object', name);
        assert.equal(variant.additionalProperties, false, name);
        assert.deepEqual(variant.required, ['value', 'evidence'], name);
      }
      assert.equal(accepts(fieldSchema, known, []), false, `${name}: known without citation`);
      assert.equal(accepts(fieldSchema, known, [0]), true, `${name}: known cited`);
      assert.equal(accepts(fieldSchema, unknown, []), true, `${name}: unknown without citation`);
      assert.equal(accepts(fieldSchema, unknown, [0]), true, `${name}: unknown cited`);
      assert.equal(accepts(fieldSchema, known, [0, 0, 0, 0, 0]), false, `${name}: max four`);
      const base = branch === factual ? v3Fact() : v3Decision();
      base.subject = field('panel', [0]);
      base.property = field('export', [0]);
      const missing = structuredClone(base); missing[name] = field(known);
      rejectedOutput(raw, linked([missing]));
      const cited = structuredClone(base); cited[name] = field(known, [0]);
      assert.equal(compileSourceContextUnits(raw, linked([cited])).units.length, 1, name);
      for (const evidence of [[], [0]]) {
        const unassessed = structuredClone(base); unassessed[name] = field(unknown, evidence);
        assert.equal(compileSourceContextUnits(raw, linked([unassessed])).units.length, 1, name);
      }
    }
  }
  const state = decisionSchema.properties.state;
  assert.equal(state.anyOf?.length, 2);
  assert.equal(accepts(state, 'adopted', []), false);
  assert.equal(accepts(state, 'adopted', [0]), true);
  assert.equal(accepts(state, 'unknown', []), true);
  assert.equal(accepts(state, 'unknown', [0]), true);
  const invalidOldOutput = v3Fact(); invalidOldOutput.quantifier = field('unspecified');
  rejectedOutput(raw, linked([invalidOldOutput]));
});

test('SRL1–3 v3 prepares a closed link schema and derives same-receipt exact anchors', () => {
  const raw = v3Input('The team considered A because its export is auditable. '.repeat(5));
  const prepared = prepareSourceContextUnits(raw);
  assert.equal(prepared.input.version, 3);
  assert.deepEqual(Object.keys(prepared.responseSchema.properties), ['units', 'reasonLinks']);
  const linkSchema = prepared.responseSchema.properties.reasonLinks;
  assert.equal(linkSchema.maxItems, 8);
  assert.deepEqual(linkSchema.items.required, ['from', 'to', 'relation', 'evidence']);
  assert.deepEqual(linkSchema.items.properties.from.enum, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(linkSchema.items.properties.evidence.minItems, 1);
  const proposal = linked([v3Fact(), v3Decision()], [reason(0, 1, [1, 0])]);
  const result = compileSourceContextUnits(raw, proposal);
  assert.equal(result.version, 3);
  assert.equal(result.units[1].state.value, 'considered');
  assert.deepEqual(result.reasonLinks.map(link => [link.from, link.to, link.source, link.receipt]),
    [[0, 1, 0, 0]]);
  assert.deepEqual(result.reasonLinks[0].anchors.map(anchor => anchor.passage), [0, 1]);
  assert.equal(result.reasonLinks[0].interpretationStatus, 'model-proposed-unverified');
  assert.equal(Object.isFrozen(result.reasonLinks[0].anchors[0]), true);
  proposal.reasonLinks[0].evidence[0] = 99;
  raw.sources[0].receipts[0].excerpt = 'mutated';
  assert.match(result.reasonLinks[0].anchors[0].text, /considered A/u);
  assert.deepEqual(compileSourceContextUnits(v3Input(), linked([])).reasonLinks, []);
  const recheck = compileSourceContextUnits(v3Input('The team adopted A, but its failed export now requires reconfirmation.'),
    linked([v3Fact(), v3Decision(0, 0, 'pending_reconfirmation')], [reason()]));
  assert.equal(recheck.units[1].state.value, 'pending_reconfirmation');
  assert.equal(recheck.units[1].qualification.commitment, 'unknown');
  assert.equal(recheck.reasonLinks[0].relation, 'stated-reason-for');
});

test('SRL6 explicitly rejected choice keeps its stated reason without inventing adoption', () => {
  const excerpt = 'The panel rejected route B because its audit log cannot be exported.';
  const factual = v3Fact();
  factual.subject = field('route B audit log', [0]);
  factual.property = field('can be exported', [0]);
  factual.value = field('no', [0]);
  factual.polarity = field('negated', [0]);
  const choice = v3Decision(0, 0, 'rejected');
  choice.subject = field('panel', [0]);
  choice.property = field('route B selection', [0]);
  choice.value = field('rejected', [0]);
  const result = compileSourceContextUnits(v3Input(excerpt),
    linked([factual, choice], [reason()]));
  assert.equal(result.units[0].qualification.slot.subject, 'route B audit log');
  assert.equal(result.units[0].polarity.value, 'negated');
  assert.equal(result.units[1].qualification.slot.subject, 'panel');
  assert.equal(result.units[1].state.value, 'rejected');
  assert.equal(result.units[1].qualification.commitment, 'rejected');
  assert.deepEqual(result.reasonLinks.map(link => [link.from, link.to, link.relation]),
    [[0, 1, 'stated-reason-for']]);
  assert.equal(result.reasonLinks[0].anchors[0].text, excerpt);
  assert.equal(result.reasonLinks[0].interpretationStatus, 'model-proposed-unverified');
  assert.equal(result.persistence, 'not-stored');
});

test('SRL2 rejects wrong direction, identity, references, duplicates and open shape', () => {
  const raw = { version: 3, sources: [
    { receipts: [{ role: 'user', excerpt: 'a'.repeat(201) },
      { role: 'assistant', excerpt: 'Other receipt.' }] },
    { receipts: [{ role: 'user', excerpt: 'Other source.' }] },
  ] };
  const valid = [v3Fact(), v3Decision()];
  assert.ok(prepareSourceContextUnits(raw).responseSchema.properties.reasonLinks.items
    .properties.evidence.items.enum.includes(1));
  assert.equal(compileSourceContextUnits(raw, linked(valid, [reason()])).reasonLinks.length, 1);
  for (const bad of [reason(1, 0), reason(0, 0), reason(0, 2), reason(-1, 1),
    reason('0', 1), reason(0, 1, []), reason(0, 1, [0, 0]), reason(0, 1, [99])]) {
    rejectedOutput(raw, linked(valid, [bad]));
  }
  rejectedOutput(raw, linked(valid, [reason(), reason()]));
  const crossReceipt = [v3Fact(), v3Decision(0, 1)];
  rejectedOutput(raw, linked(crossReceipt, [reason()]));
  const crossSource = [v3Fact(), v3Decision(1, 0)];
  rejectedOutput(raw, linked(crossSource, [reason()]));
  rejectedOutput(raw, linked([v3Fact(), v3Fact()], [reason()]));
  rejectedOutput(raw, linked([v3Decision(), v3Decision()], [reason()]));
  rejectedOutput(raw, { units: valid });
  rejectedOutput(raw, { units: valid, reasonLinks: [], extra: true });
  rejectedOutput(raw, linked(valid, [{ ...reason(), extra: true }]));
  rejectedOutput(raw, linked(valid, [{ ...reason(), relation: 'causes' }]));
  rejectedOutput(raw, linked(valid, [, reason()]));
  rejectedOutput(raw, linked(valid, Array(9).fill(reason())));
});

test('SRL3 links remain unverified even when a valid citation is semantically wrong', () => {
  const raw = v3Input('The audit passed. The team considered A for a different reason.');
  const result = compileSourceContextUnits(raw, linked([v3Fact(), v3Decision()], [reason()]));
  assert.equal(result.reasonLinks[0].interpretationStatus, 'model-proposed-unverified');
  assert.equal(result.status, 'assessment-only');
  assert.equal(result.persistence, 'not-stored');
});

test('SRL5 reason anchors count toward the existing complete compiled-output limit', () => {
  const raw = v3Input('x'.repeat(800));
  const items = Array.from({ length: 6 }, (_, i) => {
    const unit = i < 3 ? v3Fact() : v3Decision();
    unit.subject = field(`unit ${i}`, [0, 1, 2, 3]);
    unit.polarity = field('affirmed', [0, 1]);
    return unit;
  });
  for (const item of items) assert.equal(compileSourceContextUnits(raw, linked([item])).units.length, 1);
  const links = Array.from({ length: 8 }, (_, i) => reason(i % 3, 3 + Math.floor(i / 3), [0, 1, 2, 3]));
  assert.ok(JSON.stringify(linked(items, links)).length < 24_000);
  const withoutLinks = compileSourceContextUnits(raw, linked(items));
  assert.ok(JSON.stringify(withoutLinks).length <= 24_000);
  assert.equal(withoutLinks.units.length, 6);
  rejectedOutput(raw, linked(items, links));
});

test('SCS2 foreign receipt, focus overflow, asserted negation and unknowns use existing bounds', () => {
  const raw = { version: 2, sources: [{ receipts: [
    { role: 'user', excerpt: 'f'.repeat(201) },
    { role: 'assistant', excerpt: 'Lee says the valve is not blocked.' },
  ] }] };
  const item = v2Fact(); item.receipt = 1;
  item.epistemicState = field('asserted', [0]);
  item.claimant = field(null); item.reporter = field(null);
  item.polarity = field('negated', [0]);
  assert.equal(prepareSourceContextUnits(raw).responseSchema.properties.units.items.anyOf[0]
    .properties.claimant.properties.evidence.items.enum.includes(1), true);
  const compiled = compileSourceContextUnits(raw, units(item)).units[0];
  assert.equal(compiled.epistemicState.value, 'asserted');
  assert.equal(compiled.polarity.value, 'negated');
  assert.equal(compiled.claimant.value, null);
  assert.equal(compiled.reporter.value, null);
  for (const name of ['epistemicState', 'claimant', 'reporter']) {
    const foreign = structuredClone(item); foreign[name].evidence = [1];
    rejectedOutput(raw, units(foreign));
  }
  const five = v2Input('a'.repeat(199) + '🚚' + 'b'.repeat(599));
  const crowded = v2Fact(); crowded.subject.evidence = [0];
  crowded.property = field('p', [1]); crowded.scope = field('s', [2]);
  crowded.applies = field('a', [3]); crowded.epistemicState.evidence = [4];
  rejectedOutput(five, units(crowded));
  const unknown = v2Fact(); unknown.epistemicState = field('unknown');
  unknown.claimant = field(null); unknown.reporter = field(null);
  assert.equal(compileSourceContextUnits(v2Input(), units(unknown)).units[0]
    .epistemicState.value, 'unknown');
  const decisionUnit = { ...v2Fact(), kind: 'decision_state', state: field('considered', [0]) };
  assert.equal(compileSourceContextUnits(v2Input(), units(decisionUnit)).units[0]
    .state.value, 'considered');
  const nine = Array.from({ length: 9 }, (_, index) => {
    const candidate = v2Fact(); candidate.subject = field(`subject ${index}`, [0]);
    return candidate;
  });
  rejectedOutput(v2Input(), units(...nine));
  const semanticallyWrong = v2Fact(); semanticallyWrong.epistemicState = field('asserted', [0]);
  const unverified = compileSourceContextUnits(v2Input(), units(semanticallyWrong)).units[0];
  assert.equal(unverified.epistemicState.value, 'asserted');
  assert.equal(unverified.epistemicState.interpretationStatus, 'model-proposed-unverified');
  const self = v2Fact(); self.subject = field('Inez', [0]);
  self.claimant = field('Inez', [0]); self.reporter = field('Inez', [0]);
  self.epistemicState = field('asserted', [0]);
  const samePerson = compileSourceContextUnits(v2Input('I, Inez, feel tired today.'), units(self)).units[0];
  assert.equal(samePerson.qualification.slot.subject, 'Inez');
  assert.equal(samePerson.claimant.value, 'Inez');
  assert.equal(samePerson.reporter.value, 'Inez');
});

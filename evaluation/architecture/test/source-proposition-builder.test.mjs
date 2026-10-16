import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourcePropositions, compileSourcePropositions, buildSourcePropositions }
  from '../source-proposition-builder.mjs';

// New scripted mechanical fixtures, not model accuracy or the prospective cohort.
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const input = (...texts) => ({ namespace: { ownerId: 'private-owner', scope: 'personal', projectId: null },
  client: 'synthetic-client', eventId: 'private-capture', sessionId: 'private-session',
  messages: texts.map((content, index) => ({ id: `private-source-${index}`, role: 'user', content })) });
const field = (value, evidenceIndices = [0]) => ({ value, evidenceIndices });
const proposition = (overrides = {}, ids = [0]) => ({ content: 'Synthetic observation', kind: 'fact', confidence: 0.8,
  evidenceIndices: ids, role: field('observation', ids), claimant: field(null, []),
  subject: field(null, []), property: field(null, []), scope: field(null, []), applies: field(null, []),
  value: field(null, ids), attribution: field('unknown', []), commitment: field('unknown', []), ...overrides });
const output = (...propositions) => ({ propositions });
const compile = (source, ...items) => compileSourcePropositions(prepareSourcePropositions(source), output(...items));
const invalid = (prepared, value) => assert.throws(() => compileSourcePropositions(prepared, value),
  { code: 'invalid_proposition_output' });
function frozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen);
}

test('SP1 source-only request excludes trusted identity and interpretation; preparation owns immutable copies', () => {
  const source = input('  Ａ measured\n 12 ms.  ');
  const prepared = prepareSourcePropositions(source); frozen(prepared);
  assert.deepEqual(prepared.request.input, { candidates: [{ candidateIndex: 0, sourceIndex: 0, segmentIndex: 0,
    role: 'user', text: 'A measured 12 ms.' }] });
  assert.deepEqual(Object.keys(prepared.request).sort(), ['input', 'maxOutputTokens', 'system']);
  const requestText = JSON.stringify(prepared.request);
  for (const secret of ['private-owner', 'private-capture', 'private-session', 'private-source', 'synthetic-client'])
    assert.equal(requestText.includes(secret), false);
  source.messages[0].content = 'mutated'; source.messages[0].id = 'mutated'; source.namespace.ownerId = 'mutated';
  const result = compileSourcePropositions(prepared, output(proposition())); frozen(result);
  assert.equal(result.items[0].receipts[0].excerpt, 'A measured 12 ms.');
  assert.equal(result.items[0].receipts[0].eventId, 'private-source-0');
  assert.throws(() => prepared.request.input.candidates.push({}), TypeError);
  assert.throws(() => compileSourcePropositions(structuredClone(prepared), output()), { code: 'invalid_preparation' });
});

test('SP2 mixed observation and explicit choice compile as distinct aligned claims', () => {
  const result = compile(input('The sensor reads 18 C. I choose the north room for tonight.'),
    proposition({ content: 'The sensor reads 18 C.', subject: field('sensor'), property: field('temperature'), value: field('18 C'), attribution: field('direct') }),
    proposition({ content: 'The speaker chooses the north room tonight.', kind: 'decision', role: field('choice'), claimant: field('speaker'),
      subject: field('speaker'), property: field('room choice'), value: field('north room'), applies: field('tonight'),
      attribution: field('direct'), commitment: field('adopted') }));
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.qualification.commitment), ['unknown', 'adopted']);
  assert.deepEqual(result.sidecars.map(item => item.role.value), ['observation', 'choice']);
  assert.deepEqual(result.sidecars.map(item => item.propositionIndex), [0, 1]);
  assert.equal(Object.hasOwn(result.items[0], 'role'), false);
  assert.equal(Object.hasOwn(result.items[1], 'claimant'), false);
});

test('SP3 conditional settled choice retains conditions without inventing a time', () => {
  const result = compile(input('If the footbridge is open, I have decided to walk to the archive.'),
    proposition({ content: 'The speaker chooses walking to the archive if the footbridge is open.', kind: 'decision',
      role: field('choice'), claimant: field('speaker'), subject: field('speaker'), property: field('transport'),
      scope: field('archive trip'), applies: field('if the footbridge is open'), value: field('walk'),
      attribution: field('direct'), commitment: field('adopted') }));
  assert.equal(result.items[0].qualification.slot.applies, 'if the footbridge is open');
  assert.equal(result.items[0].qualification.value, 'walk');
});

test('SP4 considered negative option keeps option and stance distinct; factual confidence is independent', () => {
  const result = compile(input('I am considering not enabling the hallway bell.'),
    proposition({ content: 'The speaker considers leaving the hallway bell disabled.', kind: 'decision', confidence: 0.99,
      role: field('choice'), claimant: field('speaker'), value: field('not enable the hallway bell'),
      attribution: field('direct'), commitment: field('considered') }));
  assert.equal(result.items[0].qualification.value, 'not enable the hallway bell');
  assert.equal(result.items[0].qualification.commitment, 'considered');
  assert.equal(result.items[0].confidence, 0.99);
});

test('SP5 reported chooser differs from source author and namespace owner', () => {
  const result = compile(input('Nora told me she rejected the copper roof.'),
    proposition({ content: 'Nora rejected the copper roof.', kind: 'decision', role: field('choice'), claimant: field('Nora'),
      subject: field('Nora'), property: field('roof material'), value: field('copper'),
      attribution: field('reported'), commitment: field('rejected') }));
  assert.equal(result.sidecars[0].claimant.value, 'Nora');
  assert.equal(result.sidecars[0].claimant.citations[0].receipt.role, 'user');
  assert.equal(result.items[0].qualification.attribution, 'reported');
});

test('SP6 numeric measurement and chosen limit are separate despite matching numbers', () => {
  const result = compile(input('The gauge measured 42 kPa. For the trial I choose a limit of 42 kPa.'),
    proposition({ content: 'The gauge measured 42 kPa.', subject: field('gauge'), property: field('measured pressure'), value: field('42 kPa') }),
    proposition({ content: 'The speaker chooses a 42 kPa trial limit.', kind: 'decision', role: field('choice'), claimant: field('speaker'),
      property: field('pressure limit'), scope: field('trial'), value: field('42 kPa'), commitment: field('adopted') }));
  assert.deepEqual(result.items.map(item => [item.qualification.slot.property, item.qualification.commitment]),
    [['measured pressure', 'unknown'], ['pressure limit', 'adopted']]);
});

test('SP7 reordered global references bind original receipts and exact spans despite local index collisions', () => {
  const source = input('a'.repeat(400), 'b'.repeat(200), 'c'.repeat(200));
  const prepared = prepareSourcePropositions(source);
  const result = compileSourcePropositions(prepared, output(
    proposition({ content: 'Second source', subject: field('B', [2]) }, [2]),
    proposition({ content: 'First source later span', subject: field('A', [1, 0]) }, [1, 0]),
    proposition({ content: 'Two sources reordered', subject: field('C and A', [3, 0]) }, [3, 0])));
  assert.deepEqual(result.items.map(item => item.receipts.map(receipt => receipt.eventId)),
    [['private-source-1'], ['private-source-0'], ['private-source-2', 'private-source-0']]);
  assert.deepEqual(result.items[0].qualification.anchors[0],
    { receiptIndex: 0, start: 0, end: 200, text: 'b'.repeat(200), fields: ['subject', 'value'] });
  assert.equal(result.items[1].qualification.anchors[1].start, 200);
  assert.equal(result.sidecars[2].role.citations[0].candidateIndex, 3);
  assert.equal(result.sidecars[2].role.citations[0].receiptIndex, 0);
  for (const item of result.items) for (const anchor of item.qualification.anchors)
    assert.equal(item.receipts[anchor.receiptIndex].excerpt.slice(anchor.start, anchor.end), anchor.text);
});

test('SP8 non-BMP canonical source catalog is complete and never splits surrogate pairs', () => {
  const text = 'a'.repeat(199) + '🚋' + 'b'.repeat(599);
  assert.equal(text.length, 800);
  const prepared = prepareSourcePropositions(input(text));
  assert.equal(prepared.request.input.candidates.length, 5);
  assert.equal(prepared.request.input.candidates.map(candidate => candidate.text).join(''), text);
  assert.equal(prepared.request.input.candidates[0].text.length, 199);
  for (const candidate of prepared.request.input.candidates) {
    assert.ok(candidate.text.isWellFormed()); assert.ok(candidate.text.length <= 200);
    const result = compileSourcePropositions(prepared, output(proposition({}, [candidate.candidateIndex])));
    assert.equal(result.items[0].qualification.anchors[0].text, candidate.text);
  }
});

test('SP9 exact response strings and detached original objects survive compilation without mutation', () => {
  const prepared = prepareSourcePropositions(input('A short synthetic source.'));
  const value = output(proposition());
  const text = ` \n${JSON.stringify(value, null, 2)}\n`;
  assert.equal(compileSourcePropositions(prepared, text).originalOutput, text);
  const result = compileSourcePropositions(prepared, value); const before = structuredClone(result);
  value.propositions[0].content = 'mutated'; value.propositions[0].value.evidenceIndices[0] = 999;
  assert.deepEqual(result, before);
  assert.deepEqual(compileSourcePropositions(prepared, output()).items, []);
  assert.deepEqual(compileSourcePropositions(prepared, output()),
    { originalOutput: output(), extractedItems: [], items: [], sidecars: [] });
});

test('SP10 strict malformed, foreign, duplicate, unselected and excessive proposals fail atomically', () => {
  const prepared = prepareSourcePropositions(input('a'.repeat(800), 'b'));
  for (const value of [null, {}, [], 'not json', '{', '\ud800', ' '.repeat(40001),
    { ...output(), extra: true }, output(...Array.from({ length: 6 }, () => proposition())),
    output({ ...proposition(), extra: true }), output({ ...proposition(), receipt: {} })]) invalid(prepared, value);
  const mutations = [
    item => { delete item.content; }, item => { item.content = 'bad\ud800'; }, item => { item.content = 'x'.repeat(601); },
    item => { item.content = ' Ａ '; }, item => { item.kind = 'new-kind'; }, item => { item.confidence = 1.1; },
    item => { item.evidenceIndices = []; }, item => { item.evidenceIndices = [0, 0]; },
    item => { item.evidenceIndices = [5]; }, item => { item.evidenceIndices = [-1]; },
    item => { item.evidenceIndices = ['0']; }, item => { item.evidenceIndices = [0.1]; },
    item => { item.evidenceIndices = [0, 1, 2, 3, 4]; },
    item => { item.subject = field('unsupported', [1]); }, item => { item.role.evidenceIndices = [1]; },
    item => { item.claimant = field('Nora', [1]); }, item => { item.role.value = 'proposal'; },
    item => { item.role = field(null); }, item => { item.commitment = field('adopted'); },
    item => { item.claimant = field(' Ａ '); }, item => { item.claimant = field('x'.repeat(161)); },
  ];
  for (const mutate of mutations) { const item = proposition(); mutate(item); invalid(prepared, output(proposition(), item)); }
  for (const name of fields) {
    for (const replacement of [{}, field(null, [0, 0]), field(null, [999]), { ...field(null), text: 'forged' }])
      invalid(prepared, output(proposition({ [name]: replacement })));
  }
  invalid(prepared, output(proposition({ value: field(null, []), subject: field(null, []) })));
  invalid(prepared, output(proposition({ subject: field('Known', []) })));
  invalid(prepared, output(proposition({ role: field('observation', []) })));
  invalid(prepared, output(proposition({ claimant: field('Known', []) })));
});

test('SP11 unsafe JSON boundaries are refused without executing accessors or toJSON', async () => {
  let callbacks = 0; let reads = 0;
  const model = { contextWindow: 8192, countTokens() { callbacks++; return 1; },
    proposeSourcePropositions() { callbacks++; return output(); } };
  const badInputs = [input('x'.repeat(801)), input(''), input('bad\ud800'), input('a', 'b', 'c', 'd')];
  const getterInput = input('x'); Object.defineProperty(getterInput.messages[0], 'content', { enumerable: true, get() { reads++; return 'x'; } });
  badInputs.push(getterInput, { ...input('x'), toJSON() { reads++; return {}; } });
  const sparse = input('x'); sparse.messages = Array(1); badInputs.push(sparse);
  const cycle = input('x'); cycle.self = cycle; badInputs.push(cycle);
  const symbol = input('x'); symbol[Symbol('hidden')] = 'x'; badInputs.push(symbol);
  badInputs.push(new Proxy(input('x'), { getPrototypeOf() { reads++; return Object.prototype; } }));
  const duplicate = input('x', 'y'); duplicate.messages[1].id = duplicate.messages[0].id; badInputs.push(duplicate);
  for (const source of badInputs) await assert.rejects(buildSourcePropositions(model, source), { code: 'invalid_source_input' });
  assert.equal(callbacks, 0); assert.equal(reads, 0);
  const prepared = prepareSourcePropositions(input('x'));
  const getterOutput = {}; Object.defineProperty(getterOutput, 'propositions', { enumerable: true, get() { reads++; return []; } });
  const badOutputs = [getterOutput, { propositions: [], toJSON() { reads++; return output(); } },
    { propositions: [], extra: undefined }, new Date(), { propositions: [], extra: Infinity }];
  const thenableOutput = output(); Object.defineProperty(thenableOutput, 'then', { get() { reads++; return undefined; } });
  badOutputs.push(thenableOutput, new Proxy(output(), { ownKeys() { reads++; return ['propositions']; } }));
  for (const value of badOutputs) invalid(prepared, value);
  for (const value of badOutputs) await assert.rejects(buildSourcePropositions({ ...model, proposeSourcePropositions: () => value }, input('x')),
    { code: 'invalid_model_output' });
  assert.equal(reads, 0);
});

test('SP12 injected builder makes exactly one bounded call with owned payload and no later pass', async () => {
  let calls = 0; const counted = []; const source = input('The counter measured 7.');
  const result = await buildSourcePropositions({ contextWindow: 8192, countTokens(text) { counted.push(text); return 1; },
    proposeSourcePropositions(request) {
      calls++; assert.equal(request.maxOutputTokens, 1024); assert.ok(request.signal instanceof AbortSignal);
      assert.deepEqual(Object.keys(request.input), ['candidates']);
      request.input.candidates[0].text = 'provider mutation'; source.messages[0].content = 'caller mutation';
      return output(proposition());
    } }, source);
  assert.equal(calls, 1); assert.equal(counted.length, 2);
  assert.equal(result.items[0].receipts[0].excerpt, 'The counter measured 7.');
  assert.equal(JSON.parse(counted[0]).maxOutputTokens, 1024);
});

test('SP13 existing budget, deadline and failure errors remain bounded without retry or fallback', async () => {
  let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1, proposeSourcePropositions() { calls++; return output(); } };
  for (const [override, code] of [[{ contextWindow: 8191 }, 'context_budget_exceeded'],
    [{ countTokens: () => 6001 }, 'context_budget_exceeded'], [{ countTokens: () => NaN }, 'token_count_unavailable'],
    [{ proposeSourcePropositions: undefined }, 'model_not_configured']])
    await assert.rejects(buildSourcePropositions({ ...model, ...override }, input('x')), { code });
  await assert.rejects(buildSourcePropositions(model, input('x'), { expired: () => true }), { code: 'model_timeout' });
  assert.equal(calls, 0);
  await assert.rejects(buildSourcePropositions({ ...model, proposeSourcePropositions() { calls++; throw new Error('private provider detail'); } }, input('x')),
    { code: 'proposition_build_failed' });
  assert.equal(calls, 1);
  let counts = 0;
  await assert.rejects(buildSourcePropositions({ ...model, countTokens: () => ++counts === 1 ? 1 : 1025 }, input('x')),
    { code: 'invalid_model_output' });
});

// The module exports an offline strict schema, not a provider compatibility claim.
// This small validator covers exactly its JSON Schema vocabulary on scripted data.
function matches(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(branch => matches(branch, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    && schema.required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && matches(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems
    && (!schema.uniqueItems || new Set(value).size === value.length) && value.every(item => matches(schema.items, item));
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum;
  throw new Error('unhandled_schema_keyword');
}

test('SP14 offline strict schema accepts scripted wire and refuses unknown fields, invalid references and bounds', () => {
  const { schema } = prepareSourcePropositions(input('x'));
  assert.ok(matches(schema, output())); assert.ok(matches(schema, output(proposition())));
  for (const value of [{ ...output(), extra: true }, output({ ...proposition(), extra: true }),
    output(proposition({}, [1])), output(proposition({}, [0, 0])), output(proposition({ content: 'x'.repeat(601) }))])
    assert.equal(matches(schema, value), false);
  const inspect = node => {
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual(node.required, Object.keys(node.properties)); Object.values(node.properties).forEach(inspect); }
    if (node.items) inspect(node.items); if (node.anyOf) node.anyOf.forEach(inspect);
  };
  inspect(schema);
});

test('SP15 proposed option retains unknown claimant stance without promoting it to consideration', () => {
  const source = input('You could use the eastern path if the gate opens.'); source.messages[0].role = 'assistant';
  const result = compile(source, proposition({ content: 'The assistant proposes the eastern path if the gate opens.', kind: 'context',
    role: field('choice'), claimant: field(null, []), property: field('route option'), value: field('eastern path'),
    applies: field('if the gate opens'), attribution: field('proposed'), commitment: field('unknown', []) }));
  assert.equal(result.items[0].qualification.commitment, 'unknown');
  assert.equal(result.items[0].qualification.attribution, 'proposed');
  assert.equal(result.items[0].qualification.value, 'eastern path');
  assert.equal(result.sidecars[0].claimant.value, null);
  assert.equal(result.sidecars[0].role.citations[0].receipt.role, 'assistant');
});

test('SP16 transient source and segment indices preserve multi-window message grouping and order', () => {
  const source = input('a'.repeat(401), 'b'.repeat(201)); source.messages[1].role = 'assistant';
  const { request } = prepareSourcePropositions(source);
  assert.deepEqual(request.input.candidates.map(({ candidateIndex, sourceIndex, segmentIndex, role }) =>
    [candidateIndex, sourceIndex, segmentIndex, role]), [
    [0, 0, 0, 'user'], [1, 0, 1, 'user'], [2, 0, 2, 'user'],
    [3, 1, 0, 'assistant'], [4, 1, 1, 'assistant'],
  ]);
  for (const sourceIndex of [0, 1]) assert.equal(request.input.candidates.filter(candidate => candidate.sourceIndex === sourceIndex)
    .map(candidate => candidate.text).join(''), source.messages[sourceIndex].content);
  for (const candidate of request.input.candidates)
    assert.deepEqual(Object.keys(candidate).sort(), ['candidateIndex', 'role', 'segmentIndex', 'sourceIndex', 'text']);
});

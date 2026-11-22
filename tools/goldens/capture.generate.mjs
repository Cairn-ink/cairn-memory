import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.ENGINE_DIR) {
  console.error('Usage: ENGINE_DIR=<engine checkout> node tools/goldens/capture.generate.mjs');
  process.exit(2);
}
const load = (name) => import(pathToFileURL(resolve(process.env.ENGINE_DIR, 'core', name + '.mjs')));
const [modelCall, budget, packing, catalog, capture, windows, claims, candidates] = await Promise.all([
  'model-call', 'model-budget', 'model-packing', 'qualification-text-catalog',
  'capture-input', 'source-windows', 'claim-qualification-input', 'qualification-candidates',
].map(load));

const seed = 0x6a09e667;
const families = {
  modelSizing: [], qualificationTextCatalog: [], captureInput: [],
  sourceWindows: [], claimQualificationInput: [], qualificationCandidates: [],
};
function observed(run) {
  try {
    const value = run();
    if (value === undefined) return { returned: 'undefined' };
    if (Object.is(value, -0)) return { returned: 'negative-zero' };
    return { value };
  } catch (error) {
    return { errorCode: typeof error?.code === 'string' ? error.code : null };
  }
}

function record(family, operation, name, args, run, extra = {}) {
  families[family].push({ operation, name, args, ...extra, expected: observed(run) });
}
const runFor = (family) => (module, operation, name, args, extra) =>
  record(family, operation, name, args, () => module[operation](...args), extra);

const size = runFor('modelSizing');
for (const [module, operation] of [
  [modelCall, 'MODEL_INPUT_TOKENS'], [modelCall, 'MODEL_OUTPUT_TOKENS'], [packing, 'TEXT_FLOOR'],
]) {
  record('modelSizing', operation, operation, [], () => module[operation]);
}
size(modelCall, 'modelRequestText', 'keys, unicode and escaped text', [
  '語 😀\n"quoted"', { z: null, a: [{ role: 'user', content: 'a\u0000b' }] },
]);
size(modelCall, 'modelRequestText', 'null input', ['Rules', null]);
size(modelCall, 'modelRequestText', 'undefined input omitted', ['Rules']);

const system = 'Rules';
const emptyLength = modelCall.modelRequestText(system, { text: '' }).length;
for (const contextWindow of [8191, 8192, 16384, 128000]) {
  for (const offset of [-1, 0, 1]) {
    const units = (modelCall.MODEL_INPUT_TOKENS + offset) * 4 - emptyLength;
    const args = [{ contextWindow, counter: 'quarterLength' }, 'extract', system, { repeat: 'x', units }];
    const name = contextWindow + ' context, input limit offset ' + offset;
    const model = { contextWindow, countTokens: (text) => Math.ceil(text.length / 4) };
    const input = { text: args[3].repeat.repeat(args[3].units) };
    if (contextWindow < 8192) {
      // Packing assumes an eligible model. The guarded call supplies the engine's rejection.
      let failure;
      try {
        await modelCall.callModel({ ...model, extract() { throw new Error(); } }, 'extract', system, input);
      } catch (error) { failure = error; }
      if (failure?.code !== 'context_budget_exceeded') throw new Error('Unexpected engine context guard');
      record('modelSizing', 'requestFits', name, args, () => { throw failure; });
    } else {
      record('modelSizing', 'requestFits', name, args, () => packing.requestFits(model, 'extract')(system, input));
    }
  }
}
for (const [name, text] of [['ASCII', 'abc'], ['astral', 'a😀b'], ['CJK', '甲乙丙'], ['lone high surrogate', 'a\uD800b']]) {
  for (let units = 0; units <= text.length + 1; units++) {
    size(packing, 'prefixUnits', name + ' at ' + units, [text, units]);
  }
}
for (const [longest, maximum] of [[800, 119], [800, 120], [800, 621], [799, 800], [119, 120], [120, 120]]) {
  record('modelSizing', 'fittingCap', longest + ' units, fit through ' + maximum, [longest, maximum],
    () => packing.fittingCap(longest, (cap) => cap <= maximum));
}
for (const [name, value] of [
  ['integer', 201], ['negativeZero', -0], ['largestSafeInteger', Number.MAX_SAFE_INTEGER],
  ['fraction', 1.25], ['negative', -1], ['nan', NaN], ['infinity', Infinity],
  ['unsafeInteger', Number.MAX_SAFE_INTEGER + 1], ['numericString', '12'], ['missing', undefined], ['throws', undefined],
]) {
  const model = name === 'missing' ? {} : { countTokens() { if (name === 'throws') throw new Error(); return value; } };
  const counter = ['nan', 'infinity', 'negativeZero', 'missing', 'throws'].includes(name) ? { name } : { name, value };
  record('modelSizing', 'countTokens', name, [counter, 'Count 語 😀'], () => budget.countTokens(model, 'Count 語 😀'));
}

const catalogCase = runFor('qualificationTextCatalog');
const textCatalog = {
  inputMode: 'text-catalog-v1',
  texts: ['cedar', '茶 😀'],
  items: [
    { itemIndex: 3, content: 'Choose cedar', kind: 'decision', candidates: [
      { candidateIndex: 8, role: 'user', textIndex: 0 }, { candidateIndex: 9, role: 'assistant', textIndex: 1 },
    ] },
    { itemIndex: 1, content: 'Same evidence', kind: 'fact', candidates: [
      { candidateIndex: 12, role: 'user', textIndex: 0 },
    ] },
  ],
};
const inlineCatalog = {
  items: textCatalog.items.map((item) => ({
    ...item, candidates: item.candidates.map(({ textIndex, ...candidate }) => ({ ...candidate, text: textCatalog.texts[textIndex] })),
  })),
};
catalogCase(catalog, 'snapshotQualificationTextCatalog', 'shared text across items', [textCatalog]);
catalogCase(catalog, 'createQualificationTextCatalog', 'canonical first occurrence', [inlineCatalog]);
for (const [name, mutate] of [
  ['extra root field', (input) => { input.extra = true; }],
  ['missing items', (input) => { delete input.items; }],
  ['wrong mode', (input) => { input.inputMode = 'inline'; }],
  ['empty text array', (input) => { input.texts = []; }],
  ['duplicate text', (input) => { input.texts[1] = input.texts[0]; }],
  ['unused text', (input) => { input.texts.push('unused'); }],
  ['out of order first occurrence', (input) => { input.items[0].candidates[0].textIndex = 1; }],
  ['text index out of range', (input) => { input.items[0].candidates[0].textIndex = 2; }],
  ['duplicate item index', (input) => { input.items[1].itemIndex = input.items[0].itemIndex; }],
  ['duplicate candidate index', (input) => { input.items[1].candidates[0].candidateIndex = 8; }],
  ['invalid kind', (input) => { input.items[0].kind = 'unknown'; }],
  ['invalid role', (input) => { input.items[0].candidates[0].role = 'unknown'; }],
  ['negative index', (input) => { input.items[0].itemIndex = -1; }],
  ['overlong text', (input) => { input.texts[0] = 'x'.repeat(201); }],
  ['overlong item', (input) => { input.items[0].content = 'x'.repeat(601); }],
  ['lone surrogate', (input) => { input.texts[0] = '\uD800'; }],
  ['empty candidates', (input) => { input.items[0].candidates = []; }],
]) {
  const input = structuredClone(textCatalog);
  mutate(input);
  catalogCase(catalog, 'snapshotQualificationTextCatalog', name, [input]);
}
catalogCase(catalog, 'createQualificationTextCatalog', 'empty inline items', [{ items: [] }]);
catalogCase(catalog, 'createQualificationTextCatalog', 'invalid inline text', [{
  items: [{ ...inlineCatalog.items[0], candidates: [{ candidateIndex: 0, role: 'user', text: '' }] }],
}]);

const now = '2025-03-04T10:00:00.000Z';
const occurredAt = '2025-03-04T09:59:58.000Z';
const token = 'sk-synthetic00000000000';
const pem = '-----BEGIN PRIVATE KEY-----\nsynthetic material\n-----END PRIVATE KEY-----';
const words = ['cedar', 'tea', '石頭', '小路', 'quiet', 'map', 'ＡＢＣ', '😀'];
let random = seed;
function nextWord() {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  return words[random >>> 29];
}
function messages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: 'm' + index, role: index % 4 === 3 ? 'assistant' : 'user',
    content: nextWord() + ' ' + nextWord() + ' ' + index,
  }));
}
const message = (content, extra = {}) => ({ id: 'm0', role: 'user', content, ...extra });
const envelope = (source, extra = {}) => ({
  namespace: { ownerId: 'owner', scope: 'personal', projectId: '' },
  client: 'client', eventId: 'batch', sessionId: 'conversation', messages: source, ...extra,
});
const inputCase = runFor('captureInput');
const snapshotCase = (name, source, { qualification = null, policy = null, retainTimes = true, secret, extra } = {}) =>
  inputCase(capture, 'captureSnapshot', name, [envelope(source, extra), qualification, policy, retainTimes, now],
    secret ? { secret } : {});
const messageCounts = [1, 5, 24, 25, 240];
const corpus = new Map(messageCounts.map((count) => [count, messages(count)]));
for (const qualification of [null, 'source-bound-v1', 'source-bound-v2']) {
  for (const withTime of [false, true]) {
    for (const [count, source] of corpus) {
      snapshotCase([qualification ?? 'plain', withTime ? 'with time' : 'without time', count].join(' '),
        withTime ? source.map((message) => ({ ...message, occurredAt })) : source, { qualification });
    }
  }
}
for (const [name, source, options] of [
  ['ASCII whitespace', [message(' plain \n ASCII ')], {}],
  ['CJK', [message(' 觀察 山路 ')], {}],
  ['fullwidth NFKC', [message(' ＡＢＣ　１２３ ')], {}],
  ['lone surrogate with plain snapshot', [message('a\uD800b')], {}],
  ['lone surrogate with qualification', [message('a\uD800b')], { qualification: 'source-bound-v1' }],
  ['lone surrogate with indexed evidence', [message('a\uDC00b')], { policy: 'indexed-evidence-v1' }],
  ['NUL', [message('a\u0000b')], {}],
  ['exact message bound', [message('x'.repeat(4000))], {}],
  ['message over bound', [message('x'.repeat(4001))], {}],
  ['raw input over bound', [message(' '.repeat(20000) + 'x')], {}],
  ['aggregate over bound', Array.from({ length: 6 }, (_, i) => message('山'.repeat(3500), { id: 'long' + i })), {}],
  ['duplicate ids', [message('one'), message('two')], {}],
  ['empty batch', [], {}],
  ['invalid role', [message('note', { role: 'other' })], {}],
  ['invalid identifier', [message('note', { id: ' m0' })], {}],
  ['null occurredAt', [message('note', { occurredAt: null })], { qualification: 'source-bound-v2' }],
  ['invalid occurredAt', [message('note', { occurredAt: '2025-02-30T10:00:00.000Z' })], {}],
  ['future time at bound', [message('note', { occurredAt: '2025-03-04T10:05:00.000Z' })], {}],
  ['future time over bound', [message('note', { occurredAt: '2025-03-04T10:05:00.001Z' })], {}],
  ['do not retain time', [message('note', { occurredAt })], { retainTimes: false }],
  ['ordered source', [message('note')], { extra: { causal: { streamId: 'stream', sequence: 1 } } }],
  ['invalid causal sequence', [message('note')], { extra: { causal: { streamId: 'stream', sequence: 0 } } }],
  ['indexed windows', [message('note')], { qualification: 'source-bound-v2', policy: 'indexed-windows-v1' }],
  ['indexed evidence', [message('note')], { policy: 'indexed-evidence-v1' }],
  ['synthetic token in plain source', [message('note ' + token)], { secret: true }],
  ['synthetic token in qualified source', [message('note ' + token, { occurredAt })], { qualification: 'source-bound-v2', secret: true }],
  ['synthetic token alone', [message(token)], { qualification: 'source-bound-v1', secret: true }],
  ['synthetic key block', [message('sample\n' + pem + '\nend')], { secret: true }],
]) {
  snapshotCase(name, source, options);
}

const basicSnapshot = capture.captureSnapshot(envelope([
  message('I choose cedar 😀', { occurredAt }),
  message('A tea note', { id: 'm1', role: 'assistant' }),
]), 'source-bound-v2', undefined, true, now);
const retainedCase = (name, source, extra) => inputCase(capture, 'retainedSourceView', name, [{ messages: source }], extra);
retainedCase('omit occurrence time', basicSnapshot.messages);
retainedCase('800 unit boundary and astral truncation', [
  message('山'.repeat(800)), message('x'.repeat(799) + '😀z', { id: 'm1' }),
  message('x'.repeat(799) + ' z', { id: 'm2' }),
]);
retainedCase('malformed message text', [message('a\u0000b')]);
retainedCase('synthetic token in retained text', [message('note ' + token)], { secret: true });

const grouped = Array.from({ length: 30 }, (_, index) => ({ role: 'user', messageIndex: index % 7 }));
for (const [name, source] of [
  ...[...corpus].map(([count, source]) => ['message count ' + count, source]),
  ['group duplicate windows', grouped], ['assistant only', [{ role: 'assistant' }]], ['no input', undefined],
  ['non-array input', {}],
]) {
  for (const operation of ['extractionLimit', 'extractionOutputTokens']) {
    inputCase(capture, operation, name, source === undefined ? [] : [source]);
  }
}

const extracted = { content: 'Choose cedar', kind: 'decision', confidence: 0.8, sourceIndices: [0] };
const extractedCase = (name, output, { snapshot = basicSnapshot, retainedMessages, sourceReceipts, limit, secret } = {}) => {
  const reasons = [];
  // JSON preserves supplied optional values and leaves absent arguments to the replay caller.
  const args = [output, snapshot, { retainedMessages, sourceReceipts, limit }];
  record('captureInput', 'extractedItems', name, args,
    () => capture.extractedItems(output, snapshot, retainedMessages, (reason) => reasons.push(reason), sourceReceipts, limit),
    { reasons, ...(secret ? { secret } : {}) });
};
extractedCase('valid extraction', { items: [extracted, { ...extracted, confidence: 0, sourceIndices: [1, 0] }] });
extractedCase('no extracted items', { items: [] });
extractedCase('retained sources, rewritten receipt identity and chronology', { items: [extracted] }, {
  snapshot: { ...basicSnapshot, causal: { streamId: 'stream', sequence: 1 } },
  retainedMessages: [{ ...basicSnapshot.messages[0], content: 'I choose' }],
  sourceReceipts: [{ client: 'previous', sessionId: 'earlier' }], limit: 1,
});
extractedCase('valid procedural proposal', {
  items: [{ ...extracted, kind: 'instruction', procedural: true }],
}, { snapshot: { ...basicSnapshot, sessionEpisodes: true } });
extractedCase('invalid output shape', { items: [], extra: true });
extractedCase('over extraction limit', { items: [extracted, extracted] }, { limit: 1 });
extractedCase('invalid item shape', { items: [{ ...extracted, extra: true }] });
extractedCase('invalid procedural proposal', { items: [{ ...extracted, procedural: true }] },
  { snapshot: { ...basicSnapshot, sessionEpisodes: true } });
extractedCase('invalid text', { items: [{ ...extracted, content: 'a\uD800b' }] });
extractedCase('overlong item text', { items: [{ ...extracted, content: 'x'.repeat(601) }] });
extractedCase('invalid value', { items: [{ ...extracted, confidence: 1.1 }] });
extractedCase('invalid source shape', { items: [{ ...extracted, sourceIndices: [] }] });
extractedCase('duplicate source index', { items: [{ ...extracted, sourceIndices: [0, 0] }] });
extractedCase('source index out of range', { items: [{ ...extracted, sourceIndices: [2] }] });
extractedCase('synthetic token in extracted content', { items: [{ ...extracted, content: 'Keep ' + token }] }, { secret: true });

const windowCase = runFor('sourceWindows');
const windowSnapshot = {
  ...basicSnapshot, causal: { streamId: 'stream', sequence: 1 },
  messages: [
    message('山'.repeat(799) + '😀z'),
    message('x'.repeat(799) + ' ' + 'y'.repeat(800), { id: 'm1', role: 'assistant' }),
    message('a'.repeat(800), { id: 'm2' }),
  ],
};
windowCase(windows, 'sourceWindowCatalog', 'astral, whitespace, and exact 800-unit boundaries', [windowSnapshot]);
windowCase(windows, 'sourceWindowCatalog', 'empty source list', [{ messages: [] }]);
windowCase(windows, 'sourceWindowCatalog', 'whitespace-only slice', [{ messages: [message('x'.repeat(800) + ' '.repeat(800) + 'z')] }]);
windowCase(windows, 'sourceWindowCatalog', 'noncanonical excerpt', [{ messages: [message('ＦＯＯ')] }]);
windowCase(windows, 'sourceWindowCatalog', 'NUL in excerpt', [{ messages: [message('a\u0000b')] }]);
windowCase(windows, 'sourceWindowCatalog', '64 window boundary', [{
  messages: Array.from({ length: 64 }, (_, index) => message('x', { id: 'w' + index })),
}]);
windowCase(windows, 'sourceWindowCatalog', '65 windows rejected', [{
  messages: Array.from({ length: 65 }, (_, index) => message('x', { id: 'w' + index })),
}]);
windowCase(windows, 'sourceWindowCatalog', 'synthetic token in noncanonical excerpt', [
  { messages: [message('note ' + token)] },
], { secret: true });

const repeatedWindow = { ...basicSnapshot, messages: [message('x'.repeat(1600))] };
const windowSelections = [
  ['valid window selection', { items: [{ ...extracted, sourceIndices: [4, 1] }] }, windowSnapshot],
  ['causal indices refer to messages', { items: [{ ...extracted, sourceIndices: [0, 1, 2] }] }, windowSnapshot],
  ['no selected windows', { items: [] }, windowSnapshot],
  ['invalid output shape', null, windowSnapshot],
  ['invalid selected window index', { items: [{ ...extracted, sourceIndices: [5] }] }, windowSnapshot],
  ['duplicate selected window index', { items: [{ ...extracted, sourceIndices: [0, 0] }] }, windowSnapshot],
  ['different windows with duplicate receipt identity', { items: [{ ...extracted, sourceIndices: [0, 1] }] }, repeatedWindow],
];
for (const [name, output, snapshot] of windowSelections) {
  const sourceCatalog = windows.sourceWindowCatalog(snapshot);
  const reasons = [];
  record('sourceWindows', 'extractedWindowItems', name, [output, snapshot, sourceCatalog],
    () => windows.extractedWindowItems(output, snapshot, sourceCatalog, (reason) => reasons.push(reason)), { reasons });
}

const source = (excerpt, extra = {}) => ({
  client: 'client', sessionId: 'conversation', eventId: 'm0', role: 'user', excerpt, ...extra,
});
const claimCase = runFor('claimQualificationInput');
const receipt = source('I choose cedar 😀', { occurredAt });
for (const [name, content, receipts, secret] of [
  ['known sources', 'Choose cedar', [receipt]],
  ['empty content accepted', '', [receipt]],
  ['lone surrogate in content', 'a\uD800', [receipt]],
  ['lone surrogate in excerpt', 'Choose cedar', [source('a\uDC00')]],
  ['missing receipts', 'Choose cedar', []],
  ['too many receipts', 'Choose cedar', Array(5).fill(receipt)],
  ['non-string identity', 'Choose cedar', [source('note', { eventId: 1 })]],
  ['invalid receipt time', 'Choose cedar', [source('note', { occurredAt: 'yesterday' })]],
  ['extra receipt field', 'Choose cedar', [source('note', { extra: true })]],
  ['synthetic token text is well formed', 'note ' + token, [source('note ' + token)], true],
]) {
  claimCase(claims, 'qualificationSources', name, [content, receipts], secret ? { secret } : {});
}
const claim = {
  version: 1, slot: { subject: 'I', property: 'choice', scope: null, applies: null },
  value: 'cedar', attribution: 'direct', commitment: 'adopted',
  anchors: [{
    receiptIndex: 0, start: 0, end: receipt.excerpt.length, text: receipt.excerpt,
    fields: ['commitment', 'value', 'property', 'subject', 'attribution'],
  }],
};
claimCase(claims, 'qualificationInput', 'canonical field ordering and whole astral source', [claim, [receipt]]);
for (const [name, mutate] of [
  ['invalid version', (input) => { input.version = 2; }],
  ['noncanonical slot label', (input) => { input.slot.subject = 'Ｉ'; }],
  ['label over bound', (input) => { input.slot.scope = 'x'.repeat(121); }],
  ['unknown attribution enum', (input) => { input.attribution = 'other'; }],
  ['missing declared coverage', (input) => { input.anchors[0].fields.pop(); }],
  ['invalid field name', (input) => { input.anchors[0].fields.push('other'); }],
  ['duplicate field name', (input) => { input.anchors[0].fields.push('value'); }],
  ['missing anchors', (input) => { input.anchors = []; }],
  ['receipt index out of range', (input) => { input.anchors[0].receiptIndex = 1; }],
  ['mismatched source text', (input) => { input.anchors[0].text = 'Different'; }],
  ['end out of range', (input) => { input.anchors[0].end += 1; }],
  ['end splits astral pair', (input) => { input.anchors[0].end -= 1; input.anchors[0].text = receipt.excerpt.slice(0, -1); }],
  ['duplicate anchor', (input) => { input.anchors.push({ ...input.anchors[0] }); }],
]) {
  const input = structuredClone(claim);
  mutate(input);
  claimCase(claims, 'qualificationInput', name, [input, [receipt]]);
}
claimCase(claims, 'qualificationInput', 'identical sources differing only in time', [
  { ...claim, anchors: [claim.anchors[0], { ...claim.anchors[0], receiptIndex: 1 }] },
  [receipt, { ...receipt, occurredAt: null }],
]);
claimCase(claims, 'qualificationInput', 'synthetic token in a descriptive label', [
  { ...claim, value: token }, [receipt],
], { secret: true });

const candidateCase = runFor('qualificationCandidates');
const item = (content, receipts, extra = {}) => ({ content, kind: 'decision', confidence: 0.8, receipts, ...extra });
const candidateItems = [
  item('Choose cedar', [source('山'.repeat(199) + '😀' + 'x'.repeat(560)), source('Another cedar note', { eventId: 'm1' })],
    { proceduralProposal: true }),
  item('Choose tea', [source('I choose tea', { eventId: 'm2' })]),
];
for (const [name, items, secret] of [
  ['multi-item offsets and 200-unit astral boundary', candidateItems],
  ['receipt whitespace detached and canonicalized', [item('Choose cedar', [source('note ')])]],
  ['maximum item and receipt count', Array.from({ length: 5 }, () => item('Keep notes', Array(4).fill(source('note'))))],
  ['non-array items', {}],
  ['empty items', []],
  ['too many items', Array(6).fill(candidateItems[0])],
  ['null item', [null]],
  ['missing item content', [{ receipts: [receipt] }]],
  ['noncanonical content', [item(' Ａ ', [receipt])]],
  ['lone surrogate in content', [item('a\uD800', [receipt])]],
  ['overlong content', [item('x'.repeat(601), [receipt])]],
  ['missing receipts', [item('Choose cedar', [])]],
  ['too many receipts', [item('Choose cedar', Array(5).fill(receipt))]],
  ['unexpected receipt shape', [item('Choose cedar', [source('note', { extra: true })])]],
  ['overlong excerpt', [item('Choose cedar', [source('x'.repeat(801))])]],
  ['invalid receipt text', [item('Choose cedar', [source('a\u0000b')])]],
  ['synthetic token in noncanonical item content', [item('Note ' + token, [receipt])], true],
  ['synthetic token normalized before evidence chunking', [item('Choose cedar', [source('Note ' + token)])], true],
]) {
  candidateCase(candidates, 'createQualificationCandidateSnapshot', name, [items], secret ? { secret } : {});
}

const candidateSnapshot = candidates.createQualificationCandidateSnapshot(candidateItems);
const field = (value, ...evidenceIndices) => ({ value, evidenceIndices });
const entry = (itemIndex, candidateIndex) => ({
  itemIndex, subject: field('Ｉ', candidateIndex), property: field('choice', candidateIndex),
  scope: field(null), applies: field(null), value: field('cedar', candidateIndex),
  attribution: field('direct', candidateIndex), commitment: field('adopted', candidateIndex),
});
const lastCandidate = candidateSnapshot.candidates[1][0].candidateIndex;
const output = { qualifications: [entry(1, lastCandidate), entry(0, 0)] };
candidateCase(candidates, 'compileQualificationCandidates', 'valid reversed items with NFKC labels', [output, candidateSnapshot]);
const sortedOutput = structuredClone(output);
sortedOutput.qualifications[1].value = field('cedar', 2, 0, 1);
candidateCase(candidates, 'compileQualificationCandidates', 'sort anchors by selected evidence index', [sortedOutput, candidateSnapshot]);

for (const [name, mutate] of [
  ['extra output key', (value) => { value.extra = true; }],
  ['missing output key', (value) => { delete value.qualifications; }],
  ['non-array qualifications', (value) => { value.qualifications = {}; }],
  ['wrong qualification count', (value) => { value.qualifications.pop(); }],
  ['extra entry key', (value) => { value.qualifications[1].extra = true; }],
  ['unexpected procedural field', (value) => { value.qualifications[1].procedural = { evidenceIndices: [0] }; }],
  ['missing field', (value) => { delete value.qualifications[1].commitment; }],
  ['invalid item binding', (value) => { value.qualifications[1].itemIndex = 2; }],
  ['duplicate item binding', (value) => { value.qualifications[1].itemIndex = 1; }],
  ['noninteger item binding', (value) => { value.qualifications[1].itemIndex = 0.5; }],
  ['extra field member', (value) => { value.qualifications[1].scope.extra = true; }],
  ['missing field member', (value) => { delete value.qualifications[1].scope.value; }],
  ['non-array citations', (value) => { value.qualifications[1].scope.evidenceIndices = {}; }],
  ['citation budget for a field', (value) => { value.qualifications[1].value = field('cedar', 0, 1, 2, 3, 4); }],
  ['citation budget across fields', (value) => {
    value.qualifications[1].subject = field('I', 0, 1);
    value.qualifications[1].value = field('cedar', 2, 3, 4);
  }],
  ['duplicate citation', (value) => { value.qualifications[1].value = field('cedar', 0, 0); }],
  ['citation for another item', (value) => { value.qualifications[1].value = field('cedar', lastCandidate); }],
  ['noninteger citation', (value) => { value.qualifications[1].value = field('cedar', 0.5); }],
  ['missing citation for known value', (value) => { value.qualifications[1].value = field('cedar'); }],
  ['no selected evidence', (value) => {
    for (const key of ['subject', 'property', 'scope', 'applies', 'value']) value.qualifications[1][key] = field(null);
    for (const key of ['attribution', 'commitment']) value.qualifications[1][key] = field('unknown');
  }],
  ['non-string label', (value) => { value.qualifications[1].value = field(7, 0); }],
  ['lone surrogate label', (value) => { value.qualifications[1].value = field('\uD800', 0); }],
  ['overlong label', (value) => { value.qualifications[1].value = field('x'.repeat(161), 0); }],
  ['NFKC expansion over label limit', (value) => { value.qualifications[1].value = field('㍿'.repeat(41), 0); }],
  ['noncanonical whitespace', (value) => { value.qualifications[1].value = field(' cedar ', 0); }],
  ['unknown attribution enum', (value) => { value.qualifications[1].attribution = field('other', 0); }],
  ['unknown commitment enum', (value) => { value.qualifications[1].commitment = field('other', 0); }],
]) {
  const value = structuredClone(output);
  mutate(value);
  candidateCase(candidates, 'compileQualificationCandidates', name, [value, candidateSnapshot]);
}

const fixture = new URL('../../packages/core/test/fixtures/capture/engine-goldens.json', import.meta.url);
const lines = Object.entries(families).map(([name, cases]) =>
  '    ' + JSON.stringify(name) + ': [\n' + cases.map((entry) => '      ' + JSON.stringify(entry)).join(',\n') + '\n    ]');
const json = '{\n  "seed": ' + seed + ',\n  "families": {\n' + lines.join(',\n') + '\n  }\n}\n';
if (Buffer.byteLength(json) >= 1_000_000) throw new Error('Capture goldens exceed the fixture size limit');
writeFileSync(fixture, json);

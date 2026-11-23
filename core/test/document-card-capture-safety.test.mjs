import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryDocumentCardPort, documentPiece, routeDocumentCards } from '../document-card.mjs';
import { fixture, ns, ok, completed, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const empty = () => ({ items: [] });
const note = value => ({ content: value, kind: 'fact', confidence: .9, sourceIndices: [0] });
const document = 'Quartz gasket instructions\n- Fit the gasket\n- Inspect the seal\n' + 'Repeat after inspection. '.repeat(9);
const ordinary = (input, eventId) => ({ namespace: input.namespace, client: input.client, sessionId: input.sessionId, eventId,
  messages: input.messages.map(({ id, role, content }) => ({ id, role, content })) });

test('the line-kept body omits secrets redacted from the Raw projection', async t => {
  const port = createInMemoryDocumentCardPort();
  const f = fixture(t, { coreOptions: { cardPort: port }, model: { extract: empty } });
  const pem = '-----BEGIN PRIVATE  KEY-----\nSyntheticPrivateMaterial\n-----END PRIVATE  KEY-----';
  const assignment = 'password = samplePassword987';
  completed(await f.core.captureRaw(request(splitRaw(document + '\n  ' + pem + '\n  ' + assignment)[0])));
  const shown = f.calls.find(call => call.method === 'extract').input.messages[0].content;
  assert.doesNotMatch(shown, /SyntheticPrivateMaterial|samplePassword987/);
  const [card] = port.list(ns);
  assert.match(card.body, /^Quartz gasket instructions\n- Fit the gasket\n/);
  assert.doesNotMatch(card.body, /PRIVATE  KEY|SyntheticPrivateMaterial|samplePassword987/);
  assert.match(card.body, /\n  \[REDACTED\]\n  password = \[REDACTED\]/);
});

test('an allowed evidence window cannot authorize a whole card with an excluded window', async t => {
  let ordinal = 0;
  const f = fixture(t, { lineage: true, coreOptions: { captureSourcePolicy: 'indexed-evidence-v1' },
    model: { extract: () => ({ items: [note('Window assertion ' + ++ordinal)] }) } });
  const input = request(splitRaw('A'.repeat(800) + 'B'.repeat(800))[0]);
  const [first] = completed(await f.core.captureRaw(input)).admission.memories;
  ok(f.core.forget({ namespace: ns, memoryId: first.id, expectedRevision: first.revision }));
  const port = createInMemoryDocumentCardPort();
  const writer = openMemoryCore({ path: f.path, model: f.model, cardPort: port, captureSourcePolicy: 'indexed-evidence-v1' });
  f.workspace.defer(() => writer.close());
  const captured = ok(await writer.capture(ordinary(input, 'new-event')));
  assert.equal(captured.admission.memories.length, 1);
  assert.equal(f.calls.filter(call => call.method === 'extract').at(-1).input.messages[0].content, 'B'.repeat(800));
  assert.deepEqual(port.list(ns), []);
});

test('a card tombstone survives capture of the same Raw message through ordinary capture', async t => {
  const port = createInMemoryDocumentCardPort();
  const f = fixture(t, { coreOptions: { cardPort: port }, model: { extract: empty } });
  const input = request(splitRaw(document)[0]);
  completed(await f.core.captureRaw(input));
  const [card] = port.list(ns);
  assert.ok(card);
  assert.equal(ok(f.core.forgetCard({ namespace: ns, cardId: card.id })).forgotten, true);
  ok(await f.core.capture(ordinary(input, 'new-event')));
  assert.deepEqual(port.list(ns), []);
});

test('a failed card put preserves admission and lets the next card publish', async t => {
  const port = createInMemoryDocumentCardPort(), attempted = [];
  const workspace = createTestWorkspace(t);
  const warning = t.mock.method(process, 'emitWarning', () => {});
  const core = openMemoryCore({ path: workspace.path + '/store.sqlite', cardPort: { ...port, put(namespace, card) {
    attempted.push(card.source.messageId);
    if (attempted.length === 1) throw Error('private adapter detail');
    port.put(namespace, card);
  } }, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [note('Use the quartz gasket.')] }) } });
  workspace.defer(() => core.close());
  const result = ok(await core.capture({ namespace: ns, client: 'sample', sessionId: 'session', eventId: 'capture',
    messages: ['first', 'second'].map(id => ({ id, role: 'user', content: document })) }));
  assert.equal(result.admission.memories.length, 1);
  assert.deepEqual(attempted, ['first', 'second']);
  assert.deepEqual(port.list(ns).map(card => card.source.messageId), ['second']);
  const diagnostics = warning.mock.calls.filter(({ arguments: [, options] }) => options?.code === 'document_card_write_failed');
  assert.equal(diagnostics.length, 1);
  assert.doesNotMatch(diagnostics[0].arguments[0], /private adapter detail|Quartz/);
});

test('routing counts trailing whitespace before trimming the stored body', () => {
  const text = 'a'.repeat(799) + ' ';
  const { cards } = routeDocumentCards(ns, 'sample', 'session', [{ id: 'message', role: 'assistant', content: text }]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].body, text.trimEnd());
});

test('the window tries the original left and right bounds in order', () => {
  const left = 'a'.repeat(200), right = 'b'.repeat(200);
  const body = ['# H', left, 'target', right].join('\n');
  assert.deepEqual(documentPiece(body, 'target', 1200, text => text.length),
    { body: ['# H', '…', 'target', right].join('\n'), piece: 'window' });
});

test('an ambiguous redaction mapping drops the card without dropping capture', async t => {
  const port = createInMemoryDocumentCardPort();
  const f = fixture(t, { coreOptions: { cardPort: port }, model: { extract: empty } });
  const key = value => '-----BEGIN PRIVATE  KEY-----\n' + value + '\n-----END PRIVATE  KEY-----';
  const text = document + '\n' + key('first divider material') + ' divider ' + key('second material');
  const result = completed(await f.core.captureRaw(request(splitRaw(text)[0])));
  assert.equal(result.documentCards.droppedRedaction, 1);
  assert.deepEqual(port.list(ns), []);
  const shown = f.calls.find(call => call.method === 'extract').input.messages[0].content;
  assert.doesNotMatch(shown, /first divider material|second material/);
});

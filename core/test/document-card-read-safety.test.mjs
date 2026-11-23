import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryDocumentCardPort, routeDocumentCards } from '../document-card.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { controlledClock } from '../testing/context-read-assembly-fixture.mjs';
import { host, ns, ok, policy } from '../testing/context-read-core-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { fixture as rawFixture, request, splitRaw, completed } from '../testing/raw-capture-fixtures.mjs';

const query = 'Quartz gasket';
const body = 'Quartz gasket instructions\n- Fit the gasket\n- Inspect the seal\n' + 'Repeat after inspection. '.repeat(9);
const counter = { id: 'sample', countTokens: text => Math.ceil(text.length / 4) };
const cardItem = pack => pack.metered.items.find(item => item.channel === 'document-card-v1');
const note = { content: 'The fixture uses a brass washer.', kind: 'fact' };
const revised = { content: 'The fixture uses a steel washer.', kind: 'fact' };
const proof = (excerpt, eventId = 'proof') => ({ client: 'sample', sessionId: 'independent', eventId, role: 'user', excerpt });
const guard = memory => ({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision });

function setup(t, { path, cardPort = createInMemoryDocumentCardPort(), contextOptions } = {}) {
  const workspace = createTestWorkspace(t);
  path ??= workspace.path + '/store.sqlite';
  const trusted = host();
  const open = (options = {}) => {
    const core = openMemoryCore({ path, contextRead: { version: 'context-read-v1', authority: trusted.authority,
      counter, ...contextOptions }, ...options });
    workspace.defer(() => core.close());
    return core;
  };
  const core = open({ cardPort, model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [{ ...note, confidence: .9, sourceIndices: [0] }] }) } });
  const capture = async (id = 'first') => {
    const result = ok(await core.capture({ namespace: ns, client: 'sample', sessionId: 'session', eventId: id,
      messages: [{ id, role: 'user', content: body }] }));
    return result.admission.memories[0];
  };
  const add = (namespace = ns) => {
    const { cards: [card] } = routeDocumentCards(namespace, 'sample', 'session', [{ id: 'sample', role: 'user', content: body }]);
    cardPort.put(namespace, card);
    return card;
  };
  const read = async (reader = core, patch = {}) => ok(await trusted.call(reader, 'contextRead', { query, types: ['memory'],
    readSet: [ns], intent: 'current', raw: false, representation: 'memory-compact-v1', deadlineMs: 1000,
    budget: { maxItems: 2, maxTokens: 1600 }, ...patch }));
  const correct = (memory, text = revised.content, writer = core) =>
    ok(writer.correct({ ...guard(memory), content: text, kind: 'fact', receipt: proof(text, 'corrected') })).memory;
  const supersede = (memory, replacement = revised) =>
    ok(core.supersede({ ...guard(memory), replacement, receipts: [proof(replacement.content, 'replacement')] })).memory;
  return { trusted, open, core, capture, add, read, correct, supersede, cardPort };
}

test('a Raw span forgotten through a separately admitted memory cannot be read or embedded', async t => {
  const port = createInMemoryDocumentCardPort();
  const raw = rawFixture(t, { lineage: true, coreOptions: { cardPort: port }, model: { extract: () => ({ items: [] }) } });
  const input = request(splitRaw(body)[0], { namespace: ns });
  completed(await raw.core.captureRaw(input));
  const [card] = port.list(ns);
  assert.deepEqual(card.sourceMemoryIds, []);
  const f = setup(t, { path: raw.path, cardPort: port });
  assert.equal(cardItem(await f.read()).id, card.id);
  const memory = ok(raw.core.admit({ namespace: ns, memory: note,
    receipts: [{ client: input.client, sessionId: input.sessionId, eventId: input.messages[0].id, role: 'user',
      excerpt: body.replace(/\s+/gu, ' ').trim() }] })).memory;
  ok(raw.core.forget(guard(memory)));
  assert.equal(raw.db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n, 1);
  assert.equal(raw.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n, 0);
  const embedded = [];
  const reader = f.open({ cardPort: port, contextRead: { version: 'context-read-v1', authority: f.trusted.authority, counter, policy: policy(),
    embedder: { id: 'sample', revision: 'one', dimensions: 2, normalization: 'none',
      embed: texts => { embedded.push(...texts); return texts.map(() => [1, 0]); } } } });
  assert.equal(cardItem(await f.read(reader)), undefined);
  await setImmediate();
  assert.equal(embedded.some(text => text.includes('instructions')), false);
});

test('a corrected replacement uses its current text and a historical replacement never uses its old text', async t => {
  const f = setup(t);
  const first = await f.capture();
  let next = f.supersede(first);
  assert.equal(cardItem(await f.read()).replacements[0].content, revised.content);
  next = f.correct(next, 'The fixture uses a nylon washer.');
  const corrected = cardItem(await f.read());
  assert.equal(corrected.stale, true);
  assert.deepEqual(corrected.replacements.map(({ revision, content }) => [revision, content]), [[next.revision, next.content]]);
  const latest = f.supersede(next, { ...revised, content: 'The fixture uses a copper washer.' });
  const superseded = cardItem(await f.read());
  assert.equal(superseded.stale, true);
  assert.match(superseded.precedence, /take precedence/);
  assert.ok((superseded.replacements ?? []).every(value => value.content === latest.content));
});

test('a suppressed replacement leaves the stale marker without its content', async t => {
  const safety = safetyFixture(t);
  await safety.migrate();
  const f = setup(t, { path: safety.path });
  const next = f.supersede(await f.capture());
  const db = safety.connect();
  safety.workspace.defer(() => db.close());
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: next.id,
    reason: 'user_forget', actionId: 'suppress' }));
  const card = cardItem(await f.read());
  assert.equal(card.stale, true);
  assert.match(card.precedence, /take precedence/);
  assert.deepEqual(card.replacements ?? [], []);
});

test('a correction through a handle without a port still makes the card stale', async t => {
  const f = setup(t);
  const memory = await f.capture();
  f.correct(memory, revised.content, f.open());
  assert.equal(f.cardPort.list(ns)[0].stale, undefined);
  const card = cardItem(await f.read());
  assert.equal(card.stale, true);
  assert.match(card.precedence, /take precedence/);
});

test('the read refuses a card with a missing source memory', async t => {
  const port = createInMemoryDocumentCardPort();
  const f = setup(t, { cardPort: { ...port, list: namespace => port.list(namespace).map(card => ({ ...card, sourceMemoryIds: ['missing'] })),
    get: (namespace, id) => ({ ...port.get(namespace, id), sourceMemoryIds: ['missing'] }) } });
  f.add();
  assert.equal(cardItem(await f.read()), undefined);
});

for (const method of ['hide', 'markStale']) test('a failed ' + method + ' preserves the committed result and later publications', async t => {
  const stored = createInMemoryDocumentCardPort(), calls = [];
  const port = { ...stored, [method](...args) {
    calls.push(args[1]);
    if (calls[0] === args[1]) throw Error('private adapter detail');
    return stored[method](...args);
  } };
  const f = setup(t, { cardPort: port });
  const first = await f.capture();
  const memory = await f.capture('second');
  assert.equal(memory.id, first.id);
  if (method === 'hide') assert.equal(ok(f.core.forget(guard(memory))).forgotten, true);
  else assert.equal(f.correct(memory).content, revised.content);
  assert.equal(calls.length, 2);
  const pack = await f.read();
  if (method === 'hide') assert.equal(cardItem(pack), undefined);
  else {
    assert.equal(cardItem(pack).id, calls[0]);
    assert.equal(cardItem(pack).stale, true);
  }
});

test('the reader checks the stored namespace and deterministic id independently of the port', async t => {
  const stored = createInMemoryDocumentCardPort();
  const other = { ...ns, scope: 'project', projectId: 'other-project' };
  let pretend = false;
  const project = card => pretend ? { ...card, namespace: ns } : card;
  const f = setup(t, { cardPort: { ...stored, list: () => stored.list(other).map(project),
    get: (_, id) => project(stored.get(other, id)) } });
  f.add(other);
  assert.equal(cardItem(await f.read()), undefined);
  pretend = true;
  assert.equal(cardItem(await f.read()), undefined);
  assert.equal(stored.list(other).length, 1);
});

test('a two-millisecond card miss cannot take the ordinary item at the deadline', async t => {
  const clock = controlledClock(t);
  const f = setup(t, { cardPort: { ...createInMemoryDocumentCardPort(), list() { clock.advance(2); return []; } } });
  const plain = f.open();
  ok(f.core.admit({ namespace: ns, memory: { ...note, content: query }, receipts: [proof(query)] }));
  await f.read();
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    if (sql.includes('SELECT d.*,p.frequency FROM postings') && clock.now() < 999) clock.advance(999 - clock.now());
    return prepare.call(this, sql);
  });
  clock.advance(-clock.now());
  const expected = await f.read(plain);
  assert.equal(clock.now(), 999);
  assert.equal(expected.metered.items.length, 1);
  clock.advance(-clock.now());
  assert.deepEqual(await f.read(), expected);
});

test('a cold card semantic miss does not wait for vector maintenance', async t => {
  const clock = controlledClock(t);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = setup(t, { contextOptions: { policy: policy(), embedder: { id: 'sample', revision: 'one', dimensions: 2,
    normalization: 'none', embed: async texts => {
      if (texts.some(text => text.includes('instructions'))) await pending;
      return texts.map(text => text.includes('instructions') ? [1, 0] : [0, 1]);
    } } } });
  f.add();
  const unrelated = { query: 'ocean tide' };
  const plain = f.open();
  await f.read(plain, unrelated);
  const expected = await f.read(plain, unrelated);
  const read = f.read(f.core, unrelated);
  const first = await Promise.race([read, setImmediate('pending')]);
  clock.advance(2);
  release();
  await read;
  assert.deepEqual(first, expected);
});

test('optional card callbacks cannot invalidate the final Raw check', async t => {
  controlledClock(t);
  let allowed = true;
  const text = 'Quartz gasket installation';
  const value = { namespace: ns, conversationId: 'conversation', messageId: 'raw-note', role: 'user',
    ranges: [{ source: { span: { start: 0 } }, text }] };
  const rawSearch = {
    search: () => ({ coverage: { status: 'complete' }, candidates: [value] }),
    prepare: () => ({ value }),
    revalidate: handles => {
      if (!allowed) throw Error('source unavailable');
      return handles.map(handle => handle.value);
    },
  };
  const cardPort = { ...createInMemoryDocumentCardPort(), list() { allowed = false; return []; } };
  const f = setup(t, { cardPort, contextOptions: { rawSearch } });
  const input = { raw: true, representation: 'representation-v2-dated' };
  assert.equal((await f.read(f.open(), input)).metered.items[0].ref.type, 'raw');
  const pack = await f.read(f.core, input);
  assert.equal(pack.diagnostics.coverage.raw, 'partial');
  assert.deepEqual(pack.metered.items, []);
});

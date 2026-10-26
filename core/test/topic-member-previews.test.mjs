import assert from 'node:assert/strict';
import test from 'node:test';
import { membersInput } from '../topic-members-input.mjs';
import { memberFixture, smallHierarchy, namespace, overview, expected, ok } from '../testing/topic-members-fixture.mjs';
import { base, previews, controlledPreviews, collectPreviews } from '../testing/topic-member-previews-fixture.mjs';
import { previewCapability } from '../topic-member-previews-text.mjs';
const error = code => ({ ok: false, error: { code } });

test('P1 own-data opt-in validation never executes code; defaults normalize identically', async t => {
  const f = memberFixture(t), reader = f.reader(); f.admit('validation'); let calls = 0;
  const bad = [undefined, null, false, [], {}, { version: 'wrong' }, { version: previews.version, extra: 1 },
    { get version() { calls++; } }, new Proxy({}, { get() { calls++; }, ownKeys() { calls++; } }),
    { ...previews, [Symbol('x')]: 1 }, Object.create({ version: previews.version })];
  for (const value of [0, 81, 1.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '72', null, false]) bad.push({ ...previews, maxChars: value });
  for (const value of bad) assert.deepEqual(await reader.readTopicMembers({ ...base, previews: value }), error('invalid_input'));
  assert.equal(calls, 0);
  for (const input of [{ ...base, limit: 0 }, { ...base, namespace: { ...namespace, ownerId: 'foreign' } }, { ...base, kind: 'wrong' }]) assert.deepEqual(await reader.readTopicMembers(input), error('invalid_input'));
  assert.deepEqual(membersInput(base, namespace.ownerId), membersInput({ ...base, previews: { ...previews, maxChars: 72 } }, namespace.ownerId));
  assert.deepEqual(membersInput(base, namespace.ownerId), membersInput({ ...base, previews: { ...previews, maxChars: undefined } }, namespace.ownerId));
  const page = ok(await reader.readTopicMembers(base));
  assert.deepEqual(Object.keys(page), ['version','status','namespace','selection','snapshot','kind','order','items','coverage','nextCursor']);
  assert.deepEqual(Object.keys(page.snapshot), ['indexRevision','generation','originToken','accessRevision','configuration']);
  assert.equal(page.version, previews.version); assert.equal(page.snapshot.configuration, previews.version);
  assert.deepEqual(page.items[0].label, { text: page.items[0].id, source: 'identifier' });
  assert.deepEqual(Object.keys(page.items[0]), ['type','namespace','id','revision','kind','label','reportedUnder','preview']);
  assert.deepEqual(page.items[0].preview, { status: 'available', text: f.memory(f.ledger[0]).content, truncated: false });
});

test('P1 default read/overview remain text/capability-free before and after opt-in, cursor family separation', async t => {
  const f = memberFixture(t); for (let i = 0; i < 4; i++) f.admit('default-' + i);
  const h = controlledPreviews(f, { wrapper: true, overrides: { previewStorage: { setup() { assert.fail('default setup'); }, source() { assert.fail('default source'); } } } });
  // A failing Segmenter accessor would expose even an incidental default probe.
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, get() { assert.fail('default capability probe'); } });
  try { const page = ok(await h.read({ previews: undefined })); assert.fail(JSON.stringify(page)); }
  catch (e) { assert.equal(e.code, 'invalid_input'); }
  try {
    const input = { ...base }; delete input.previews;
    assert.ok((await h.engine.read(membersInput(input, namespace.ownerId))).ok);
  } finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
  const reader = f.reader(), defaultInput = { ...base }; delete defaultInput.previews;
  const before = ok(await reader.readTopicOverview({ namespace }));
  const legacy = ok(await reader.readTopicMembers({ ...defaultInput, limit: 1 }));
  assert.equal((await reader.readTopicMembers({ ...base, limit: 1, cursor: legacy.nextCursor })).error.code, 'invalid_cursor');
  const p = ok(await reader.readTopicMembers({ ...base, limit: 1 }));
  assert.equal((await reader.readTopicMembers({ ...defaultInput, limit: 1, cursor: p.nextCursor })).error.code, 'invalid_cursor');
  const continuation = { ...base, limit: 1, cursor: p.nextCursor };
  const next = await reader.readTopicMembers(continuation); assert.ok(next.ok);
  assert.equal(JSON.stringify(await reader.readTopicMembers(continuation)), JSON.stringify(next));
  assert.deepEqual(ok(await reader.readTopicOverview({ namespace })), before);
  const after = ok(await reader.readTopicMembers(defaultInput));
  assert.equal(after.version, 'topic-members-v1'); assert.ok(after.items.every(i => !Object.hasOwn(i, 'preview')));
  assert.equal((await reader.readTopicMembers(continuation)).error.code, 'cursor_stale');
});

test('P1 source outcomes through actual Worker and exact canonical stored normalization', async t => {
  const f = memberFixture(t), cases = [
    [' \t\r\n\ufeff', { status: 'unavailable', reason: 'empty' }],
    ['A \u0600 B', { status: 'available', text: 'A', truncated: true }],
    [' '.repeat(3000) + 'e\u0301X', { status: 'available', text: 'e\u0301X', truncated: false }],
    ['x'.repeat(12000), { status: 'unavailable', reason: 'content_limit' }],
    ['界'.repeat(4001), { status: 'unavailable', reason: 'content_limit' }],
    ['\u0600 B', { status: 'available', text: '\u0600 B', truncated: false }],
    ['a' + '\u0301'.repeat(600), { status: 'unavailable', reason: 'grapheme_too_large' }],
    ['A\0B', { status: 'unavailable', reason: 'invalid_text' }],
    [null, { status: 'unavailable', reason: 'invalid_text' }],
  ];
  f.db.exec('PRAGMA ignore_check_constraints=ON');
  const want = new Map();
  for (const [i, [source, outcome]] of cases.entries()) {
    const row = f.admit('source-' + i); f.db.prepare('UPDATE memories SET content=? WHERE id=?').run(source, row.id); want.set(row.id, outcome);
  }
  const malformed = f.admit('malformed'); f.db.prepare("UPDATE memories SET content=CAST(x'eda080' AS TEXT) WHERE id=?").run(malformed.id);
  want.set(malformed.id, { status: 'unavailable', reason: 'invalid_text' });
  const reader = f.reader(), result = await collectPreviews(reader, { previews: { ...previews, maxChars: 3 }, limit: 3 });
  assert.equal(result.items.length, want.size);
  for (const row of result.items) assert.deepEqual(row.preview, want.get(row.id));
  const trimmed = await collectPreviews(reader, { previews: { ...previews, maxChars: 1 } });
  const prepend = trimmed.items.find(i => i.id === [...want.keys()][5]);
  assert.deepEqual(prepend.preview, { status: 'unavailable', reason: 'trimmed_prefix_empty' });
});

test('P1 capability failure skips source extraction; fingerprint/table changes stale cursor and replay', async t => {
  const f = memberFixture(t); f.admit('a'); f.admit('b');
  let extracted = 0;
  const capability = previewCapability(null);
  const h = controlledPreviews(f, { beforeSource() { extracted++; }, overrides: { capability: () => capability } });
  const first = ok(await h.read({ limit: 1 })); assert.equal(extracted, 0);
  assert.deepEqual(first.items[0].preview, { status: 'unavailable', reason: 'segmenter_unavailable' });
  const input = { limit: 1, cursor: first.nextCursor }, next = await h.read(input);
  assert.deepEqual(await h.read(input), next); assert.equal(extracted, 0);
  assert.match(h.state.binding, /topic-member-previews-grapheme-canaries-v1/);
  capability.configuration.canaries = 'changed';
  await assert.rejects(h.read(input), { code: 'cursor_stale' });
});

test('P1 JSON overview provenance and changing options/authentication fences', async t => {
  const f = memberFixture(t); smallHierarchy(f); const reader = f.reader(), issued = await overview(reader);
  const input = { ...base, selection: expected(issued.items.find(i => i.level === 'L2')), limit: 1,
    expectedSnapshot: JSON.parse(JSON.stringify(issued.snapshot)) };
  const first = ok(await reader.readTopicMembers(input));
  assert.deepEqual(first.snapshot, { ...issued.snapshot, accessRevision: base.accessRevision, configuration: previews.version });
  assert.deepEqual(await reader.readTopicMembers({ ...input, cursor: first.nextCursor, previews: { ...previews, maxChars: 71 } }), error('cursor_stale'));
  for (const snapshot of [{ ...issued.snapshot, originToken: 'x' }, { ...issued.snapshot, indexRevision: 1 }, { ...issued.snapshot, generation: 'foreign' }, { indexRevision: issued.snapshot.indexRevision, generation: null }]) assert.deepEqual(await reader.readTopicMembers({ ...input, expectedSnapshot: snapshot }), error('cursor_stale'));
  assert.deepEqual(await f.reader().readTopicMembers(input), error('cursor_stale'));
});

test('P1 close, in-flight exclusion, watchdog, idle expiry and Worker failure retain typed envelopes', async t => {
  const { Worker } = await import('node:worker_threads');
  const f = memberFixture(t); f.admit('lifecycle-a'); f.admit('lifecycle-b');
  const r = f.reader(), pending = r.readTopicMembers(base);
  assert.deepEqual(await r.readTopicOverview({ namespace }), error('read_in_progress'));
  await r.close(); assert.deepEqual(await pending, error('store_closed'));
  assert.deepEqual(await r.readTopicMembers(base), error('store_closed'));
  const timeout = f.reader(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = timeout.readTopicMembers({ ...base, deadlineMs: 50 }); t.mock.timers.tick(50);
  assert.deepEqual(await waiting, error('read_timeout'));
  const first = ok(await timeout.readTopicMembers({ ...base, limit: 1 }));
  t.mock.timers.tick(60000);
  assert.deepEqual(await timeout.readTopicMembers({ ...base, limit: 1, cursor: first.nextCursor }), error('cursor_stale'));
  t.mock.timers.reset();
  const failed = f.reader(); t.mock.method(Worker.prototype, 'postMessage', function() { void this.terminate(); });
  assert.deepEqual(await failed.readTopicMembers(base), error('reader_failed'));
});

test('P1 consumed content declaration/function refusal is isolated to opt-in initialization', async t => {
  const { createPreviewStorage } = await import('../topic-member-previews-storage.mjs');
  const f = memberFixture(t); f.admit('sql-capability');
  const native = createPreviewStorage(f.db); native.setup(0); native.setup(1); native.setup(2);
  f.db.function('octet_length', value => value ? 2 : 0);
  assert.throws(() => createPreviewStorage(f.db).setup(1), { code: 'unsupported_database' });
  const content = createPreviewStorage({ prepare(sql) {
    if (sql === 'SELECT content FROM memories LIMIT 0') return { columns: () => [{ column: 'content', table: 'memories', type: 'BLOB' }] };
    return f.db.prepare(sql);
  } });
  assert.throws(() => content.setup(0), { code: 'unsupported_database' });
  // A separate public connection retains its built-in direct-size function.
  const reader = f.reader(); assert.ok((await reader.readTopicMembers(base)).ok);
});

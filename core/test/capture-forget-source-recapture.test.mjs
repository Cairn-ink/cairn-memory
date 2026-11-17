import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { createHash } from 'node:crypto';

const client = 'cairn-web', sessionId = 'recapture-conversation';
const tea = 'The user prefers green tea in the morning';
const reworded = 'In the mornings the user likes to drink green tea';
const bike = 'The user works on a bicycle repair project';
const newFact = 'The user is learning Spanish';
const mug = 'The user collects ceramic mugs';
const m1 = { id: 'm1', role: 'user', content: 'I drink green tea every morning and collect ceramic mugs.' };
const m2 = { id: 'm2', role: 'user', content: 'I am fixing bicycles this month.' };
const m3 = { id: 'm3', role: 'user', content: 'I am learning Spanish.' };
const rule = (needle, content) => ({ needle, content });
const initial = [rule('green tea', tea), rule('bicycles', bike)];

async function fixture(t, shape) {
  const f = shape === 'hosted-53' ? eventTimeSafetyFixture(t, 33) : safetyFixture(t, 18);
  if (shape === 'hosted-53') await f.migrate();
  const plan = { rules: initial, seen: [] };
  const core = openMemoryCore({ path: f.path, model: {
    contextWindow: 8192, countTokens: () => 1,
    extract({ input }) {
      plan.seen.push(structuredClone(input.messages));
      return { items: plan.rules.flatMap(({ needle, content }) => {
        const index = input.messages.findIndex(message => message.content.includes(needle));
        return index < 0 ? [] : [{ content, kind: 'fact', confidence: .9, sourceIndices: [index] }];
      }) };
    },
  } });
  f.workspace.defer(() => core.close());
  const db = f.connect(); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, shape === 'hosted-53' ? 53 : 18);
  const hasRaw = db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_conversations'").get();
  if (hasRaw) assert.equal(db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  return { ...f, core, db, plan };
}
const send = (f, eventId, messages = [m1, m2], session = sessionId) => f.core.capture({
  namespace: ns, client, sessionId: session, eventId, messages,
});
const memories = f => ok(f.core.list({ namespace: ns, limit: 50 })).memories.map(memory =>
  ok(f.core.get({ namespace: ns, memoryId: memory.id })).memory);
const contents = f => memories(f).map(memory => memory.content);
function forget(f, content = tea) {
  const memory = memories(f).find(memory => memory.content === content); assert.ok(memory);
  const rows = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
  assert.equal(rows.length, 1);
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 0);
  f.plan.seen = [];
  return rows[0];
}
function unseen(f) {
  assert.ok(f.plan.seen.length, 'the surviving messages reach the model');
  assert.equal(JSON.stringify(f.plan.seen).includes('green tea'), false, 'forgotten text never reaches extraction');
  assert.equal(JSON.stringify(f.plan.seen).includes('ceramic mugs'), false);
}
async function captured(t, shape, messages = [m1, m2], session = sessionId) {
  const f = await fixture(t, shape);
  assert.equal(ok(await send(f, 'event-1', messages, session)).admission.memories.length, 2);
  f.b = memories(f).find(memory => memory.content === bike); assert.ok(f.b);
  return f;
}
function bikeUnchanged(f) {
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: f.b.id })).memory, f.b);
}

for (const shape of ['hosted-53', 'legacy-18']) {
  for (const content of [tea, reworded]) test(`${shape}: new event excludes forgotten source (${content === tea ? 'exact' : 'reworded'})`, async t => {
    const f = await captured(t, shape); forget(f);
    f.plan.rules = [rule('green tea', content), rule('bicycles', 'The bicycle project is still active')];
    const result = ok(await send(f, 'event-2'));
    assert.equal(result.admission.memories.length, 1, 'm2 remains a usable source');
    unseen(f); bikeUnchanged(f);
    assert.equal(contents(f).some(value => [tea, reworded].includes(value)), false);
    const admitted = result.admission.memories[0];
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: admitted.id })).receipts[0].eventId, 'm2');
  });

  test(`${shape}: continued history captures m3 and excludes m1`, async t => {
    const f = await captured(t, shape); forget(f);
    f.plan.rules = [rule('green tea', reworded), rule('Spanish', newFact)];
    assert.equal(ok(await send(f, 'event-2', [m1, m2, m3])).admission.memories.length, 1);
    unseen(f); bikeUnchanged(f);
    assert.deepEqual(contents(f).sort(), [bike, newFact].sort());
  });

  test(`${shape}: same-event duplicate keeps base behavior before a new-event resend`, async t => {
    const f = await captured(t, shape); forget(f);
    f.plan.rules = [rule('green tea', reworded)];
    const duplicate = await send(f, 'event-1');
    if (shape === 'hosted-53') assert.deepEqual(duplicate, {
      ok: false, error: { code: 'memory_suppressed', retryable: false },
    });
    else assert.equal(ok(duplicate).duplicate, true);
    assert.deepEqual(f.plan.seen, []);
    assert.deepEqual(contents(f), [bike]);
    // The unchanged duplicate path must not hide a new-event recapture leak.
    ok(await send(f, 'event-2')); unseen(f);
    assert.deepEqual(contents(f), [bike]);
  });

  for (const position of [0, 1, 2]) test(`${shape}: forgotten source at position ${position}`, async t => {
    const messages = [m2, m3]; messages.splice(position, 0, m1);
    const f = await captured(t, shape, messages); forget(f);
    f.plan.rules = [rule('green tea', reworded), rule('Spanish', newFact)];
    assert.equal(ok(await send(f, 'event-2', messages)).admission.memories.length, 1);
    unseen(f); bikeUnchanged(f);
    assert.deepEqual(contents(f).sort(), [bike, newFact].sort());
  });

  test(`${shape}: all forgotten returns source_excluded without a model call`, async t => {
    const f = await fixture(t, shape);
    f.plan.rules = [rule('green tea', tea)];
    ok(await send(f, 'event-1', [m1])); forget(f);
    f.plan.rules = [rule('green tea', reworded)];
    assert.deepEqual(await send(f, 'event-2', [m1]), {
      ok: false, error: { code: 'source_excluded', retryable: false },
    });
    assert.deepEqual(f.plan.seen, []);
    assert.deepEqual(contents(f), []);
  });

  test(`${shape}: correction re-citing m1 stays capturable until explicitly forgotten`, async t => {
    const f = await captured(t, shape);
    const a = memories(f).find(memory => memory.content === tea);
    const corrected = 'The user usually drinks tea in the morning';
    ok(f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision, content: corrected, kind: 'fact',
      receipt: { client, sessionId, eventId: m1.id, role: m1.role, excerpt: m1.content } }));
    assert.deepEqual(f.db.prepare("SELECT fingerprint FROM suppressed WHERE fingerprint LIKE 'rs1:%'").all(), [],
      'replacement receipt tokens are subtracted, never persisted');
    f.plan.rules = [rule('ceramic mugs', mug)]; f.plan.seen = [];
    assert.equal(ok(await send(f, 'event-2')).admission.memories.length, 1);
    assert.ok(JSON.stringify(f.plan.seen).includes('green tea'));
    assert.ok(contents(f).includes(mug)); bikeUnchanged(f);
    forget(f, corrected);
    f.plan.rules = [rule('green tea', reworded)];
    ok(await send(f, 'event-3')); unseen(f);
    assert.equal(contents(f).includes(reworded), false);
  });

  test(`${shape}: unrelated message in same conversation remains capturable`, async t => {
    const f = await captured(t, shape); forget(f);
    f.plan.rules = [rule('Spanish', newFact)];
    assert.equal(ok(await send(f, 'event-2', [m3])).admission.memories.length, 1);
    assert.ok(contents(f).includes(newFact)); bikeUnchanged(f);
    f.plan.rules = [rule('green tea', reworded)];
    ok(await send(f, 'event-3')); unseen(f);
    assert.equal(contents(f).includes(reworded), false);
  });

  test(`${shape}: forgetting A excludes other facts in m1 as intended`, async t => {
    const f = await captured(t, shape); forget(f);
    f.plan.rules = [rule('ceramic mugs', mug)];
    assert.equal(ok(await send(f, 'event-2')).admission.memories.length, 0);
    unseen(f); bikeUnchanged(f);
    assert.deepEqual(contents(f), [bike]);
  });

  for (const tokenKind of ['i', 'a']) test(`${shape}: durable ${tokenKind} token alone drops the source`, async t => {
    const f = await captured(t, shape); forget(f);
    f.db.prepare("DELETE FROM suppressed WHERE fingerprint LIKE ?").run(`rs1:${tokenKind === 'i' ? 'a' : 'i'}:%`);
    f.plan.rules = [rule('green tea', reworded)];
    assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed WHERE fingerprint LIKE ?')
      .get(`rs1:${tokenKind}:%`).n, 1, 'the isolated durable token was actually persisted');
    // An address token must also cover edited source text with the same coordinates.
    const message = tokenKind === 'a' ? { ...m1, content: m1.content + ' This is still my preference.' } : m1;
    ok(await send(f, 'event-2', [message, m2])); unseen(f);
    assert.deepEqual(contents(f), [bike]);
  });
}

test('hosted-53: episode draftSnapshot filters a forgotten staged source', async t => {
  const f = await fixture(t, 'hosted-53');
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  f.workspace.defer(() => runtime.close());
  const session = runtime.episodeSessionKey(ns, client, sessionId);
  const input = { client, clientLabel: 'Synthetic hosted client', sessionId, eventId: 'episode-event-2', generation: 'initial', messages: [m1, m2].map(message => ({ ...message, occurredAt: null })),
    payloadDigest: createHash('sha256').update('episode-event-2').digest('hex'),
    view: { messages: [m1, m2], retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } } };
  ok(await send(f, 'event-1', [m1], session)); forget(f);
  const registered = runtime.reserveEpisodeBatch(ns, input);
  const writer = runtime.claimEpisodeWriter(ns, { episodeId: registered.episodeId, generation: 'initial' });
  const claim = runtime.claimEpisodeDraft(ns, { episodeId: registered.episodeId, generation: 'initial',
    writerToken: writer.token, trigger: 'batch', watermark: registered.position });
  const snapshot = runtime.episodeDraftSnapshot(ns, { episodeId: registered.episodeId, token: claim.token });
  assert.equal(snapshot.events.length, 1);
  assert.deepEqual(snapshot.events[0].sourceIndices, [1]);
});

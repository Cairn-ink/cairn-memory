import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { eventTimeFixture, ns, ok } from '../testing/receipt-event-time-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { model as episodeModel } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { config, request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';

const time = '1901-02-03T04:05:06.789Z', later = '2001-02-03T04:05:06.789Z';
const messages = () => [
  { id: 'timed', role: 'user', content: 'Synthetic first message', occurredAt: time },
  { id: 'untimed', role: 'assistant', content: 'Synthetic second message' },
  { id: 'later', role: 'user', content: 'Synthetic third message', occurredAt: later },
];
const input = () => ({ namespace: ns, client: 'synthetic', eventId: 'capture', sessionId: 'session', messages: messages() });
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const variants = {
  ordinary: {}, qualified: { captureQualification: 'source-bound-v2' },
  indexed: { captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' },
  staged: { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' },
  'indexed-evidence': { captureSourcePolicy: 'indexed-evidence-v1' },
  ordered: {}, episode: episodeOptions,
};
for (const [variant, options] of Object.entries(variants)) test(`per-message times never spread across a capture or episode: ${variant}`, async t => {
  const f = await eventTimeFixture(t), observed = [];
  const core = openMemoryCore({ path: f.path, ...options, model: episodeModel({ ...rationaleModel((method, request) => observed.push(request)) }) });
  const db = f.connect(); t.after(() => { core.close(); db.close(); });
  const value = input();
  if (variant !== 'episode') value.messages = value.messages.map(({occurredAt, ...message}) => message);
  if (variant === 'ordered') value.causal = { streamId: 'stream', sequence: 1 };
  if (variant === 'episode') value.episodeContext = { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' };
  const result = ok(await core.capture(value));
  assert.equal(result.admission.memories.length, 3);
  assert.deepEqual(db.prepare('SELECT event_id,occurred_at FROM receipts ORDER BY event_id').all().map(r => [r.event_id,r.occurred_at]),
    [['later',variant === 'episode' ? later : null],['timed',variant === 'episode' ? time : null],['untimed',null]]);
  assert.doesNotMatch(JSON.stringify(result), /occurred_at|occurredAt|1901-02-03|2001-02-03/);
  for (const request of observed) assert.doesNotMatch(JSON.stringify(request), /occurred_at|occurredAt|1901-02-03|2001-02-03/);
  assert.equal(ok(await core.capture(value)).duplicate, true);
  error(await core.capture({ ...value, messages: [{ ...value.messages[0], occurredAt: later }, ...value.messages.slice(1)] }), variant === 'episode' ? 'event_payload_conflict' : 'invalid_input');
});

test('one extracted Memory can attach several independently timed and untimed receipts', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({ path: f.path,
    ...episodeOptions, model: episodeModel({ ...rationaleModel(), extract: () => ({ items: [{ content: 'Synthetic combined memory', kind: 'fact', confidence: .8, sourceIndices: [2,1,0] }] }) }) });
  const db = f.connect(); t.after(() => { core.close(); db.close(); });
  ok(await core.capture({...input(), episodeContext: {clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}}));
  assert.equal(db.prepare('SELECT count(DISTINCT memory_id) n FROM receipts').get().n, 1);
  assert.deepEqual(db.prepare('SELECT event_id,occurred_at FROM receipts ORDER BY event_id').all().map(r => [r.event_id,r.occurred_at]),
    [['later',later],['timed',time],['untimed',null]]);
});

for (const variant of ['ordinary','episode']) test(`future receipt time follows the pre-existing contract: ${variant}`, async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({ path: f.path,
    ...(variant === 'episode' ? episodeOptions : {}), model: episodeModel(rationaleModel()) });
  const db = f.connect(); t.after(() => { core.close(); db.close(); });
  const value = { ...input(), messages: [{ ...messages()[0], occurredAt: '2099-01-01T00:00:00.000Z' }],
    ...(variant === 'episode' ? { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}) };
  if (variant === 'ordinary') error(await core.capture(value), 'invalid_input');
  else {
    ok(await core.capture(value));
    assert.equal(db.prepare('SELECT occurred_at FROM receipts').get().occurred_at, null);
  }
});

for (const kind of ['ordinary','staged','episode']) test(`Raw occurredAt stays outside Memory authority; derived receipts null: ${kind}`, async t => {
  const f = await eventTimeFixture(t,33), core = openRawCaptureCore({ path: f.path, ...config(kind), model: episodeModel(rationaleModel()) },
    { mode: 'raw-v1', port: localPlainPort(), lineage: true, readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  const db = f.connect(); t.after(() => { core.close(); db.close(); });
  const part = { ...splitRaw('Synthetic Raw dated source')[0], occurredAt: '2099-01-01T00:00:00.000Z' };
  const value = request(part, { namespace: ns, client: 'codex', sessionId: 'raw-session', eventId: 'raw-event' }, kind);
  const result = ok(await core.captureRaw(value));
  ok(result.interpretation);
  assert.equal(db.prepare('SELECT occurred_at FROM raw_messages').get().occurred_at, part.occurredAt);
  const rows = db.prepare('SELECT occurred_at FROM receipts').all();
  assert.ok(rows.length > 0); assert.ok(rows.every(row => row.occurred_at === null));
});

test('episode planning keeps main acceptance of unvalidated optional times', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({path:f.path,...episodeOptions,model:rationaleModel()}); t.after(() => core.close());
  assert.deepEqual(core.planCaptureBatches({messages:messages()}),core.planCaptureBatches({messages:messages().map(({occurredAt,...message}) => message)}));
  ok(core.planCaptureBatches({messages:[{...messages()[0],occurredAt:'garbage'}]}));
});

for (const base of [18,23,33]) test(`episode receipt times use the persisted +5 minute boundary on family ${base}`, async t => {
  const f = await eventTimeFixture(t,base), core = openMemoryCore({path:f.path,...episodeOptions,model:episodeModel(rationaleModel())});
  const db = f.connect(); t.after(() => {core.close();db.close();});
  const now = '2026-01-01T00:00:00.000Z'; t.mock.timers.enable({apis:['Date'],now:Date.parse(now)});
  const value = {...input(),episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'},messages:[
    {...messages()[0],occurredAt:'2026-01-01T00:05:00.000Z'},
    {...messages()[1],occurredAt:'2026-01-01T00:05:00.001Z'},
    {...messages()[2],occurredAt:null},
  ]};
  ok(await core.capture(value));
  assert.deepEqual(db.prepare('SELECT event_id,occurred_at,created_at FROM receipts ORDER BY event_id').all().map(r=>[r.event_id,r.occurred_at,r.created_at]),
    [['later',null,now],['timed','2026-01-01T00:05:00.000Z',now],['untimed',null,now]]);
  assert.equal(ok(await core.capture(value)).duplicate,true);
});

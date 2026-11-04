import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { eventTimeFixture, ns, ok } from '../testing/receipt-event-time-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

// Equivalent to LongMemEval --event-times ingestion: migrate a fresh store,
// then send session dates as message times through ordinary core.capture.
test('LongMemEval ingestion equivalent: ordinary captures preserve each session time on a migrated store', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({path:f.path,model:rationaleModel()});
  const db = f.connect(); t.after(() => {core.close();db.close();});
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,51);
  assert.equal(db.prepare('SELECT receipt_event_time FROM content_safety_control').get().receipt_event_time,1);
  const sessions = [
    {id:'second',time:'2024-01-02T11:43:00.000Z',content:'Synthetic apple preference is red.'},
    {id:'first',time:'2024-01-01T10:07:00.000Z',content:'Synthetic apple preference is green.'},
  ];
  for (const session of sessions) {
    const request = {namespace:ns,client:'claude-code',sessionId:session.id,eventId:'event-'+session.id,
      messages:[{id:'turn-'+session.id,role:'user',content:session.content,occurredAt:session.time}]};
    const value = ok(await core.capture(request));
    assert.equal(value.duplicate,false);
    assert.equal(value.admission.memories.length,1);
    assert.equal(ok(await core.capture(request)).duplicate,true);
  }
  assert.deepEqual(db.prepare('SELECT session_id,event_id,occurred_at FROM receipts ORDER BY session_id').all()
    .map(row => [row.session_id,row.event_id,row.occurred_at]),
    [['first','turn-first',sessions[1].time],['second','turn-second',sessions[0].time]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';

async function call(f,action,options) {
  const result = await f.runWorker(action,options).done; assert.equal(result.code,0,result.stderr); assert.equal(result.signal,null);
  assert.doesNotMatch(result.stdout+result.stderr,/synthetic_source_secret|synthetic_key_secret/); return JSON.parse(result.stdout);
}
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await delay(10); } assert.fail('owned child did not reach expected boundary'); }
function receipts(f) {
  const db = new DatabaseSync(f.databasePath,{ readOnly:true });
  try { return { events:db.prepare('SELECT event_id FROM raw_capture_events ORDER BY event_id').all().map(row => row.event_id),
    parts:db.prepare('SELECT count(*) n FROM raw_parts').get().n,memories:db.prepare('SELECT count(*) n FROM memories').get().n }; }
  finally { db.close(); }
}
for (const phase of ['prepared','dispatched']) test(`B4b actual parent dies at ${phase} before registration; exact pending can acquire only its first interpretation`,{ timeout:15000 },async t => {
  const f = workerFixture(t), now = Date.now(); await call(f,'initialize',{ start:'beginning' }); f.providerMode('empty');
  const death = await f.runWorker('run',{ clock:now,crashAt:phase }).done;
  assert.equal(death.code,1); assert.equal(death.signal,null); assert.equal(death.stdout,'');
  assert.equal(f.calls().length,0); assert.deepEqual(receipts(f),{ events:[],parts:0,memories:0 });
  const pending = f.cursor().pending; assert.equal(pending.attempts,phase === 'prepared' ? 0 : 1);
  assert.equal(f.cursor().issuedOrdinal,1); assert.equal(f.cursor().offset,0);
  if (phase === 'dispatched') {
    assert.equal(pending.nextEligibleAt,now+280000);
    assert.equal((await call(f,'run',{ clock:now+279999 })).dispatchedParts,0);
    assert.equal(f.calls().length,0);
  }
  const recovered = await call(f,'run',{ clock:now+280001 }); assert.equal(recovered.completedParts,1);
  assert.equal(recovered.dispatchedParts,1); assert.equal(f.cursor().pending,null); assert.equal(f.cursor().issuedOrdinal,1);
  assert.deepEqual(receipts(f),{ events:[pending.projection.eventId],parts:1,memories:0 });
  assert.equal(f.ledger().used,1); assert.deepEqual(f.ledger().reservations,[]); assert.equal(f.childrenStopped(),true);
});
test('B4b live registered orphan remains alive during exact-event processing recovery, then keyless completion adds no usage',{ timeout:20000 },async t => {
  const f = workerFixture(t), now = Date.now(); await call(f,'initialize',{ start:'beginning' }); f.providerMode('hold');
  const invocation = f.runWorker('run',{ clock:now,rawDriver:true });
  try {
    await until(() => existsSync(f.readyPath)); assert.equal(f.calls().length,2); const pending = f.cursor().pending;
    assert.deepEqual(receipts(f),{ events:[pending.projection.eventId],parts:1,memories:0 });
    invocation.child.kill('SIGKILL'); assert.deepEqual(await invocation.exited,{ code:null,signal:'SIGKILL' });
    assert.equal(f.childrenStopped(),false,'orphan liveness is observed, never inferred from eligibility');
    const calls = f.calls().length, used = f.ledger().used;
    const processing = await call(f,'run',{ clock:now+280001,key:false });
    assert.equal(processing.reason,'processing'); assert.equal(processing.dispatchedParts,1); assert.equal(processing.completedParts,0);
    assert.equal(f.cursor().pending.attempts,2); assert.equal(f.cursor().pending.projection.eventId,pending.projection.eventId);
    assert.equal(f.cursor().offset,0); assert.equal(f.childrenStopped(),false);
    assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,used);
    writeFileSync(f.releasePath,'release',{ mode:0o600 }); await until(f.childrenStopped); await invocation.done;
    const completed = await call(f,'run',{ clock:f.cursor().pending.nextEligibleAt+1,key:false });
    assert.equal(completed.completedParts,1); assert.equal(completed.dispatchedParts,1); assert.equal(f.cursor().pending,null);
    assert.equal(f.cursor().issuedOrdinal,1); assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
    assert.equal(f.calls().length,calls); assert.equal(f.ledger().used,used); assert.deepEqual(f.ledger().reservations,[]);
    assert.deepEqual(receipts(f),{ events:[pending.projection.eventId],parts:1,memories:0 });
  } finally {
    if (!existsSync(f.releasePath)) writeFileSync(f.releasePath,'release',{ mode:0o600 });
    await f.stopOwnedChildren(); await invocation.done; assert.equal(f.childrenStopped(),true);
  }
});
test('B4b concurrent worker cannot dispatch while owner holds its actual provider call',{ timeout:15000 },async t => {
  const f = workerFixture(t); await call(f,'initialize',{ start:'beginning' }); f.providerMode('hold'); const first = f.runWorker('run');
  try {
    await until(() => existsSync(f.readyPath)); const before = readFileSync(f.cursorPath(),'utf8');
    const busy = await call(f,'run'); assert.equal(busy.status,'busy'); assert.equal(busy.dispatchedParts,0);
    assert.equal(readFileSync(f.cursorPath(),'utf8'),before); assert.equal(f.calls().length,2);
    writeFileSync(f.releasePath,'release',{ mode:0o600 }); const done = await first.done;
    assert.equal(done.code,0,done.stderr); assert.equal(JSON.parse(done.stdout).completedParts,1); assert.equal(f.ledger().used,1);
  } finally { if (!existsSync(f.releasePath)) writeFileSync(f.releasePath,'release',{ mode:0o600 }); await first.done; }
});
test('B4b actual core receipt never advances source after an in-place response-boundary mutation',{ timeout:15000 },async t => {
  const f = workerFixture(t); await call(f,'initialize',{ start:'beginning' }); f.providerMode('hold');
  const original = readFileSync(f.sourcePath,'utf8'), first = f.runWorker('run');
  try {
    await until(() => existsSync(f.readyPath)); writeFileSync(f.sourcePath,original.replace('synthetic_source_secret','synthetic_source_secreT'));
    writeFileSync(f.releasePath,'release',{ mode:0o600 }); const result = await first.done;
    assert.equal(result.code,0,result.stderr); const response = JSON.parse(result.stdout);
    assert.equal(response.reason,'source_changed'); assert.equal(response.completedParts,0); assert.equal(f.cursor().offset,0);
    assert.equal(f.cursor().blockedReason,'source_changed'); assert.equal(f.cursor().pending.attempts,1);
    assert.equal(receipts(f).parts,1); assert.equal(f.ledger().used,1);
    const before = readFileSync(f.cursorPath(),'utf8'); writeFileSync(f.sourcePath,original);
    assert.equal((await call(f,'run',{ clock:Date.now()+999999,key:false })).reason,'source_changed');
    assert.equal(readFileSync(f.cursorPath(),'utf8'),before); assert.equal(f.calls().length,2);
  } finally { if (!existsSync(f.releasePath)) writeFileSync(f.releasePath,'release',{ mode:0o600 }); await first.done; }
});

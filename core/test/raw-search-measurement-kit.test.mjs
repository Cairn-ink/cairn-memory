import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {sourceFixture} from '../testing/raw-source-fixtures.mjs';
import {transaction} from '../database.mjs';
import {observeCaptureWriter} from '../../tools/testing/raw-search-writer-observer.mjs';
import {installPhaseMeasurement} from '../../tools/testing/raw-search-phase-loader.mjs';
import {takePhases} from '../../tools/testing/raw-search-phase-ledger.mjs';

test('optional phase transforms load every serving module without opening a store',async()=>{
  const hook=installPhaseMeasurement();
  try{
    for(const file of ['authority','index','storage','retrieval'])await import('../raw-search-'+file+'.mjs');
    assert.deepEqual(takePhases(),{});
  }finally{hook.deregister();}
});
test('writer attribution preserves commits and restores native busy configuration',t=>{
  const f=sourceFixture(t),before=f.db.prepare('PRAGMA busy_timeout').get().timeout;
  const exec=DatabaseSync.prototype.exec,observer=observeCaptureWriter();
  try{
    transaction(f.db,()=>f.db.exec('CREATE TABLE synthetic_writer_attribution(value INTEGER)'));
    const rows=observer.take();assert.equal(rows.length,1);assert.deepEqual(observer.take(),[]);
    const row=rows[0];assert.equal(row.journal,'delete');assert.equal(row.checkpointMs,0);
    assert.ok(BigInt(row.start)<=BigInt(row.beginEnd));assert.ok(BigInt(row.beginEnd)<=BigInt(row.commitStart));
    assert.ok(BigInt(row.commitStart)<=BigInt(row.end));
    assert.ok(row.lockWaitMs>=row.commitLockWaitMs);assert.ok(row.commitAndFsyncMs>=0);
  }finally{observer.close();}
  assert.equal(DatabaseSync.prototype.exec,exec);assert.equal(f.db.prepare('PRAGMA busy_timeout').get().timeout,before);
});

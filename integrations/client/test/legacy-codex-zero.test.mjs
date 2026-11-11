import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { workerFixture } from './fixtures/local-worker-workspace.mjs';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { keyed } from '../raw/local-worker-state.mjs';

for (const operation of ['run','initialize']) for (const pending of [false,true])
test(`legacy zero Codex cursor refuses ${operation}, pending=${pending}`, async t => {
  const f = workerFixture(t,{client:'codex'});
  f.config.interpretation='raw-only'; f.save();
  const worker = createLocalRawWorker(f.options);
  assert.equal((await worker.initialize({...f.context,start:'eof'})).status,'ready');
  const cursor = f.cursor();
  // Source identity is inode-based and unchanged. A zero-byte anchor is exactly
  // what the pre-fix --start beginning emitted, with no pending or rearm receipt.
  const key = Buffer.from(readFileSync(f.identityKeyPath,'utf8').trim(),'hex');
  cursor.offset=0;
  cursor.source.anchor={start:0,end:0,
    commitment:keyed(key,'source-anchor',[cursor.sessionKey,0,0]).digest('hex')};
  key.fill(0);
  if(pending){cursor.issuedOrdinal=1;cursor.pending={projection:{version:1,profile:'raw-producer-v1',client:'codex',
    wireSessionId:cursor.wireSessionId,generation:'initial',epoch:0,range:{start:0,end:1},messageOrdinal:1,role:'user',
    sourceIdentity:cursor.source.identity,contentIdentity:'ab'.repeat(32),totalUnits:1,totalBytes:1,
    part:{index:0,start:0,end:1},eventId:'cd'.repeat(32)},attempts:0,nextEligibleAt:null,lastAttemptAt:null,state:'prepared'};}
  writeFileSync(f.cursorPath(),JSON.stringify(cursor),{mode:0o600});
  const result = await worker[operation](f.context);
  assert.equal(result.status,'blocked',JSON.stringify(result));
  assert.equal(result.reason,'codex_boundary_required');
  assert.equal(result.dispatchedParts,0);
  assert.equal(readFileSync(f.cursorPath(),'utf8'),JSON.stringify(cursor));
});


test('new Codex beginning requests still refuse before state creation',async t=>{
  const f=workerFixture(t,{client:'codex'}),worker=createLocalRawWorker(f.options);
  const result=await worker.initialize({...f.context,start:'beginning'});
  assert.equal(result.status,'blocked');assert.equal(result.reason,'invalid_input');
  assert.equal(result.dispatchedParts,0);assert.equal(existsSync(f.stateRoot+'/root.json'),false);
});

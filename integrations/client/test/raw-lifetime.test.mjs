import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareRawRecord,planRawBatch,restoreRawBatch,scanRawRecordRanges } from '../raw/index.mjs';
import { recordFixture,claude,key } from './fixtures/raw-fixtures.mjs';

test('completed preparation excludes caller idle time; each read/plan/restore gets an active operation budget',async t => {
  const f = await recordFixture(t,'claude-code',claude('Synthetic 🙂 text.'));
  const controller = new AbortController();
  const result = await prepareRawRecord(f.input,{ identityKey:key,limits:{ deadlineMs:500 },signal:controller.signal });
  f.workspace.defer(() => result.message.close());
  const batch = await planRawBatch({ message:result.message,projectId:null,position:{ index:0,start:0 } });
  await delay(650);
  assert.equal((await result.message.readPart({ start:0,maxUnits:4000 })).text,'Synthetic 🙂 text.');
  assert.deepEqual(await restoreRawBatch({ message:result.message,projectId:null,pending:batch.pending }),batch);
  assert.deepEqual(await planRawBatch({ message:result.message,projectId:null,position:{ index:0,start:0 } }),batch);
  controller.abort();
  await assert.rejects(() => result.message.readPart({ start:0,maxUnits:4000 }),{ code:'raw_source_cancelled' });
});
test('scanner starts one bounded active-operation allowance for each next range',async t => {
  const f = await recordFixture(t,'claude-code','{}\n{}\n');
  const iterator = scanRawRecordRanges({ source:f.source,start:0,end:f.input.range.end },{ limits:{ deadlineMs:500,bufferBytes:1 } });
  assert.deepEqual((await iterator.next()).value,{ start:0,end:3 }); await delay(650);
  assert.deepEqual((await iterator.next()).value,{ start:3,end:6 }); assert.equal((await iterator.next()).done,true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { HOSTED_SCHEMAS } from '../hosted-schemas.mjs';
import { conforms } from '../hosted-contract.mjs';
import { prepareRawRecord,planRawBatch,restoreRawBatch,validateRawRequest,classifyRawAcknowledgement } from '../raw/index.mjs';
import { recordFixture,claude,key } from './fixtures/raw-fixtures.mjs';

const body = () => ({ version:2,client:'claude-code',event_id:'synthetic-event',session_id:'synthetic-session',
  messages:[{ id:'synthetic-message',role:'user',occurred_at:null,message_ordinal:1,content:'🙂x',
    part:{ index:0,start:0,totalUnits:3,totalBytes:5 } }] });
const ack = () => ({ version:2,duplicate:false,memoryCount:0,raw:{ conversationId:'synthetic-conversation',revision:1,
  parts:[{ messageId:'synthetic-message',index:0,saved:true,reason:null }] } });
test('request snapshots and exact acknowledgements are deeply immutable',() => {
  const original = body(), accepted = validateRawRequest(original); original.messages[0].content='changed';
  assert.equal(accepted.messages[0].content,'🙂x'); assert.ok(Object.isFrozen(accepted.messages[0].part));
  assert.deepEqual(classifyRawAcknowledgement(200,ack(),accepted),{ disposition:'complete' });
  for (const status of [200,202]) assert.deepEqual(classifyRawAcknowledgement(status,{ ...ack(),processing:true },accepted),{ disposition:'processing' });
  for (const reason of ['tool_off','notice_required','quota_reached','raw_disabled','capture_barrier']) {
    const response = ack(); response.raw.parts[0] = { messageId:'synthetic-message',index:0,saved:false,reason };
    assert.deepEqual(classifyRawAcknowledgement(200,response,accepted),{ disposition:'complete' });
  }
  assert.deepEqual(classifyRawAcknowledgement(429,{ error:'quota_reached' },accepted),{ disposition:'quota_reached' });
  assert.deepEqual(classifyRawAcknowledgement(500,{ private:'discard' },accepted),{ disposition:'refused' });
});
test('closed request/ack structures, calendar, Unicode and numeric bounds reject',() => {
  for (const change of [b=>b.ownerId='foreign',b=>b.messages.extra=true,b=>b.messages=new Array(1),
    b=>b.messages.push(b.messages[0]),b=>b.messages[0].message_ordinal=Infinity,
    b=>b.messages[0].content='\ud800',b=>b.messages[0].occurred_at='2026-02-30T00:00:00.000Z',
    b=>b.messages[0].part.totalBytes=4,b=>b.messages[0].part.start=1,b=>delete b.messages[0].occurred_at]) {
    const value = body(); change(value); assert.throws(() => validateRawRequest(value),{ code:'invalid_capture_v2' });
  }
  for (const change of [a=>a.extra=true,a=>a.raw.parts.push(a.raw.parts[0]),a=>a.raw.parts[0].messageId='foreign',
    a=>a.raw.parts[0].index=1,a=>a.raw.parts[0].reason='quota_reached',a=>a.raw.parts[0].saved=false,
    a=>a.raw.revision=0,a=>a.memoryCount=-1]) {
    const value = ack(); change(value); assert.throws(() => classifyRawAcknowledgement(200,value,body()),{ code:'invalid_capture_ack' });
  }
});

test('multiple message parts must preserve strictly increasing ordinal order',() => {
  for (const ordinals of [[1,1],[2,1],[1,2]]) {
    const request = body();
    request.messages = ordinals.map((ordinal,index) => ({ ...body().messages[0],id:'message-'+index,message_ordinal:ordinal }));
    if (ordinals[1]>ordinals[0]) assert.equal(validateRawRequest(request).messages.length,2);
    else assert.throws(() => validateRawRequest(request),{ code:'invalid_capture_v2' });
  }
});

test('bounded planning and restoration verify canonical part sequence and keyed source',async t => {
  const f = await recordFixture(t,'claude-code',claude('x'.repeat(3999)+'🙂'+'y'.repeat(4100)));
  const prepared = await prepareRawRecord(f.input,{ identityKey:key }); f.workspace.defer(() => prepared.message.close());
  let position = { index:0,start:0 }, count = 0, pending;
  do {
    const next = await planRawBatch({ message:prepared.message,projectId:null,position });
    assert.equal(next.body.messages[0].content.length,count===0 ? 3999:count===1 ? 4000:102);
    assert.deepEqual(await restoreRawBatch({ message:prepared.message,projectId:null,pending:next.pending }),next);
    position = next.nextPosition; pending = next.pending; count++;
  } while (position);
  assert.equal(count,3);
  await assert.rejects(() => planRawBatch({ message:prepared.message,projectId:null,position:{ index:1,start:4000 } }),{ code:'invalid_capture_v2' });
  await assert.rejects(() => restoreRawBatch({ message:prepared.message,projectId:null,pending:{ ...pending,extra:true } }),{ code:'invalid_capture_v2' });
  for (const mutate of [p=>delete p.range.end,p=>p.epoch=-1,p=>p.client='unknown',p=>p.role='system',
    p=>p.occurredAt='2026-02-30T00:00:00.000Z',p=>p.sessionId=' bad',p=>p.messageOrdinal=0,p=>p.totalUnits=0,p=>p.eventId='',
    p=>p.eventId+='\n',p=>p.sourceIdentity+='\n',p=>p.contentIdentity+='\n']) {
    const bad = structuredClone(pending); mutate(bad);
    await assert.rejects(() => restoreRawBatch({ message:prepared.message,projectId:null,pending:bad }),{ code:'invalid_capture_v2' });
  }
  const changed = await prepareRawRecord({ ...f.input,generation:'a'.repeat(36) },{ identityKey:key }); f.workspace.defer(() => changed.message.close());
  await assert.rejects(() => restoreRawBatch({ message:changed.message,projectId:null,pending }),{ code:'raw_source_changed' });
  await prepared.message.close(); await prepared.message.close();
  await assert.rejects(() => prepared.message.readPart({ start:0,maxUnits:4000 }),{ code:'raw_source_unavailable' });
});

test('versioned schemas use the existing structural interpreter without widening installed schemas',async () => {
  const before = Object.keys(HOSTED_SCHEMAS).sort();
  try {
    for (const name of ['capture-v2-request','capture-v2-response']) HOSTED_SCHEMAS[name] = JSON.parse(await readFile(new URL('../../../schemas/'+name+'.schema.json',import.meta.url),'utf8'));
    assert.equal(conforms('capture-v2-request',body()),true); assert.equal(conforms('capture-v2-response',ack()),true);
    assert.equal(conforms('capture-v2-request',{ ...body(),ownerId:'foreign' }),false);
    assert.equal(conforms('capture-v2-response',{ ...ack(),extra:true }),false);
    // Structural schema matching does not check the frozen request's identity.
    const mismatch = ack(); mismatch.raw.parts[0].messageId='foreign';
    assert.equal(conforms('capture-v2-response',mismatch),true);
    assert.throws(() => classifyRawAcknowledgement(200,mismatch,body()),{ code:'invalid_capture_ack' });
  } finally { delete HOSTED_SCHEMAS['capture-v2-request']; delete HOSTED_SCHEMAS['capture-v2-response']; }
  assert.deepEqual(Object.keys(HOSTED_SCHEMAS).sort(),before);
});

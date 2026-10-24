import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { openRawCaptureCore } from '../../../core/raw-capture.mjs';
import { redactSecrets } from '../redact.mjs';
import { prepareRawRecord,planRawBatch,restoreRawBatch,classifyRawAcknowledgement } from '../raw/index.mjs';
import { recordFixture,claude,codex,key } from './fixtures/raw-fixtures.mjs';

for (const client of ['claude-code','codex']) test(`${client}: exact selected/redacted text reaches the existing Raw engine and reopened paging`,async t => {
  const text = 'x'.repeat(3996)+' sk-'+'a'.repeat(32)+'\r\n Ａ🙂 \t'.repeat(7000), expected = redactSecrets(text);
  const f = await recordFixture(t,client,client==='codex' ? codex(text):claude(text));
  const result = await prepareRawRecord(f.input,{ identityKey:key }); f.workspace.defer(() => result.message.close());
  let calls = 0;
  const options = { path:join(f.workspace.path,'store.sqlite'),model:{ contextWindow:8192,countTokens:() => 1,
    extract:({ input }) => { calls++; assert.ok(input.messages.every(message => message.content.length<=4000)); return { items:[] }; } } };
  const raw = { mode:'raw-v1',lineage:true,readPolicy:() => ({ generation:'synthetic',reason:null }),
    port:{ version:'raw-seal-v1',sealRaw:async ({ text }) => ({ format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text) }),
      openRaw:async ({ sealed }) => ({ text:Buffer.from(sealed).toString('utf8') }) } };
  let core = openRawCaptureCore(options,raw); f.workspace.defer(() => core.close());
  let position = { index:0,start:0 }, conversationId, first, joined = '';
  while (position) {
    const batch = await planRawBatch({ message:result.message,projectId:null,position }), body = batch.body;
    const request = { namespace:{ ownerId:'synthetic-owner',scope:'personal',projectId:null },client:body.client,sessionId:body.session_id,
      eventId:body.event_id,messages:body.messages.map(message => ({ id:message.id,role:message.role,occurredAt:message.occurred_at,
        messageOrdinal:message.message_ordinal,content:message.content,part:message.part })) };
    const saved = await core.captureRaw(request); assert.equal(saved.ok,true,JSON.stringify(saved));
    assert.equal(saved.value.interpretation.ok,true);
    const acknowledgement = { version:2,duplicate:false,memoryCount:0,raw:saved.value.raw };
    assert.deepEqual(classifyRawAcknowledgement(200,acknowledgement,body),{ disposition:'complete' });
    conversationId = saved.value.raw.conversationId; joined += body.messages[0].content;
    if (!first) {
      first = batch; const duplicate = await core.captureRaw(request);
      assert.equal(duplicate.ok,true); assert.equal(duplicate.value.interpretation.ok,true);
    }
    assert.equal(calls,1); position = batch.nextPosition;
  }
  assert.equal(joined,expected);
  const repeated = await prepareRawRecord(f.input,{ identityKey:key }); f.workspace.defer(() => repeated.message.close());
  assert.deepEqual(await restoreRawBatch({ message:repeated.message,projectId:null,pending:first.pending }),first);
  core.close(); core = openRawCaptureCore(options,raw);
  let cursor, reconstructed = '';
  do {
    const page = await core.getConversation({ namespace:{ ownerId:'synthetic-owner',scope:'personal',projectId:null },conversationId,
      limit:2,...(cursor ? { cursor }:{}) });
    assert.equal(page.ok,true); reconstructed += page.value.messages.flatMap(message => message.parts.map(part => part.text)).join('');
    cursor = page.value.nextCursor;
  } while (cursor);
  assert.equal(reconstructed,expected);
  const usage = core.getRawUsage({ ownerId:'synthetic-owner' }); assert.equal(usage.ok,true);
  assert.equal(usage.value.savedBytes,Buffer.byteLength(expected)); assert.equal(usage.value.reservedBytes,0);
});

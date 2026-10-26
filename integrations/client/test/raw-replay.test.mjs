import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendFile,truncate,unlink } from 'node:fs/promises';
import { prepareRawRecord,planRawBatch,restoreRawBatch } from '../raw/index.mjs';
import { recordFixture,claude,codex,key } from './fixtures/raw-fixtures.mjs';

async function replay(f,pending) {
  const { source,...binding } = f.input;
  const child = spawn(process.execPath,[fileURLToPath(new URL('./fixtures/raw-replay-child.mjs',import.meta.url)),
    f.path,JSON.stringify(binding),JSON.stringify(pending)],{ stdio:['ignore','pipe','pipe'] });
  let stdout = '',stderr = '',settled = false;
  child.stdout.on('data',bytes => { stdout += bytes; if (stdout.length>65536) child.kill('SIGKILL'); });
  child.stderr.on('data',bytes => { if (stderr.length<65536) stderr += bytes; });
  const exited = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(code,signal) => { settled=true; resolve({ code,signal }); }); });
  f.workspace.defer(async () => { if (!settled) child.kill('SIGKILL'); await exited; });
  assert.deepEqual(await exited,{ code:0,signal:null },stderr); return JSON.parse(stdout);
}
for (const client of ['claude-code','codex']) test(`${client}: first/middle/final replay in fresh processes verifies frozen source and permits outside append`,async t => {
  const f = await recordFixture(t,client,client==='codex' ? codex('x'.repeat(3999)+'🙂'+'y'.repeat(4100)):claude('x'.repeat(3999)+'🙂'+'y'.repeat(4100)));
  const result = await prepareRawRecord(f.input,{ identityKey:key }); f.workspace.defer(() => result.message.close());
  await appendFile(f.path,'{"type":"unrelated"}\n');
  let position = { index:0,start:0 }, first, count = 0;
  while (position) {
    const batch = await planRawBatch({ message:result.message,projectId:null,position });
    assert.deepEqual(await replay(f,batch.pending),{ ok:true,result:batch });
    first ??= batch; position=batch.nextPosition; count++;
  }
  assert.equal(count,3);
  await truncate(f.path,f.input.range.end-10);
  assert.deepEqual(await replay(f,first.pending),{ ok:false,code:'raw_source_changed' });
  await unlink(f.path);
  assert.deepEqual(await replay(f,first.pending),{ ok:false,code:'raw_source_unavailable' });
});

for (const client of ['claude-code','codex']) test(`${client}: trusted binding property order does not change identity or replay`,async t => {
  const row = client==='codex' ? codex('Synthetic canonical binding.'):claude('Synthetic canonical binding.');
  if (client==='claude-code') delete row.uuid; // Exercise the range-derived fallback message identity too.
  const f = await recordFixture(t,client,row);
  const reverse = value => Object.fromEntries(Object.entries(value).reverse());
  const reordered = reverse({ ...f.input,range:reverse(f.input.range),selectionState:reverse(f.input.selectionState),
    formatAuthority:f.input.formatAuthority===null ? null:reverse(f.input.formatAuthority) });
  const first = await prepareRawRecord(f.input,{ identityKey:key }); f.workspace.defer(() => first.message.close());
  const second = await prepareRawRecord(reordered,{ identityKey:key }); f.workspace.defer(() => second.message.close());
  assert.deepEqual(second.message.metadata,first.message.metadata);
  if (client==='claude-code') assert.match(first.message.metadata.id,/^raw2_[a-f0-9]{64}$/);
  const batch = await planRawBatch({ message:first.message,projectId:null,position:{ index:0,start:0 } });
  assert.deepEqual(await restoreRawBatch({ message:second.message,projectId:null,pending:batch.pending }),batch);
  assert.deepEqual(await replay({ ...f,input:reordered },batch.pending),{ ok:true,result:batch });
  const changed = await prepareRawRecord({ ...reordered,epoch:1 },{ identityKey:key }); f.workspace.defer(() => changed.message.close());
  assert.notEqual(changed.message.metadata.sourceIdentity,first.message.metadata.sourceIdentity);
  await assert.rejects(() => restoreRawBatch({ message:changed.message,projectId:null,pending:batch.pending }),{ code:'raw_source_changed' });
});

test('source, key and trusted bindings are copied before asynchronous source work',async t => {
  const f = await recordFixture(t,'claude-code',claude('Synthetic detached input.'));
  const original = f.source.read.bind(f.source); let enter,release,armed = true;
  const entered = new Promise(resolve => { enter=resolve; }), gate = new Promise(resolve => { release=resolve; });
  f.workspace.defer(() => release());
  f.source.read = async (...args) => { if (armed) { armed=false; enter(); await gate; } return original(...args); };
  const mutableKey = Buffer.from(key), initial = { ...f.input,range:{ ...f.input.range },selectionState:{ ...f.input.selectionState } };
  const pending = prepareRawRecord(initial,{ identityKey:mutableKey }); await entered;
  initial.range.end=1; initial.sessionId='changed'; initial.selectionState.pluginRoot='/changed'; mutableKey.fill(0); release();
  const result = await pending; f.workspace.defer(() => result.message.close());
  assert.equal((await result.message.readPart({ start:0,maxUnits:4000 })).text,'Synthetic detached input.');
  const expected = await prepareRawRecord(f.input,{ identityKey:key }); f.workspace.defer(() => expected.message.close());
  assert.deepEqual(await planRawBatch({ message:result.message,projectId:null,position:{ index:0,start:0 } }),
    await planRawBatch({ message:expected.message,projectId:null,position:{ index:0,start:0 } }));
});

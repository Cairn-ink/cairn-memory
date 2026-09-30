import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyHeader,parseLine,FORMAT,CODEX_COMMIT } from '../parser.mjs';
import { planBatches,preflight,normalizeBlocks } from '../../client/common-profile.mjs';

const fixture=await readFile(new URL('./fixtures/primary-paginated.jsonl',import.meta.url),'utf8');
const lines=fixture.trimEnd().split('\n');
const sessionId=JSON.parse(lines[0]).payload.id;
const evidence=JSON.parse(await readFile(new URL('./fixtures/format-evidence.json',import.meta.url),'utf8'));
const context={sessionId,wireSessionId:'a'.repeat(64),epoch:0,start:0,end:100};
test('primary synthetic host fixture selects one canonical representation',()=>{
  assert.equal(evidence.commit,CODEX_COMMIT);
  assert.equal(verifyHeader(Buffer.from(lines[0]),sessionId),FORMAT);
  const records=lines.map((line,i)=>parseLine(Buffer.from(line),{...context,start:i*100,end:(i+1)*100}));
  assert.deepEqual(records.filter(x=>x.message).map(x=>x.message.content),['Prefer diagrams.','Understood.']);
  assert.equal(records.filter(x=>x.message).length,2);
});

for(const patch of [{cli_version:'0.157.2'},{history_mode:'legacy'},{source:'vscode'},
  {forked_from_id:'fork'},{history_base:{ordinal:1}},{parent_thread_id:'parent'},
  {subagent_history_start_ordinal:0},{thread_source:'subagent'}]) test(`unsupported metadata ${JSON.stringify(patch)}`,()=>{
    const row=JSON.parse(lines[0]);Object.assign(row.payload,patch);
    assert.throws(()=>verifyHeader(Buffer.from(JSON.stringify(row)),sessionId),/unsupported_format/);
  });

for(const mutate of [r=>r.type='new_format',r=>r.payload.type='new_event',r=>r.payload.item.type='new_item',
  r=>r.payload.item.channel='analysis',r=>r.payload.item.phase='analysis',r=>r.payload.item.content[0].type='output_text',
  r=>r.payload.item.content[0].secret='fake',r=>r.payload.thread_id='another-thread']) test(`fail closed discriminator ${mutate}`,()=>{
    const row=JSON.parse(lines[4]);mutate(row);
    assert.throws(()=>parseLine(Buffer.from(JSON.stringify(row)),context),/unsupported_format/);
  });

test('invalid UTF-8 and malformed complete JSON are content-free exclusions',()=>{
  assert.equal(parseLine(Buffer.from([255]),context).reason,'malformed');
  assert.equal(parseLine(Buffer.from('{broken}'),context).reason,'malformed');
});
test('rich markers exclude whole record; image/skill/audio/mention paths never enter message',()=>{
  const row=JSON.parse(lines[2]);row.payload.item.content[0].text_elements=[{byte_range:{start:0,end:3},placeholder:'CANARY'}];
  assert.equal(parseLine(Buffer.from(JSON.stringify(row)),context).reason,'rich_input');
  row.payload.item.content[0].text_elements=[];
  for(const type of ['image','local_image','audio','local_audio','skill','mention']) row.payload.item.content.push({type,path:'/CANARY',audio_url:'CANARY'});
  assert.equal(parseLine(Buffer.from(JSON.stringify(row)),context).message.content,'Prefer diagrams.');
});
test('24 message and 20000 unit limits freeze deterministic ordered batch identities',()=>{
  for(const [count,length,expected] of [[50,2,3],[6,3999,2]]) {
    const records=Array.from({length:count},(_,i)=>({start:i,end:i+1,message:{id:`m${i}`,role:'user',content:'x'.repeat(length)}}));
    const binding={projectId:'p',sessionId:'s'};
    const batches=planBatches(records,binding,0,0,count);
    assert.equal(batches.length,expected);assert.deepEqual(batches,planBatches(records,binding,0,0,count));
    for(const b of batches) preflight(b.body);
  }
  assert.ok(normalizeBlocks(['\uFDFA'.repeat(1000)]).truncated);
});

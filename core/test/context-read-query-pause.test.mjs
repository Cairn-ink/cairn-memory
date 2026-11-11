import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, query, refresh, policy, ns, personal, ok } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { control } from '../testing/context-semantic-pause-fixture.mjs';

for(const setting of [{paused:1},{enabled:0}])for(const mixed of [false,true])test(`legacy query refuses ${JSON.stringify(setting)}, mixed=${mixed}`,async t=>{
  let calls=0;const fake=createFakeEmbedder();
  const f=coreFixture(t,{embedder:{...fake,embed(texts,c){calls++;c.beforeDispatch();return fake.embed(texts,c);}},selectedPolicy:policy()});
  f.reopen({counter:{id:'synthetic',countTokens:()=>1}});
  const memory=f.admit('apple');if(mixed)f.admit('apple personal',personal);
  const readSet=mixed?[ns,personal]:[ns];ok(await f.call('refreshContextIndex',refresh({readSet})));
  const db=new DatabaseSync(f.path);t.after(()=>db.close());control(db,mixed?personal:ns,setting);
  const before=calls,result=ok(await f.call('contextRead',query({readSet,semantic:true,budget:{maxTokens:4000,maxItems:12}})));
  assert.equal(calls,before,'paused read sets never enter the query provider');
  assert.ok(result.metered.items.some(i=>i.ref.id===memory.id),'lexical Memory remains available');
  assert.equal(result.diagnostics.candidates.channels.semantic.state,'namespace_paused');
  assert.equal(result.diagnostics.candidates.trace.effective,'lexical');
});
test('legacy query checks a pause inside provider beforeDispatch',async t=>{
  let race=false,sends=0;const fake=createFakeEmbedder();let db;
  const f=coreFixture(t,{embedder:{...fake,embed(texts,c){if(race)control(db,ns,{paused:1});c.beforeDispatch();sends++;return fake.embed(texts,c);}},selectedPolicy:policy()});
  f.reopen({counter:{id:'synthetic',countTokens:()=>1}});
  const memory=f.admit('apple');ok(await f.call('refreshContextIndex',refresh()));db=new DatabaseSync(f.path);t.after(()=>db.close());race=true;
  const before=sends,result=ok(await f.call('contextRead',query({semantic:true,budget:{maxTokens:4000,maxItems:12}})));
  assert.equal(sends,before);assert.ok(result.metered.items.some(i=>i.ref.id===memory.id));assert.equal(result.diagnostics.candidates.channels.semantic.state,'namespace_paused');
});
test('default read without an embedder performs no episode-control reads',async t=>{
  const f=coreFixture(t);f.reopen({counter:{id:'synthetic',countTokens:()=>1}});f.admit('apple');
  const prepare=DatabaseSync.prototype.prepare,statements=[];
  const spy=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){statements.push(sql);return Reflect.apply(prepare,this,[sql]);});
  const result=await f.call('contextRead',query({budget:{maxTokens:4000,maxItems:12}}));spy.mock.restore();
  ok(result);assert.equal(statements.filter(sql=>sql.includes('episode_controls')||sql.includes('data_version')).length,0);
  t.diagnostic('NO_EMBEDDER_STATEMENTS '+statements.length);
});

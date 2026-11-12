import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, query, refresh, policy, ns, ok } from '../testing/context-read-core-fixture.mjs';
import { fixture, request, drain } from '../testing/context-read-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { contextBudget } from '../context-read-budget.mjs';
import { contextEmbeddingGuard } from '../context-read-sidecar.mjs';
import { readTransaction } from '../database.mjs';
import { control } from '../testing/context-semantic-pause-fixture.mjs';

for (const operation of ['query','refresh']) for (const writer of ['external','engine']) for (const disabled of [false,true]) {
  test(`${operation} observes ${writer} ${disabled?'disable':'pause'} during estimation before provider entry`, async t => {
    let race=false,entries=0,changes=0,f,db;
    const fake=createFakeEmbedder(),embedder={...fake,embed(texts,c){entries++;c.beforeDispatch();return fake.embed(texts,c);}};
    const estimateUsd=()=>{
      if(race){race=false;changes++;
        if(writer==='external')control(db,ns,disabled?{enabled:0}:{paused:1});
        else ok(f.context[disabled?'setProjectCapture':'setCapturePaused']({namespace:ns,expectedGeneration:'initial',...(disabled?{enabled:false}:{paused:true})}));
      }
      return 0;
    };
    f=coreFixture(t,{embedder,selectedPolicy:policy({estimateUsd}),coreOptions:{sessionEpisodes:{mode:'episode-v1'},captureEvidence:'staged-v1',captureQualification:'source-bound-v2'}});
    f.reopen({counter:{id:'synthetic',countTokens:()=>1}});f.admit('apple');ok(await f.call('refreshContextIndex',refresh()));
    db=new DatabaseSync(f.path);t.after(()=>db.close());
    if(operation==='refresh')f.reopen({embedder:{...embedder,revision:'replacement'}});
    const before=entries;race=true;
    const response=await f.call(operation==='query'?'contextRead':'refreshContextIndex',operation==='query'?query({semantic:true,budget:{maxTokens:4000,maxItems:12}}):refresh());
    const result=response.ok?response.value:null;
    if(!response.ok)assert.equal(response.error.code,'index_unavailable','engine mutation also invalidates namespace freshness');
    assert.equal(changes,1);assert.equal(entries,before,'changed controls prevent provider entry');
    if(result){if(operation==='query')assert.ok(result.metered.items.length,'lexical results survive');
    else assert.equal(result.progress.embedded,0);}
  });
}

for(const disabled of [false,true])test(`refresh catches same-connection engine ${disabled?'disable':'pause'} before transmit`,async t=>{
  const f=fixture(t);f.admit('apple');
  const db=new DatabaseSync(f.path);t.after(()=>db.close());
  const index=f.index({db});drain(index);
  // Use the real engine writer on the sidecar's canonical connection. The
  // namespace epoch callback is intentionally inert to isolate control fences.
  const episodes=createEpisodeStorage({db,rawCapture:{closePending(){}},advanceEpoch:()=>{}});
  const fake=createFakeEmbedder();let sends=0;
  const port={...fake,embed(texts,c){
    const before=db.prepare('PRAGMA data_version').get().data_version;
    episodes.setControl(ns,{expectedGeneration:'initial',...(disabled?{enabled:false}:{paused:true})},disabled);
    assert.equal(db.prepare('PRAGMA data_version').get().data_version,before,'own commits do not change data_version');
    c.beforeDispatch();sends++;return fake.embed(texts,c);
  }};
  await assert.rejects(index.refreshVectors(request(),port,{isCurrent:()=>true}),{code:'namespace_paused'});
  assert.equal(sends,0);
});

test('stable semantic query reuses one control decision and probes outside snapshots',async t=>{
  const fake=createFakeEmbedder(),embedder={...fake,embed(texts,c){c.beforeDispatch();return fake.embed(texts,c);}};
  const f=coreFixture(t,{embedder,selectedPolicy:policy()});
  f.reopen({counter:{id:'synthetic',countTokens:()=>1}});f.admit('apple');ok(await f.call('refreshContextIndex',refresh()));
  const prepare=DatabaseSync.prototype.prepare,observed=[];
  const spy=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(sql.includes('episode_controls')||sql==='PRAGMA data_version')observed.push({sql,transaction:this.isTransaction});
    return Reflect.apply(prepare,this,[sql]);
  });
  ok(await f.call('contextRead',query({semantic:true,budget:{maxTokens:4000,maxItems:12}})));spy.mock.restore();
  const decisions=observed.filter(r=>r.sql.includes('episode_controls')),probes=observed.filter(r=>r.sql==='PRAGMA data_version');
  assert.equal(decisions.length,1,'one fresh whole-read-set decision per dispatch');
  assert.ok(decisions.every(r=>r.transaction));
  assert.equal(probes.length,5,'initial, estimation pair, pre-transmit and adapter probes only');
  assert.ok(probes.every(r=>!r.transaction),'data_version is never pinned by a read snapshot');
});

for (const writer of ['external', 'engine']) test(`last pre-transmit signal hook observes ${writer} pause before embedder entry`, async t => {
  const f = fixture(t), db = new DatabaseSync(f.path);
  t.after(() => db.close());
  const episodes = createEpisodeStorage({db, rawCapture:{closePending(){}}, advanceEpoch:()=>{}});
  let entries = 0, changed = false;
  const embedder = {id:`synthetic-last-send-${writer}`, revision:'one', embed(){entries++;return [[1]];}};
  const dispatch = contextBudget({budgetConfigured:true, embedder, policy:policy()});
  const canonical = writer === 'external' ? f.db : db;
  const guard = contextEmbeddingGuard(canonical, work=>readTransaction(canonical,work), [ns]);
  guard();
  const signal = new AbortController().signal;
  Object.defineProperty(signal, 'aborted', {get(){
    if (!changed) {
      changed = true;
      if (writer === 'external') control(db,ns,{paused:1});
      else episodes.setControl(ns,{expectedGeneration:'initial',paused:true},false);
    }
    return false;
  }});
  await assert.rejects(dispatch(embedder,['synthetic text'],{signal,deadlineAt:Infinity,guard}),{code:'namespace_paused'});
  assert.equal(changed,true);
  assert.equal(entries,0,'the last pre-send guard prevents embedder entry');
});

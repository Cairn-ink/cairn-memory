import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { sourceDigest } from '../procedural-storage.mjs';

const ns={ownerId:'tags',scope:'personal',projectId:null};
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const receipt=(eventId='explicit')=>({client:'synthetic',sessionId:'synthetic',eventId,role:'user',excerpt:'Always review 中文 😀 changes.'});
const memory={content:'Review changes',kind:'instruction'};
function fixture(t,mode=false) {
  const dir=mkdtempSync(join(tmpdir(),'se1-procedural-')),path=join(dir,'store.sqlite');
  const core=openMemoryCore({path,model:{countTokens:()=>1},...(mode?{sessionEpisodes:{mode:'episode-v1'},captureEvidence:'staged-v1',captureQualification:'source-bound-v2'}:{})});
  const db=new DatabaseSync(path);t.after(()=>{core.close();db.close();rmSync(dir,{recursive:true,force:true});});return {core,db,path};
}
const detail=(f,id)=>ok(f.core.get({namespace:ns,memoryId:id}));
const set=(f,id,tagRevision=0,anchors)=>{
  const d=detail(f,id),r=d.receipts[0];
  return f.core.setProceduralMemory({namespace:ns,memoryId:id,expectedRevision:d.memory.revision,expectedTagRevision:tagRevision,
    procedural:{anchors:anchors??[{receiptId:r.id,digest:sourceDigest(r.excerpt),start:0,end:6}]}});
};

test('E10 explicit procedural admit works in both modes and independently upgrades v14',t=>{
  for(const mode of [false,true]) {
    const f=fixture(t,mode);
    const result=ok(f.core.admit({namespace:ns,memory,receipts:[receipt()],procedural:{anchors:[{receiptIndex:0,start:0,end:6}]}}));
    const d=detail(f,result.memory.id);assert.equal(d.procedural.origin,'explicit');assert.equal(d.procedural.tagRevision,1);
    assert.equal(d.procedural.anchors[0].receiptId,d.receipts[0].id);
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,15);
    assert.equal(f.core.admit({namespace:ns,memory:{...memory,kind:'fact'},receipts:[receipt()],procedural:{anchors:[{receiptIndex:0,start:0,end:6}]}}).error.code,'invalid_input');
  }
});

test('E10 tag-only edits preserve memory bytes, conflict/qualification/rationale links; filing preserves tag',t=>{
  const f=fixture(t),id=ok(f.core.admit({namespace:ns,memory,receipts:[receipt()]})).memory.id;
  const original=detail(f,id);
  ok(f.core.admit({namespace:ns,memory:{content:'Never review',kind:'instruction'},receipts:[{...receipt('other'),excerpt:'Never review'}],
    conflictHints:[{memoryId:id,expectedRevision:original.memory.revision,relation:'contradicts'}]}));
  const source=detail(f,id).receipts[0];
  f.db.prepare(`INSERT INTO memory_qualifications(memory_id,version,bound_revision,content_digest,attribution,commitment,anchor_count) VALUES(?,1,?,?, 'direct','adopted',1)`)
    .run(id,original.memory.revision,sourceDigest(original.memory.content));
  f.db.prepare('INSERT INTO qualification_anchors VALUES(?,0,?,?,0,6,?)').run(id,source.id,sourceDigest(source.excerpt),'["attribution","commitment"]');
  f.db.prepare("INSERT INTO rationale_edges VALUES(?,?,?,?,'supports-decision',?,?,?,?)").run(id,original.memory.revision,id,original.memory.revision,source.id,source.id,sourceDigest(JSON.stringify({id:source.id,role:source.role,excerpt:source.excerpt})),sourceDigest(JSON.stringify({id:source.id,role:source.role,excerpt:source.excerpt})));
  const before=f.db.prepare('SELECT * FROM memories WHERE id=?').get(id), receipts=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(id);
  const tables=['memory_conflicts','memory_qualifications','qualification_anchors','rationale_edges'];
  const snapshot=()=>tables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
  const links=snapshot();assert.equal(links[0].length,1);
  ok(set(f,id));assert.deepEqual(snapshot(),links);
  assert.deepEqual(f.db.prepare('SELECT * FROM memories WHERE id=?').get(id),before);
  assert.deepEqual(f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(id),receipts);
  assert.equal(set(f,id).error.code,'revision_conflict');
  const tag=detail(f,id).procedural;
  ok(f.core.applyPlacement({namespace:ns,proposal:{items:[{memoryId:id,parentIds:[],newL1:{title:'Procedures',parentL2Ids:[]}}]},
    expectedMemoryRevisions:[{memoryId:id,revision:before.revision}],expectedIndexRevision:ok(f.core.map({namespace:ns,purpose:'classification'})).indexRevision}));
  assert.deepEqual(detail(f,id).procedural,tag);
  ok(f.core.admit({namespace:ns,memory,receipts:[receipt('new-evidence')]}));
  assert.equal(detail(f,id).procedural.procedural,false);
  assert.equal(detail(f,id).conflicts.length,0);
});

test('E10 foreign/unsupported anchors and split Unicode reject; content correction/forget clears tags',t=>{
  const f=fixture(t),id=ok(f.core.admit({namespace:ns,memory,receipts:[receipt()]})).memory.id;
  assert.equal(set(f,id,0,[{receiptId:'foreign',digest:'a'.repeat(64),start:0,end:1}]).error.code,'invalid_input');
  const d=detail(f,id),r=d.receipts[0],position=r.excerpt.indexOf('😀');
  assert.equal(set(f,id,0,[{receiptId:r.id,digest:sourceDigest(r.excerpt),start:position,end:position+1}]).error.code,'invalid_input');
  ok(set(f,id));
  ok(f.core.correct({namespace:ns,memoryId:id,expectedRevision:d.memory.revision,content:'Review carefully',kind:'instruction',receipt:receipt()}));
  assert.equal(detail(f,id).procedural.procedural,false);
  ok(set(f,id,2));
  ok(f.core.forget({namespace:ns,memoryId:id,expectedRevision:detail(f,id).memory.revision}));
  assert.equal(f.db.prepare('SELECT positive FROM procedural_tags WHERE memory_id=?').get(id).positive,0);
});

test('E10 legacy explicit remember accepts independently opted-in receipt anchors',async t=>{
  const {openMemoryStore}=await import('../index.mjs');
  const f=fixture(t),legacy=openMemoryStore({path:f.path});t.after(()=>legacy.close());
  const remembered=legacy.scope({ownerId:ns.ownerId}).remember({...memory,receipt:receipt(),procedural:{anchors:[{receiptIndex:0,start:0,end:6}]}});
  assert.equal(detail(f,remembered.id).procedural.procedural,true);
});

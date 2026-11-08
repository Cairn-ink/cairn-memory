import {installRawSearchTestClock,rawSearchTestWait} from '../testing/raw-search-clock.mjs';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {safetySourceFixture,searchFixture} from '../testing/raw-search-fixtures.mjs';
import {savedSource,ns} from '../testing/raw-source-fixtures.mjs';
import {openRawSearch} from '../raw-search-index.mjs';
import {transaction} from '../database.mjs';
import {writeContentSuppressionInside} from '../content-suppression-storage.mjs';

test('each validation route starts fresh after prepared content gains suppressed ancestry',{timeout:120000},async t=>{
  let extracted=0;
  const f=safetySourceFixture(t,{model:{extract:()=>({items:extracted++?[]:[{content:'Synthetic alpha fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})}});
  const alpha=await savedSource(f,'copper alpha',{sessionId:'alpha'});
  const ancestor=await savedSource(f,'suppressed ancestor source',{sessionId:'ancestor'});
  const clean=await savedSource(f,'neutral permitted sentinel with several extra harmless words',{sessionId:'clean'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,1);
  const receipt=f.db.prepare('SELECT * FROM receipts').get();
  const extra={...receipt,id:'synthetic-extra-receipt',session_id:f.db.prepare('SELECT session_key FROM raw_conversations WHERE id=?').get(ancestor.conversationId).session_key,
    event_id:ancestor.messageId,excerpt:ancestor.text};
  extra.receipt_key=createHash('sha256').update(JSON.stringify({client:extra.client,sessionId:extra.session_id,eventId:extra.event_id,role:extra.role,excerpt:extra.excerpt})).digest('hex');
  f.db.prepare('INSERT INTO receipts ('+Object.keys(extra).join(',')+') VALUES ('+Object.keys(extra).map(()=>'?').join(',')+')').run(...Object.values(extra));
  f.db.prepare('INSERT INTO raw_receipt_origins VALUES(?,?)').run(extra.id,'independent');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  const originalOpen=f.port.openRaw;
  let primary,sibling,armed=false,inside,fresh,alphaRef,preparedFresh,validationFailure,validated;
  f.port.openRaw=async input=>{
    if(armed){
      armed=false;
      // The first opener's guarded entry has already populated this reader's
      // caller fact memo at epoch zero. A search also exercises that same scope.
      assert.equal((await primary.search({query:'absentterm'})).candidates.length,0);
      transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:ancestor.conversationId,
        matchMode:'span',messageId:ancestor.messageId,start:0,end:ancestor.text.length,reason:'privacy_erase',actionId:'synthetic-ancestor-fact'}));
      assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,1);
      // A different reader has no inherited epoch-zero memo. It legitimately
      // republishes alpha at epoch one while the ancestor is not yet linked.
      await rawSearchTestWait(1010);
      await sibling.maintain({maxItems:128,maxMs:5000},primary.host.token);
      const before=await sibling.search({query:'copper neutral'},primary.host.token);
      const a=before.candidates.find(c=>c.conversationId===alpha.conversationId);assert.ok(a);
      assert.ok(before.candidates.some(c=>c.conversationId===clean.conversationId));alphaRef=a.ranges[0];
      preparedFresh=await primary.service.prepareSource(alphaRef,{intent:'current'},primary.host.token);
      // Cadence advances on the functional clock; canonical commits remain real.
      // Canonical rows, commits, native versions and scope contexts stay real.
      // No expiry or deadline substitution is made during validation.
      const epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();
      const suppression=f.db.prepare('SELECT * FROM owner_suppression_epochs').all();
      const memory=f.db.prepare('SELECT revision FROM memories WHERE id=?').get(receipt.memory_id);
      transaction(f.db,()=>{
        f.db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(extra.id,ancestor.conversationId,ancestor.messageId,0,ancestor.text.length,'exact');
        f.db.prepare("UPDATE raw_receipt_origins SET kind='derived' WHERE receipt_id=?").run(extra.id);
      });
      assert.deepEqual(f.db.prepare('SELECT * FROM owner_suppression_epochs').all(),suppression);
      assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
      assert.deepEqual(f.db.prepare('SELECT revision FROM memories WHERE id=?').get(receipt.memory_id),memory);
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
      const checks=[['revalidate',()=>primary.service.revalidate([preparedFresh])[0]],['validate alias',()=>primary.service.validate([preparedFresh])[0]],['handle.validate',()=>preparedFresh.validate()],['ticket',()=>primary.service.revalidate([preparedFresh.ticket])[0]]];
      validationFailure=[];validated=[];
      for(const [name,invoke] of checks){try{const value=invoke();validated.push({name,text:value.ranges[0].text});validationFailure.push({name,error:null});}catch(error){validationFailure.push({name,error:error.code});}}
      inside=await primary.search({query:'copper neutral'});
      fresh=await sibling.search({query:'copper neutral'},primary.host.token);
    }
    return originalOpen(input);
  };
  primary=await searchFixture(f);await primary.maintain();
  sibling=await openRawSearch(primary.options);f.workspace.defer(()=>sibling.close());
  const outer=await primary.search({query:'neutral'});
  assert.equal(outer.candidates.length,1);assert.equal(outer.candidates[0].conversationId,clean.conversationId);
  armed=true;await assert.rejects(primary.prepare(outer.candidates[0]),{code:'raw_search_unavailable'});
  assert.ok(inside);assert.ok(fresh);
  assert.equal(fresh.candidates.length,1);assert.equal(fresh.candidates[0].conversationId,clean.conversationId);
  await assert.rejects(primary.service.prepareSource(alphaRef,{intent:'current'},primary.host.token),{code:'raw_search_unavailable'});
  const leaked=inside.candidates.some(c=>c.conversationId===alpha.conversationId);
  const inClean=inside.candidates.find(c=>c.conversationId===clean.conversationId),freshClean=fresh.candidates[0];assert.ok(inClean);
  assert.deepEqual(validationFailure.map(x=>x.error),Array(4).fill('raw_search_unavailable'),'each independent synchronous validation route must refuse alpha after it acquired suppressed ancestry');
  assert.equal(leaked,false,'a new ancestry edge to an erased Raw ancestor must remove alpha before any candidate metadata or score leaves');
  assert.ok(Number.isFinite(inClean.score)&&Number.isFinite(freshClean.score));
});

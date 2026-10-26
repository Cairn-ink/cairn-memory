import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,host,ns,project,publish,read,ok } from './role-fixture.mjs';
function admit(f,content,eventId,excerpt=content){return ok(f.call('admit',{namespace:ns,memory:{content,kind:'fact'},receipts:[{client:'test',sessionId:'s',eventId,role:'user',excerpt}]})).memory;}
test('C03/C05 optional U5b evidence uses one exact role budget, full receipt fences, concrete sources and body aliases',t=>{
 const f=fixture(t);ok(f.call('publishRoleProfileRelease',publish()));
 admit(f,'finance review records','one');admit(f,'finance report decisions','two','Finance source reference');
 const value=ok(f.call('readRoleTaskContext',{...read(),task:'finance'}));assert.equal(value.metered.evidence.length,2);assert.notEqual(value.diagnostics.candidates,null);
 const receipt=JSON.parse(value.metered.receipt).p;assert.equal(receipt.evidence.length,2);assert.ok(receipt.evidence.every(e=>e[1].length===43));
 assert.equal(value.metered.evidence.reduce((n,i)=>n+i.sources.length,0),2);assert.equal(value.diagnostics.dedup.body,1);
 assert.ok(value.diagnostics.trace.counterCalls<=2+2*(2+2));
 const historical=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:value.metered.receipt}));assert.equal(historical.metered.receipt,value.metered.receipt);assert.equal(historical.metered.evidence.length,2);
 assert.equal(historical.diagnostics.candidates,null);
});
test('C02 profile comparison reasons stay on recorded edges and disappear with either endpoint/source',t=>{
 const f=fixture(t),memory=admit(f,'Reason facts','reason'),first=ok(f.call('publishRoleProfileRelease',publish()));
 const ref={type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision};
 const second=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','second',first.release,1,{duties:['Different duties'],requiredOutputs:['Different outputs']}),changeReason:{text:'Recorded explanation',reasonRefs:[ref]}}));
 const compare=(from,to)=>ok(f.call('readRoleTaskContext',{mode:'compare',readSet:[ns],roleKey:'finance',from,to})).metered.comparison;
 let c=compare(first.release,second.release);assert.equal(c.reason.status,'available');assert.equal(c.reason.text,'Recorded explanation');assert.equal(c.changes.length,5);
 const third=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','third',second.release,2)));assert.equal(compare(second.release,third.release).reason.status,'not-recorded');assert.equal(f.call('readRoleTaskContext',{mode:'compare',readSet:[ns],roleKey:'finance',from:first.release,to:third.release}).error.code,'invalid_input');
 ok(f.call('forget',{namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));c=compare(first.release,second.release);assert.equal(c.reason.status,'recorded-unavailable');assert.equal(c.reason.text,null);
 ok(f.call('deleteRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'delete',expectedCurrentRelease:third.release,expectedRegistryRevision:3,release:first.release,expectedRevision:1}));c=compare(first.release,second.release);assert.equal(c.status,'unavailable');assert.deepEqual(c.changes,[]);assert.equal(c.reason,null);
});
test('C05 evidence mutation during exact counting and revocation refuse the entire call',t=>{
 let armed=false,mutate,done=false;const h=host({counter:{id:'mutating',countTokens:text=>{if(armed&&!done&&text.includes('finance evidence')){done=true;mutate();}return Math.ceil(Buffer.byteLength(text)/4);}}}),f=fixture(t,{h});
 ok(f.call('publishRoleProfileRelease',publish()));const memory=admit(f,'finance evidence','evidence');mutate=()=>ok(f.call('forget',{namespace:ns,memoryId:memory.id,expectedRevision:1}));armed=true;
 const result=f.call('readRoleTaskContext',{...read(),task:'finance'});assert.equal(done,true);assert.equal(result.error?.code,'snapshot_stale');
});
test('C05 revoked grants during counting return scope_changed without delivering guidance',t=>{
 let armed=false;const h=host({counter:{id:'revoking',countTokens:text=>{if(armed)h.revoke();return Math.ceil(text.length/4);}}}),f=fixture(t,{h});ok(f.call('publishRoleProfileRelease',publish()));armed=true;
 assert.deepEqual(f.call('readRoleTaskContext',read()),{ok:false,error:{code:'scope_changed',retryable:false}});
});
test('C03 optional history pagination advances only by delivered rows and keeps receipt cardinalities bounded',t=>{
 const f=fixture(t);let head=null,revision=null,first;
 for(let i=0;i<5;i++){const release=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','release-'+i,head,revision,{duties:['Historical '+i+' '+ 'x'.repeat(250)],requiredOutputs:['Report']})));first??=release;head=release.release;revision=release.registry.revision;}
 const initial=ok(f.call('readRoleTaskContext',read())),limit=initial.diagnostics.budget.used+900;
 let cursor,ids=[];
 do{
  const result=ok(f.call('readRoleTaskContext',{...read(),budget:{maxTokens:limit},history:{profile:first.release.profile,...(cursor?{cursor}:{})}}));
  const history=result.metered.history;assert.ok(history.rows.length>0);ids.push(...history.rows.map(r=>r.ref.releaseId));cursor=history.nextCursor;assert.ok(JSON.parse(result.metered.receipt).p.profiles.length<=21);
  if(cursor)assert.equal(f.call('readRoleTaskContext',{...read(),budget:{maxTokens:limit+1},history:{profile:first.release.profile,cursor}}).error.code,'invalid_cursor');
 }while(cursor);
 assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
});
test('C02 note-referenced reasons retain exact availability through history, receipt then and restart',t=>{
 const h=host(),privateCards={version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority:h.authority},f=fixture(t,{h,privateCards});
 const note=ok(f.call('submitSourceNote',{namespace:ns,actionId:'note',text:'Independent recorded reason',occurredAt:null})).source;
 const first=ok(f.call('publishRoleProfileRelease',publish())),second=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','second',first.release,1),changeReason:{text:'Because of note',reasonRefs:[note]}}));
 const initial=ok(f.call('readRoleTaskContext',{...read(),history:{profile:first.release.profile}})).metered;assert.equal(initial.profile.release.changeReason.status,'available');assert.equal(initial.history.rows[0].changeReason.status,'available');
 f.reopen();const historical=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:initial.receipt,history:{profile:first.release.profile}})).metered;assert.equal(historical.profile.release.changeReason.status,'available');assert.equal(historical.history.rows[0].changeReason.status,'available');
 assert.equal(second.registry.revision,2);
});
test('C02 method comparisons reuse whole U2 verification and recorded-edge attribution under the role budget',t=>{
 const f=fixture(t),first=ok(f.call('importMethodVersion',{namespace:ns,actionId:'v1',title:'First',files:[{path:'guide.txt',text:'First',mediaType:'text/plain'}]}));
 const second=ok(f.call('importMethodVersion',{namespace:ns,actionId:'v2',title:'Second',package:first.package,basedOn:first.version,expectedPackageRevision:1,files:[{path:'guide.txt',text:'Second',mediaType:'text/plain'}],change:{items:[{summary:'Explicit method change',paths:['guide.txt']}],reasonRefs:[]}}));
 const value=ok(f.call('readRoleTaskContext',{mode:'compare',roleKey:'finance',readSet:[ns],from:first.version,to:second.version})).metered;
 assert.equal(value.comparison.kind,'method');assert.deepEqual(value.comparison.changes,[{key:'guide.txt',status:'changed'}]);assert.equal(value.comparison.reason.status,'not-recorded');assert.equal(value.comparison.items[0].summary,'Explicit method change');assert.equal(value.receipt,null);
});

test('C01 related references use only already authorized read-set scopes and never widen them',t=>{
 const f=fixture(t),memory=admit(f,'Personal related source','related'),ref={type:'memory',namespace:ns,memoryId:memory.id,revision:1};
 ok(f.call('publishRoleProfileRelease',publish(project,'finance','related-profile',null,null,{duties:['Review'],requiredOutputs:['Report'],related:[ref]})));
 assert.equal(ok(f.call('readRoleTaskContext',read('finance',[ns,project]))).metered.profile.release.fields.related.length,1);
 const restricted=ok(f.call('readRoleTaskContext',read('finance',[project]))).metered;assert.equal(restricted.profile.applicability,'unavailable');assert.equal(restricted.profile.release.fields,null);assert.equal(restricted.registries[0].revision,1);
});

test('C05 related-source forgetting fences current/history/comparison guidance but preserves registry CAS for recovery',t=>{
 const f=fixture(t),memory=admit(f,'Related canonical facts','related-fence'),ref={type:'memory',namespace:ns,memoryId:memory.id,revision:1};
 const first=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','related-first',null,null,{duties:['Review facts'],requiredOutputs:['Report'],related:[ref]})));
 const second=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','related-second',first.release,1,{duties:['Review updated facts'],requiredOutputs:['Report'],related:[ref]})));
 ok(f.call('forget',{namespace:ns,memoryId:memory.id,expectedRevision:1}));
 const value=ok(f.call('readRoleTaskContext',{...read(),history:{profile:first.release.profile}})).metered;assert.equal(value.profile.applicability,'unavailable');assert.equal(value.profile.release.fields,null);assert.ok(value.history.rows.every(r=>r.fields===null));
 const comparison=ok(f.call('readRoleTaskContext',{mode:'compare',roleKey:'finance',readSet:[ns],from:first.release,to:second.release})).metered.comparison;assert.equal(comparison.status,'unavailable');assert.deepEqual(comparison.changes,[]);
 const registry=value.registries[0];ok(f.call('disableRoleProfile',{namespace:ns,roleKey:'finance',actionId:'recover',expectedCurrentRelease:registry.currentRelease,expectedRegistryRevision:registry.revision}));
});

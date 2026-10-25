import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProductAgent,formatEvent } from '../product.mjs';
import { event,text,date } from './fixtures.mjs';
import { cardControl,safetyControl } from '../../generator/controls.mjs';
const namespace={ownerId:'hr3-hand',scope:'personal',projectId:null};
const counter={id:'synthetic-public-operation-test',countTokens:s=>Math.ceil(Buffer.byteLength(s)/4)};
const embedder={id:'synthetic-test',revision:'1',dimensions:1536,normalization:'l2',async embed(texts){return texts.map(()=>[1,...Array(1535).fill(0)]);}};
async function fixture(t){const p=await ProductAgent.open({namespace,embedder,counter});t.after(()=>p.close());return p;}
test('P imports only the public product entrypoints, has no SQL/storage/archive access',()=>{
 const source=readFileSync(new URL('../product.mjs',import.meta.url),'utf8');const imports=[...source.matchAll(/from\s+['"]([^'"]+)/g)].map(m=>m[1]);
 assert.deepEqual(imports.filter(s=>s.includes('/core/')||s.includes('/adapters/')),['../../../core/index.mjs','../../../adapters/mcp/server.mjs']);
 assert.doesNotMatch(source,/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b|node:sqlite|\.prepare\(|\.exec\(|createRequire|_registered|materialize\(/);
 assert.match(source,/find_memory_candidates/);assert.match(source,/read_memory_context/);
});
test('P corrects at inspected revision through MCP and actually loses old text/receipts',async t=>{
 const p=await fixture(t);await p.ingest([event(1)],date(1));const before=p.refs.get('e1');
 await p.ingest([event(2,{change_type:'correction'})],date(2));const after=p.inspect(before.id);assert.equal(after.ok,true);assert.equal(after.value.memory.revision,2);assert.equal(after.value.memory.content.includes('"2"'),true);assert.equal(after.value.receipts.length,1);assert.match(after.value.receipts[0].excerpt,/service route/);
 assert.ok(p.log.some(l=>l.surface==='mcp'&&l.method==='correct_memory'));assert.equal(p.refs.get('e2').id,before.id);
});
test('partial amendments preserve predecessor, whole reversal supersedes it, ambiguous mapping logs',async t=>{
 const p=await fixture(t);await p.ingest([event(1)],date(1));const one=p.refs.get('e1');
 await p.ingest([event(2,{change_type:'refinement',replacement_extent:'partial'})],date(2));assert.equal(p.inspect(one.id).value.memory.state,'active');
 await p.ingest([event(3)],date(3));assert.equal(p.inspect(p.refs.get('e2').id).value.memory.state,'historical');
 await p.ingest([event(4,{replacement_extent:'unresolved'})],date(4));assert.ok(p.log.some(l=>l.method==='unresolved_mapping'));
});
test('future activation and adapter scheduled expiry use public operations without fallback',async t=>{
 const p=await fixture(t),first=event(1,{effective_interval:{from:date(1),to:date(2)}});await p.ingest([first],date(1));const id=p.refs.get('e1').id;
 await p.ingest([],date(2));assert.equal(p.inspect(id).value.memory.state,'historical');assert.ok(p.log.some(l=>l.method==='adapter-scheduled'));
 const future=event(3,{change_type:'initial',predecessor_anchors:[],effective_interval:{from:date(4),to:null}});await p.ingest([future],date(3));assert.equal(p.refs.has('e3'),false);await p.ingest([],date(4));assert.equal(p.refs.has('e3'),true);
});
test('isolated file stores and all E-2 Card branches use real public revisions; unauthorized controls refuse',async t=>{
 const a=await fixture(t),b=await fixture(t);assert.notEqual(a.path,b.path);
 for(const authoringPath of ['confirm_with_dependencies','declare_separately']) for(let branch=0;branch<8;branch++){
  const p=await fixture(t),f={family_id:'hand-'+branch,lineage_id:'lineage',namespace},control=cardControl(f,branch,authoringPath);
  for(let batch=1;batch<=4;batch++)await p.controls([control],batch);
  const failures=p.log.filter(l=>l.surface==='core'&&l.result?.ok===false);assert.deepEqual(failures,[],JSON.stringify(failures));
  const confirmation=p.log.find(l=>l.surface==='core'&&l.method==='confirmCardDraft');
  assert.equal(Object.hasOwn(confirmation.input,'currentDependencies'),authoringPath==='confirm_with_dependencies');
  const declarations=p.log.filter(l=>l.surface==='core'&&l.method==='declareCardCurrentDependencies');
  assert.equal(declarations.length,authoringPath==='declare_separately'?1:0);
  if(declarations.length)assert.equal(declarations[0].input.expectedDependencyRevision,null);
  for(const review of p.log.filter(l=>l.surface==='core'&&l.method==='revalidateCardCurrentDependencies'))assert.ok(review.input.expectedDependencyRevision>0);
  assert.ok(p.symbols.cardId);const detail=p.call('getCard',{namespace,cardId:p.symbols.cardId}).value.card;
  assert.equal(detail.support.currentDependency.status,['adopt_v2','readopt_v1','v1_v2_v1','edit_without_review'].includes(control.branch)?'needs-review':'current');
  if(branch===7){const refusals=p.log.filter(l=>l.surface==='control'&&l.method==='unauthorized');assert.equal(refusals.length,3);assert.ok(refusals.every(r=>r.result.error.code==='approval_required'));}
 }
});
test('named forgetting suppresses replay, keeps independent copy, excludes foreign namespace',async t=>{
 const p=await fixture(t),control=safetyControl({family_id:'hand-safe',namespace});for(let batch=1;batch<=4;batch++)await p.controls([control],batch);
 const replay=p.log.filter(l=>l.method==='safety_admit').at(-1).result;assert.equal(replay.ok,false);assert.match(replay.error.code,/suppress/);
 assert.equal(p.inspect(p.symbols.forgotten).ok,false);assert.equal(p.inspect(p.symbols.independentCopy).ok,true);const d=await p.retrieve('seal');assert.equal(d.blocks.current.includes('Foreign-only'),false);assert.equal(d.blocks.current.includes('Independent copy'),true);
});
test('P pin hashes cover the current public product implementation',async()=>{
 const {verifyProductPin}=await import('../pin.mjs');assert.deepEqual(verifyProductPin(),{commit:'b2513501a6747a163ab1cefb7d37a16744c9621a',verifiedPaths:195});
});


test('P freshness uses internal keys and never reprocesses an already ingested event',async t=>{
 const {identifyEvents}=await import('../event-identity.mjs');const p=await fixture(t);
 const first=identifyEvents('same-family',1,[event(1)]),second=identifyEvents('same-family',2,[event(1,{source_turns:['t2'],observed_at:date(2)})]);
 await p.ingest(first,date(1));await p.ingest(second,date(2));
 assert.equal(p.events.length,2);assert.equal(p.refs.size,2);
 const selections=p.log.filter(x=>x.method==='receipt_selection').length;
 await p.ingest(first,date(3));assert.equal(p.events.length,2);assert.equal(p.log.filter(x=>x.method==='receipt_selection').length,selections);
});


test('P refuses private-label payloads before public ingestion and preserves returned context verbatim',async t=>{
 const p=await fixture(t),before=p.log.length;
 assert.throws(()=>p.call('admit',{namespace,memory:{content:'pilot-correction-L01-W1',kind:'context'},receipts:[]}),/private_label_leak/);
 assert.equal(p.log.length,before);
 await p.ingest([event(1)],date(1));
 const delivery=await p.retrieve('service');
 for(const op of p.log.filter(o=>o.surface==='core'||o.surface==='mcp'||o.surface==='constructor'))assert.ok(op.input,'Every public-operation argument is recorded for the independent scan');
 const raw=p.log.filter(o=>o.surface==='mcp'&&o.method==='read_memory_context');
 for(const [i,intent] of ['current','history'].entries())assert.equal(delivery.blocks[intent],raw[i].result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
});

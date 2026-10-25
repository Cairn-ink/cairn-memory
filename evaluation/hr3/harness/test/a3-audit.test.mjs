import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {cachedPilotBatches,identityDiagnostics} from '../replay-a3.mjs';
import {identifyEvents,eventKey} from '../event-identity.mjs';
import {anchorQuote} from '../schema.mjs';
import {deliveredIndex,resolveCitation} from '../../scorer/citations.mjs';
import {Ledger} from '../ledger.mjs';
import {loadCarryForward,auditLedger,FIRST_PILOT_LEDGER_SHA256} from '../accounting.mjs';
import {hash,canonical,bytes} from '../common.mjs';
import {responseRequest,validateRequest,embeddingRequest,INPUT_CAPS} from '../requests.mjs';
import {GuardedTransport,FakeTransport} from '../transport.mjs';
import {event,plan} from './fixtures.mjs';

const carryPath='evaluation/hr3/harness/reports/a3-carry-forward.json';
function scratch(t) {
  mkdirSync('evaluation/hr3/harness/artifacts',{recursive:true});const dir=mkdtempSync('evaluation/hr3/harness/artifacts/accounting-test-');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;
}
const save=(path,value)=>writeFileSync(path,JSON.stringify(value)+'\n');
const spec=path=>({path,sha256:hash(readFileSync(path))});
function manifest(dir,ledgers,preparation={complete:true,receipts:[]}) {
  const path=join(dir,'carry-'+hash({ledgers,preparation})+'.json');save(path,{version:'hr3-carry-forward-v1',ledgers,preparation});return path;
}
const request=(id='new')=>({id,operation:'extraction',body:responseRequest('extraction',{})});

test('cached corpus reproduces 55 collision families, 257 ID errors and 68 P reselections; internal keys remove all',()=>{
  const {table,...d}=identityDiagnostics(cachedPilotBatches());
  assert.deepEqual(d,{families:60,familiesWithCrossBatchCollisions:55,duplicateIdErrors:257,adoptedDuplicateIdErrors:56,oldReselections:68,newDuplicateIdErrors:0,newReselections:0});
  assert.equal(table.reduce((n,r)=>n+r.retainedEvents,0),605);
  const source=event(1),a=identifyEvents('family',1,[source]),b=identifyEvents('family',2,[source]),c=identifyEvents('other',1,[source]);
  assert.equal(a[0].event_id,eventKey('family',1,'e1'));assert.equal(new Set([...a,...b,...c].map(e=>e.event_id)).size,3);
  assert.deepEqual(a[0].predecessor_anchors,source.predecessor_anchors);assert.equal(source.event_id,'e1');
  assert.throws(()=>identifyEvents('family',1,[source,source]),/duplicate_event_id_within_batch/);
});

test('extraction overlaps are supported while reader overlap ambiguity remains unchanged',()=>{
  const q={turn_id:'t',quote:'aba',occurrence:2};assert.equal(anchorQuote(q,new Map([['t','ababa']])).start,2);
  const citation={intent:'current',item:0,unit:'body',source:null,quote:'aba',occurrence:2};
  const delivery=deliveredIndex([{...citation,aliases:[],segments:[{origin:'t',start:0,text:'ababa'}],normalize:false,truncate:null}]);
  assert.deepEqual(resolveCitation(citation,delivery),{ok:false,ambiguous:true,error:'ambiguous_overlapping_occurrence'});
});

test('hash-verified first-pilot ledger reproduces exact settlement and consumed embedding units',()=>{
  const m=JSON.parse(readFileSync(carryPath)),source=m.ledgers.find(s=>s.sha256===FIRST_PILOT_LEDGER_SHA256);assert.ok(source);
  const raw=readFileSync(source.path),a=auditLedger(raw.toString());assert.equal(hash(raw),source.sha256);
  assert.equal(a.exposure.settled,835244260);assert.equal(a.exposure.outstanding,0);
  assert.deepEqual(a.exposure.embedding,{research:174846,product:68457});assert.equal(a.exposure.reservations,1985);
  const c=loadCarryForward(carryPath);assert.equal(c.exposure.total,848623860);assert.equal(c.exposure.outstanding,12667200);
});

test('fresh ledger and restarts preserve settled charges, outstanding reservations and embedding counters',t=>{
  const dir=scratch(t),path=join(dir,'ledger.jsonl'),carry=loadCarryForward(carryPath);
  const ledger=new Ledger(path,{plan,carryForward:carryPath}),before=ledger.snapshot();
  assert.equal(before.total,carry.exposure.total);assert.deepEqual(before.embedding,carry.exposure.embedding);assert.deepEqual(before.unsettled,carry.exposure.unsettled);
  const r=ledger.reserve(request());assert.equal(ledger.snapshot().total,before.total+r.reserved);
  assert.deepEqual(new Ledger(path,{plan,carryForward:carryPath}).snapshot(),ledger.snapshot());
  assert.throws(()=>new Ledger(path,{plan}),/configuration_mismatch/);
  assert.throws(()=>ledger.settle('new',{requestId:carry.exposure.requestIds[0],usage:{inputTokens:0,outputTokens:0}}),/unexplained_usage/);
});

test('exact remaining stage/global/embedding allowances stop before dispatch at a one-nanodollar boundary',async t=>{
  const dir=scratch(t),seed=loadCarryForward(carryPath).exposure,r=request(),b=validateRequest(r),ceiling=b.input*b.inputRate+b.output*b.outputRate;
  for(const [name,limits] of [['stage',{stages:{pilot:(seed.total+ceiling-1)/1e9}}],['global',{operational:(seed.total+ceiling-1)/1e9}],['embedding',{embeddingUnits:{research:seed.embedding.research,product:seed.embedding.product}}]]) {
    const ledger=new Ledger(join(dir,name+'.jsonl'),{plan,carryForward:carryPath,limits});let sent=0;
    const transport=new GuardedTransport({async send(){sent++;throw Error('must not dispatch');}},ledger);
    const call=name==='embedding'?{id:'embed',operation:'product-embedding',body:embeddingRequest(['x'])}:r;
    await assert.rejects(transport.send(call),/cap_exceeded/);assert.equal(sent,0);assert.equal(ledger.snapshot().total,seed.total);
  }
  const exact=new Ledger(join(dir,'exact.jsonl'),{plan,carryForward:carryPath,limits:{stages:{pilot:(seed.total+ceiling)/1e9}}});
  exact.reserve(r);assert.equal(exact.snapshot().total,seed.total+ceiling);assert.throws(()=>exact.reserve(request('second')),/cap_exceeded/);
});

test('carry input rejects changed hashes, broken arithmetic, duplicate sources and overlapping ancestry',t=>{
  const dir=scratch(t),m=JSON.parse(readFileSync(carryPath)),first=m.ledgers[0];
  const bad=manifest(dir,[{...first,sha256:'0'.repeat(64)}]);assert.throws(()=>loadCarryForward(bad),/source_hash_mismatch/);
  assert.throws(()=>loadCarryForward(manifest(dir,[first,first])),/duplicate_or_overlapping/);
  const inherited=join(dir,'inherited.jsonl');new Ledger(inherited,{plan,carryForward:carryPath});
  assert.throws(()=>loadCarryForward(manifest(dir,[first,spec(inherited)])),/duplicate_or_overlapping/);
  const source=join(dir,'source.jsonl'),l=new Ledger(source,{plan});l.reserve(request());l.settle('new',{requestId:'synthetic',usage:{inputTokens:1,outputTokens:0}});
  const events=readFileSync(source,'utf8').trimEnd().split('\n').map(JSON.parse);events.at(-1).charged++;
  let prior='';writeFileSync(source,events.map(({digest,...e})=>{const row={...e,prior};const v={...row,digest:hash(row)};prior=v.digest;return canonical(v);}).join('\n')+'\n');
  assert.throws(()=>loadCarryForward(manifest(dir,[spec(source)])),/settlement_arithmetic/);
});

test('hash-verified exact preparation receipts participate in cumulative spending and units',t=>{
  const dir=scratch(t),receipt=join(dir,'receipt.json');save(receipt,{version:'hr3-preparation-charge-v1',charge_id:'synthetic-preparation-receipt',stage:'pilot',settledNanodollars:700001,outstandingNanodollars:321,embeddingUnits:{research:17,product:0}});
  const m=JSON.parse(readFileSync(carryPath)),path=manifest(dir,m.ledgers,{complete:true,receipts:[spec(receipt)]}),c=loadCarryForward(path);
  assert.equal(c.preparationComplete,true);assert.equal(c.exposure.total,846911460+700001+321);assert.equal(c.exposure.embedding.research,174846+17);
  const l=new Ledger(join(dir,'ledger.jsonl'),{plan,carryForward:path});assert.equal(l.snapshot().total,c.exposure.total);
});

test('complete request certificate covers auditor U/T requests, all provider framing and maximal structures',()=>{
  const r=JSON.parse(readFileSync(new URL('../reports/request-certification-a3.json',import.meta.url)));
  assert.equal(r.status,'PASS');assert.deepEqual(r.inputCaps,INPUT_CAPS);assert.equal(r.counts.families,240);
  assert.deepEqual(r.historicalAuditReservations.map(x=>[x.arm,x.reservation]),[['U',20855],['T',24133]]);
  assert.ok(r.rows.every(row=>row.pass&&row.marginPercent>=r.minimumMarginPercent));
  assert.deepEqual([...new Set(r.rows.filter(x=>x.operation==='reader').map(x=>x.arm))].sort(),['O','P','T','U']);
  const encoder=createRequire(new URL('../../../../adapters/openai/package.json',import.meta.url))('tiktoken').get_encoding('o200k_base');
  try {for(const [operation,worst] of Object.entries(r.worst)) {
    assert.equal(bytes(worst.body)+4096,worst.reservation);assert.equal(hash(worst.body),worst.sha256);
    assert.equal(encoder.encode(JSON.stringify(worst.body),[],[]).length,worst.providerBodyTokens);
    assert.equal(validateRequest({operation,body:worst.body,id:worst.arm?`${worst.family}/reader/${worst.arm}/${worst.batch}`:'certificate'}).input,worst.reservation);
  }}finally{encoder.free();}
  assert.throws(()=>validateRequest({operation:'reader',body:responseRequest('reader',{delivered:{current:'x'.repeat(INPUT_CAPS.reader),history:''}})}),/request_byte_bound/);
});


test('real execution refuses missing or incomplete carry-forward input before any dispatch',async t=>{
 const {run}=await import('../runner.mjs');const dir=scratch(t);let sent=0;
 const transport={async send(){sent++;throw Error('must not dispatch');}};
 const incomplete=JSON.parse(readFileSync(carryPath));incomplete.preparation.complete=false;
 const path=join(dir,'incomplete.json');save(path,incomplete);
 for(const carryForward of [null,path])await assert.rejects(run({stage:'smoke',inputs:'evaluation/hr3/generator/artifacts/pilot',out:join(dir,carryForward?'incomplete-out':'missing-out'),transport,carryForward}),/verified_complete_carry_forward_required/);
 assert.equal(sent,0);
});


test('classified reader input ceilings used by the pilot budget are enforced before dispatch',()=>{
 const base={delivered:{current:'',history:''}},overhead=bytes(responseRequest('reader',base))+4096;
 const body=responseRequest('reader',{delivered:{current:'x'.repeat(23000-overhead),history:''}});
 assert.equal(validateRequest({id:'family/reader/U/4/attempt-0',operation:'reader',body}).input,23000);
 assert.throws(()=>validateRequest({id:'family/reader/O/4/attempt-0',operation:'reader',body}),/request_byte_bound/);
});

// Independent behavioral replay, no paid transport or production journal.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Ledger} from '../ledger.mjs';
import {GuardedTransport} from '../transport.mjs';
import {responseRequest} from '../requests.mjs';
import {hash,canonical} from '../common.mjs';
import {plan} from './fixtures.mjs';
const h='evaluation/hr3/harness',source=readFileSync(h+'/test/fixtures/ledger-feb05af6.mjs.txt','utf8');
assert.equal(hash(source),'c1bb83ff0189c9818d5eb2f384ef4afae57d082a34ec934c004a07ed28f1aa7a');
const base=new URL('../ledger.mjs',import.meta.url),rebased=source.replace(/from '(\.\/[^']+)'/g,(_,p)=>'from '+JSON.stringify(new URL(p,base).href));
const {Ledger:OldLedger}=await import('data:text/javascript;base64,'+Buffer.from(rebased).toString('base64'));
const results=[];
for(const defect of ['deleted','valid-prefix','configuration-replaced']){
 const pair={defect};
 for(const [version,Writer]of [['feb05af6',OldLedger],['fixed',Ledger]]){
  const dir=mkdtempSync(h+'/artifacts/ledger-replay-');
  try{
   const path=join(dir,'ledger.jsonl'),ledger=new Writer(path,{plan,carryForward:h+'/reports/a4-carry-forward.json'}),prefix=readFileSync(path);
   const request=id=>({id,operation:'reader',body:responseRequest('reader',{})});
   ledger.reserve(request('accepted'));const beforeExposure=ledger.snapshot().total;
   if(defect==='deleted')rmSync(path);
   else if(defect==='valid-prefix')writeFileSync(path,prefix);
   else {const events=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);delete events[0].configuration.carryForward;let prior='';writeFileSync(path,events.map(({digest,...data})=>{const e={...data,prior};prior=hash(e);return canonical({...e,digest:prior});}).join('\n')+'\n');}
   const damaged=existsSync(path)?readFileSync(path):null;let dispatches=0,error=null;
   const guard=new GuardedTransport({async send(r){dispatches++;return {requestId:'local-'+r.id,model:r.body.model,status:'completed',outputText:'{}',usage:{inputTokens:1,outputTokens:1}};}},ledger);
   try{await guard.send(request('must-block'));}catch(e){error=e.code??e.message;}
   pair[version]={beforeExposure,dispatches,error,afterExposure:version==='feb05af6'?ledger.snapshot().total:null,journalUnchanged:(!existsSync(path)&&damaged===null)||(existsSync(path)&&damaged!==null&&readFileSync(path).equals(damaged))};
   if(version==='fixed'){assert.equal(dispatches,0);assert.match(error,/accounting_mismatch:ledger_/);assert.equal(pair[version].journalUnchanged,true);}
   else {assert.equal(dispatches,1);assert.equal(error,null);assert.ok(pair[version].afterExposure<beforeExposure);}
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
 results.push(pair);
}
writeFileSync(h+'/reports/recheck-ledger-replay.json',JSON.stringify({status:'PASS',baseline:'feb05af6',baselineSourceSHA256:hash(source),validStubReplies:true,networkCalls:0,paidCalls:0,results},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',defects:results.length,oldDispatches:results.map(x=>x.feb05af6.dispatches),fixedDispatches:results.map(x=>x.fixed.dispatches)}));

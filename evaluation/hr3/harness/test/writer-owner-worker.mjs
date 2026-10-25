// Test-only independent process. Atomic file mailboxes avoid pipe-specific
// child-stdio behavior and give CPU-limited runs a complete final poll.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {runInNewContext} from 'node:vm';
import {dirname} from 'node:path';
import {Ledger as CurrentLedger} from '../ledger.mjs';
import {writerOwnerIdentity} from '../writer-owner.mjs';
import {hash,canonical,fail,atomicJSON} from '../common.mjs';
import {loadCarryForward,verifyCarrySnapshot} from '../accounting.mjs';
import {responseRequest,validateRequest} from '../requests.mjs';
import {plan} from './fixtures.mjs';
const path=process.argv[2],baseline=process.argv[3]==='baseline',mailbox=process.argv[4],unlinks=[];
const original=fs.unlinkSync;
fs.unlinkSync=p=>{unlinks.push({marker:p.slice(p.lastIndexOf('/')+1),underLock:fs.existsSync(path+'.lock')});return original(p);};syncBuiltinESMExports();
const source=fs.readFileSync(new URL(baseline?'./fixtures/ledger-d5ab6bd3.mjs.txt':'../ledger.mjs',import.meta.url),'utf8');let Writer=CurrentLedger;
if(baseline){if(hash(source)!=='496e0afbb82f3c53ba691fe0e590c44d3d9bccc9549ac243a6f6b28b2fa7c818')throw Error('old_ledger_fixture_changed');const context={...fs,dirname,hash,canonical,fail,atomicJSON,loadCarryForward,verifyCarrySnapshot,validateRequest,Buffer};runInNewContext(source.replace(/^import .*\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.Result=Ledger;',context);Writer=context.Result;}
const send=value=>atomicJSON(mailbox+'.reply-'+value.id+'.json',value);
try{
 const ledger=new Writer(path,{plan});let release=null;
 send({id:0,pid:process.pid,ledgerSHA256:hash(source)});
 let last=-1;setInterval(()=>{
  if(!fs.existsSync(mailbox+'.request.json'))return;
  const {id,operation,value}=JSON.parse(fs.readFileSync(mailbox+'.request.json'));if(id<=last)return;last=id;let result={id,error:null};
  try{
   if(operation==='hold'){release=ledger.writerPriority();result.markers=fs.readdirSync(path+'.lock.writers');}
   else if(operation==='release'){release?.();release=null;}
   else if(operation==='identity')result.owner=writerOwnerIdentity();
   else if(operation==='snapshot')result.state=ledger.snapshot();
   else if(operation==='read')result.records=ledger.read().length;
   else if(operation==='reserve')result.record=ledger.reserve({id:value,operation:'reader',body:responseRequest('reader',{})});
   else if(operation!=='ping')throw Error('unknown_worker_command');
  }catch(error){result.error=error.code??error.message;result.writerIntents=error.writerIntents??[];}
  result.report=ledger.writerIntentReport??null;result.unlinks=[...unlinks];send(result);
 },10);
}catch(error){send({id:0,fatal:error.code??error.message});process.exitCode=1;}

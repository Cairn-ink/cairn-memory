import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { lineageHost,ns } from './card-lineage-fixture.mjs';
let uuid=0,random=0;
crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`;
crypto.randomBytes=n=>Buffer.alloc(n,++random);
syncBuiltinESMExports();
const NativeDate=Date;
globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:['2026-01-01T00:00:00.000Z']));}static now(){return 1767225600000;}};
Object.defineProperty(performance,'now',{value:()=>0,configurable:true});
const {openMemoryCore}=await import(pathToFileURL(join(process.argv[2],'core/index.mjs')).href);
const host=lineageHost(),core=openMemoryCore({path:process.argv[3],privateCards:host.options,
  model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}});
const statements=[],prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
DatabaseSync.prototype.prepare=function(sql){const statement=Reflect.apply(prepare,this,[sql]);for(const method of ['get','all','iterate','run']) {
  const fn=statement[method];statement[method]=function(...args){statements.push([sql.replace(/\s+/g,' ').trim(),method]);return Reflect.apply(fn,this,args);};
}return statement;};
DatabaseSync.prototype.exec=function(sql){statements.push([sql.replace(/\s+/g,' ').trim(),'exec']);return Reflect.apply(exec,this,[sql]);};
const calls=[],call=(method,input)=>{const r=host.call(core,method,input);if(!r.ok)throw Error(JSON.stringify(r));calls.push([method,r]);return r.value;};
const source=call('submitSourceNote',{actionId:'source',text:'Synthetic source bytes.',occurredAt:null}).source;
let card=call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic body bytes.',sources:[source]}});
call('getCard',{cardId:card.id});call('listCards',{states:['draft','confirmed']});
card=call('confirmCardDraft',{actionId:'confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'});
call('fetchEvidence',{refs:[{type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision}],intent:'current'});
call('getSource',{source});call('mapEvidence',{type:'card'});
const captured=await core.capture({namespace:ns,client:'synthetic',sessionId:'off-session',eventId:'off-capture',
  messages:[{id:'message',role:'assistant',content:'Synthetic capture bytes.'}]});
if(!captured.ok)throw Error(JSON.stringify(captured));
calls.push(['capture',captured]);core.close();
DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;
const db=new DatabaseSync(process.argv[3]);
try {
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
  const dump=tables.map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()]);
  process.stdout.write(JSON.stringify({calls,statements,dump}));
} finally {db.close();}

// Preparation-only SQLite process. Never opens raw database file descriptors.
// Seed crypto and wall clock before loading fixture/engine modules, exclusively
// in this disposable child; no installed engine source is modified.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { seed,inventory,memoryText,cardText } from './corpus.mjs';
const configuration=JSON.parse(process.argv[2]);
let ordinal=0;
const bytes=n=>{const chunks=[];for(let left=n;left>0;left-=32)chunks.push(crypto.createHash('sha256').update(`${seed}:${configuration.schema}:${ordinal++}`).digest());return Buffer.concat(chunks).subarray(0,n);};
crypto.randomBytes=bytes;
crypto.randomUUID=()=>{const b=bytes(16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
syncBuiltinESMExports();
const RealDate=Date;
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-01-01T00:00:00.000Z']));}static now(){return 1767225600000;}};
const {openDatabase}=await import('../../core/database.mjs');
const {installOverviewLayout}=await import('../../core/testing/topic-overview-raw29-fixture.mjs');
const {openMemoryCore}=await import('../../core/index.mjs');
const {cardHost}=await import('../../core/testing/raw-source-fixtures.mjs');
const {card}=await import('../../core/testing/context-product-owner-fixture.mjs');
const {ok,receipt}=await import('../../core/testing/context-read-fixture.mjs');
const {DatabaseSync}=await import('node:sqlite');
if(!configuration.inspectOnly) {
if(configuration.schema===33)openDatabase(configuration.path,{privateCards:true,currentDependencies:true}).close();
else installOverviewLayout(configuration.path,configuration.schema);
const host=cardHost(),core=openMemoryCore({path:configuration.path,...(configuration.schema===18?{}:{privateCards:host.options})});
var catalog=[];
try {
  for(let i=0;i<configuration.count;i++) {
    if(i%256===0)process.stderr.write(`preparing v${configuration.schema}: memory ${i}/${configuration.count}\n`);
    const namespace=inventory[i%4],content=memoryText(i);
    const m=ok(core.admit({namespace,memory:{content,kind:'fact'},receipts:[receipt(`qualification-${i}`,content)]})).memory;
    catalog.push({ordinal:i,ref:{type:'memory',namespace,memoryId:m.id,revision:m.revision},text:content});
  }
  for(let i=0;i<configuration.cards;i++){
    const namespace=inventory[i%4],{title,body}=cardText(i);
    const c=card({call:(method,input)=>host.call(core,method,input)},namespace,title,body);
    catalog.push({ordinal:i,ref:{type:'card',namespace,cardId:c.id,revision:c.revision,bodyRevision:c.bodyRevision},text:title+'\n'+body});
  }
} finally {core.close();}
}
const db=new DatabaseSync(configuration.path);
let contentHash,schemaHash;
try {
  for(const entry of catalog??[]){const row=db.prepare(entry.ref.type==='memory'?'SELECT content AS text FROM memories WHERE id=?':"SELECT title||char(10)||body AS text FROM private_cards WHERE id=?").get(entry.ref.memoryId??entry.ref.cardId);entry.text=row.text;}
  if(db.prepare('PRAGMA user_version').get().user_version!==configuration.schema)throw Error('physical_schema_changed');
  if(db.prepare('SELECT count(*) AS n FROM memories WHERE deleted=0').get().n!==configuration.count)throw Error('memory_count');
  const hasCards=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='private_cards'").get();
  if(configuration.schema===18?hasCards:db.prepare('SELECT count(*) AS n FROM private_cards').get().n!==configuration.cards)throw Error('card_count');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('integrity');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('foreign_keys');
  if(!configuration.inspectOnly)db.exec('PRAGMA journal_mode=DELETE; VACUUM');
  const tables=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const h=crypto.createHash('sha256');
  for(const {name} of tables){const q='"'+name.replaceAll('"','""')+'"';const rows=db.prepare(`SELECT * FROM ${q}`).all().map(r=>JSON.stringify(r,(_,v)=>typeof v==='bigint'?v.toString():v)).sort();h.update(JSON.stringify([name,rows])+'\n');}
  contentHash=h.digest('hex');
  schemaHash=crypto.createHash('sha256').update(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all())).digest('hex');
}finally{db.close();}
console.log(JSON.stringify({contentHash,schemaHash,catalog}));

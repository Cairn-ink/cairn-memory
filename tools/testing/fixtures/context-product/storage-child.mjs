// Separate SQLite process. This child never reads or copies raw database bytes.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { observeLoop } from './engine.mjs';
const kind=process.argv[2];let encoded=process.argv[3];if(encoded===undefined){encoded='';for await(const chunk of process.stdin)encoded+=chunk;}
const c=JSON.parse(encoded),loop=observeLoop();
const {DatabaseSync,backup}=await import('node:sqlite');
let value;
if(kind==='busy-probe') {
  const db=new DatabaseSync(c.path,{timeout:0});try{db.prepare('SELECT count(*) FROM memories').get();value={busy:0};}catch(e){value={busy:Number.isInteger(e.errcode)?e.errcode&255:0};}finally{db.close();}
} else if(kind==='lock') {
  const db=new DatabaseSync(c.path);db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
  process.send({type:'ready'});await new Promise(r=>process.once('message',r));
  db.exec('ROLLBACK');db.close();
} else if(kind==='seed') {
  const {openMemoryCore}=await import('../../../../core/index.mjs');
  const cardHost=c.cards?(await import('../../../../core/testing/raw-source-fixtures.mjs')).cardHost():null;
  const core=openMemoryCore({path:c.path,...(cardHost?{privateCards:cardHost.options}:{})});
  try {for(let i=0;i<c.count;i++){
    const namespace=c.inventory[i%c.inventory.length],content=`Synthetic needle 中文 日本語 mixed ${String(i).padStart(5,'0')}`;
    const r=core.admit({namespace,memory:{content,kind:'fact'},receipts:[{client:'product-measure',sessionId:'tiny',eventId:String(i),role:'user',excerpt:content}]});
    if(!r.ok)throw Error('seed_failed');
  }}finally{core.close();}
} else if(kind==='mode') {
  const db=new DatabaseSync(c.path);try{value=db.prepare(`PRAGMA journal_mode=${c.mode==='WAL'?'WAL':'DELETE'}`).get();}finally{db.close();}
} else if(kind==='inspect'||kind==='verify') {
  const start=performance.now(),db=new DatabaseSync(c.path,{readOnly:true});
  try {
    const schema=db.prepare('PRAGMA user_version').get().user_version;
    const memory=db.prepare('SELECT owner_id,scope,project_id,id,revision,content FROM memories WHERE deleted=0 ORDER BY owner_id,scope,project_id,id').all();
    const cards=schema>=23?db.prepare('SELECT * FROM private_cards ORDER BY id').all():[];
    const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    value={schema,memory,cards,memories:memory.length,cardCount:cards.length,integrity,
      logicalHash:createHash('sha256').update(JSON.stringify([memory,cards])).digest('hex'),verifyMs:performance.now()-start};
  }finally{db.close();}
} else if(kind==='verify-sidecar') {
  const start=performance.now(),db=new DatabaseSync(c.path,{readOnly:true});
  try {
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('sidecar_integrity');
    const publications=db.prepare('SELECT * FROM publications ORDER BY projection').all();
    if(publications.length!==2)throw Error('projection_count');
    let verifiedRows=0;
    for(const pub of publications) {
      const certificate=JSON.parse(db.prepare('SELECT record FROM validation_records WHERE publication=?').get(pub.publication).record);
      const generation=db.prepare('SELECT * FROM generations WHERE id=?').get(pub.generation),hash=createHash('sha256');
      if(!generation.published)throw Error('unpublished');
      const docs=db.prepare('SELECT * FROM documents WHERE generation=? ORDER BY identity').all(pub.generation);
      let n=0,total=0;
      for(const r of docs) {
        const sum=db.prepare('SELECT coalesce(sum(frequency),0) n FROM postings WHERE generation=? AND identity=?').get(pub.generation,r.identity).n;
        if(sum!==r.token_length||!r.eligible&&sum)throw Error('document_statistics');
        hash.update(JSON.stringify(['document',JSON.parse(r.identity),r.revision,r.body_revision,r.eligible,r.representation,r.token_length])+'\n');verifiedRows++;n+=r.eligible;total+=r.token_length;
      }
      for(const r of db.prepare('SELECT * FROM postings WHERE generation=? ORDER BY identity,term').all(pub.generation)) {
        if(!r.term||!docs.some(d=>d.identity===r.identity&&d.eligible))throw Error('posting_eligibility');
        hash.update(JSON.stringify(['posting',JSON.parse(r.identity),r.term,r.frequency])+'\n');verifiedRows++;
      }
      for(const r of db.prepare('SELECT * FROM statistics WHERE generation=? ORDER BY term').all(pub.generation)) {
        const df=db.prepare('SELECT count(*) n FROM postings WHERE generation=? AND term=?').get(pub.generation,r.term).n;
        if(r.term===''?(r.n!==n||r.total_length!==total||r.df!==0):(r.df!==df||r.n!==0||r.total_length!==0))throw Error('term_statistics');
        hash.update(JSON.stringify(['statistics',r.term,r.df,r.n,r.total_length])+'\n');verifiedRows++;
      }
      if(hash.digest('base64url')!==certificate.manifestDigest||generation.manifest!==certificate.manifestDigest)throw Error('manifest_digest');
    }
    value={sidecarVerifyMs:performance.now()-start,verifiedRows,publications:publications.length};
  }finally{db.close();}
} else if(kind==='backup') {
  const start=performance.now(),db=new DatabaseSync(c.path,{readOnly:true});
  try{await backup(db,c.destination);value={backupMs:performance.now()-start};}finally{db.close();}
} else throw Error('storage_child_kind');
const hostLoop=await loop.finish();
if(kind==='lock')process.send({type:'result',hostLoop},()=>process.disconnect());
else console.log(JSON.stringify({value:value??null,hostLoop}));

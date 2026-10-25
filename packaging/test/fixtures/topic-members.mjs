// Installed-only synthetic reader host: never resolve runtime from the checkout.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { register, syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import workerThreads from 'node:worker_threads';
const [installed, scratch] = process.argv.slice(2);
register('data:text/javascript,' + encodeURIComponent(`import{fileURLToPath}from'node:url';let root;export function initialize(d){root=d.root}export async function resolve(s,c,n){const r=await n(s,c);if(r.url.startsWith('file:')&&!fileURLToPath(r.url).startsWith(root+'/'))throw Error('installed_member_source_fallback');return r}`),
  { parentURL: import.meta.url, data: { root: installed } });
const NativeWorker = workerThreads.Worker, workers = [];
workerThreads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert.equal(fileURLToPath(url), join(installed,'core/topic-overview-worker.mjs'));
    super(url,options); const record = { closed:false }; workers.push(record); this.once('exit',()=>{record.closed=true;});
  }
}; syncBuiltinESMExports();
const importedCore = join(installed,'core/index.mjs');
const {openMemoryCore,openMemoryReader}=await import(pathToFileURL(importedCore));
const {openDatabase,STORAGE_BUSY_TIMEOUT_MS}=await import(pathToFileURL(join(installed,'core/database.mjs')));
const namespace={ownerId:'installed-members',scope:'personal',projectId:null};
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
const outcomes=[];
try {
  for(const version of [18,33]) for(const mode of ['DELETE','WAL']) {
    const path=join(scratch,`member-${version}-${mode}.sqlite`),core=openMemoryCore({path});
    const db=new DatabaseSync(path);db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}; PRAGMA journal_mode=${mode}`);
    let reader;
    try {
      let epoch;const memories=[];
      for(let i=0;i<5;i++) {
        const saved=ok(core.admit({namespace,memory:{content:'INSTALLED_MEMBER_BODY_SENTINEL '+i,kind:i%2?'decision':'fact'},receipts:[{client:'synthetic',sessionId:'installed',eventId:String(i),role:'user',excerpt:'Synthetic.'}]}));
        epoch=saved.indexRevision;memories.push(saved.memory);
      }
      const place=items=>{const r=ok(core.applyPlacement({namespace,expectedIndexRevision:epoch,expectedMemoryRevisions:items.map(item=>({memoryId:item.memoryId,revision:ok(core.get({namespace,memoryId:item.memoryId})).memory.revision})),proposal:{items}}));epoch=r.indexRevision;return r;};
      const first=place([{memoryId:memories[0].id,parentIds:[],newL1:{title:'a',parentL2Ids:[],newL2Title:'root'}}]);
      const root=first.createdMocs.find(n=>n.level==='L2'),a=first.createdMocs.find(n=>n.level==='L1');
      const b=place([{memoryId:memories[1].id,parentIds:[],newL1:{title:'b',parentL2Ids:[root.id]}}]).createdMocs[0];
      place([{memoryId:memories[2].id,parentIds:[a.id,b.id]}]);
      core.close();
      if(version===33) {const current=openDatabase(path,{currentDependencies:true});current.close();}
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
      assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_conversations'").get()),version===33);
      const before=readFileSync(path),beforeWal=mode==='WAL'?readFileSync(path+'-wal'):null;
      reader=openMemoryReader({path,ownerId:namespace.ownerId});
      const legacy=ok(await reader.readTopicOverview({namespace}));assert.deepEqual(Object.keys(legacy.snapshot),['indexRevision','generation']);
      const issued=ok(await reader.readTopicOverview({namespace,snapshotVersion:'topic-snapshot-v1'})),snapshot=JSON.parse(JSON.stringify(issued.snapshot));
      const node=issued.items.find(n=>n.id===root.id);
      const input={namespace,selection:{type:'moc',mocId:node.id,revision:node.revision,level:'L2'},accessRevision:'grant',limit:1,expectedSnapshot:snapshot};
      const refs=[];let cursor,lastInput,last;
      do {
        lastInput=cursor;
        last=await reader.readTopicMembers(JSON.parse(JSON.stringify({...input,...(cursor?{cursor}:{})})));
        const page=ok(last);assert.equal(page.snapshot.originToken,snapshot.originToken);refs.push(...page.items);cursor=page.nextCursor;
      }while(cursor);
      assert.equal(refs.length,3);assert.equal(new Set(refs.map(r=>r.id)).size,3);
      assert.deepEqual(refs.map(r=>r.id),memories.slice(0,3).map(r=>r.id).sort());
      assert.deepEqual(await reader.readTopicMembers({...input,cursor:lastInput}),last);
      const unfiled={namespace,selection:{type:'unfiled'},accessRevision:'grant',limit:1};
      const u=ok(await reader.readTopicMembers(unfiled));assert.equal(u.items.length,1);assert.equal(u.items[0].reportedUnder,null);
      assert.equal(ok(await reader.readTopicMembers({...unfiled,cursor:u.nextCursor})).coverage.complete,true);
      if(mode==='DELETE') {
        db.exec('BEGIN EXCLUSIVE');
        try{assert.deepEqual(await reader.readTopicMembers({...unfiled,cursor:u.nextCursor}),{ok:false,error:{code:'storage_busy'}});}
        finally{db.exec('ROLLBACK');}
        assert.equal((await reader.readTopicMembers({...unfiled,cursor:u.nextCursor})).ok,true);
      } else {
        db.exec('BEGIN IMMEDIATE');try{assert.equal((await reader.readTopicMembers(unfiled)).ok,true);}finally{db.exec('ROLLBACK');}
      }
      assert.deepEqual(readFileSync(path),before);if(mode==='WAL') assert.deepEqual(readFileSync(path+'-wal'),beforeWal);
      const pending=ok(await reader.readTopicMembers(unfiled));
      // Mutate through installed public core, after validating quiescent bytes.
      const writer=openMemoryCore({path});
      try{const m=ok(writer.get({namespace,memoryId:memories[4].id})).memory;ok(writer.forget({namespace,memoryId:m.id,expectedRevision:m.revision}));}finally{writer.close();}
      assert.deepEqual(await reader.readTopicMembers({...unfiled,cursor:pending.nextCursor}),{ok:false,error:{code:'cursor_stale'}});
      assert.doesNotMatch(JSON.stringify({refs,u}),/INSTALLED_MEMBER_BODY_SENTINEL/);
      outcomes.push({version,mode,members:refs.length,unfiled:2,unchanged:true});
    }finally{await reader?.close();db.close();core.close();}
  }
  assert.ok(workers.every(w=>w.closed));console.log(JSON.stringify({importedCore,workersClosed:true,outcomes}));
}finally{workerThreads.Worker=NativeWorker;syncBuiltinESMExports();}

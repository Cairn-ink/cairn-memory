import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { transaction } from '../../core/database.mjs';
import { writeContentSuppressionInside } from '../../core/content-suppression-storage.mjs';
import { rawNamespace as ns } from '../../core/testing/raw-fixtures.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const summary = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  const at = q => sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)] ?? null;
  return {samples:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null};
};
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));

// Synthetic canonical rows retain actual receipt identities and source spans.
export function seedMeasurementLineage(db,count) {
  const memory = db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,
    confidence,revision,deleted,created_at,updated_at,currentness,review_state)
    VALUES(?,?,?,'',?,?,'fact','explicit',.8,1,0,?,?,'current','none')`);
  const receipt = db.prepare('INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const edge = db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)');
  const origin = db.prepare("INSERT INTO raw_receipt_origins VALUES(?,'derived')");
  const select = db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? AND message_id=?');
  const timestamp = '2026-01-02T00:00:00.000Z';
  const result = {memories:0,receipts:0,edges:0,crossConversation:0,crossNamespace:0,facts:0};
  transaction(db,()=>{
    for(let i=0;i<count;i+=5) {
      const mid='lineage-memory-'+i,content='Synthetic retained fact '+i;
      memory.run(mid,ns.ownerId,ns.scope,digest(content),content,timestamp,timestamp);
      result.memories++;
      if(result.memories%20===0) {
        writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:mid,reason:'user_forget',actionId:'synthetic-fact-'+i});
        result.facts++;
      }
      for(let j=0;j<1+(result.memories%3);j++) {
        const index=i+j,session='session-'+String(Math.floor(index/50)).padStart(5,'0');
        const messageId='message-'+String(index).padStart(6,'0'),row=select.get(session,messageId);
        const rid='lineage-receipt-'+i+'-'+j;
        const excerpt=db.prepare('SELECT CAST(sealed AS TEXT) AS text FROM raw_parts WHERE conversation_id=? AND message_id=? ORDER BY part_index LIMIT 1')
          .get(session,messageId).text.slice(0,200);
        const value={client:'codex',sessionId:session,eventId:messageId,role:'user',excerpt};
        receipt.run(rid,mid,digest(JSON.stringify(value)),value.client,session,messageId,'user',excerpt,timestamp);
        origin.run(rid);result.receipts++;
        const edgeCount=1+(result.receipts%2),split=Math.floor(row.total_units/2);
        for(let k=0;k<edgeCount;k++) {
          let conversation=session;
          // Approximately five percent cross conversations; half of those
          // also cross namespaces. Duplicate message identities are canonical
          // per conversation, and the predicate still denies foreign ancestry.
          if(result.edges%20===19) {
            conversation='lineage-ancestor-'+result.edges;
            const elsewhere=result.crossConversation%2===0;
            db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)')
              .run(conversation,ns.ownerId,elsewhere?'project':ns.scope,elsewhere?'synthetic-project':'','codex',conversation,timestamp,timestamp);
            const columns=Object.keys(row),quoted=columns.map(name=>'"'+name+'"');
            db.prepare('INSERT INTO raw_messages('+quoted.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')')
              .run(...columns.map(name=>name==='conversation_id'?conversation:row[name]));
            for(const table of ['raw_parts','raw_source_maps']) {
              const retained=db.prepare('SELECT * FROM '+table+' WHERE conversation_id=? AND message_id=?').all(session,messageId);
              for(const part of retained) {
                const fields=Object.keys(part);
                db.prepare('INSERT INTO '+table+'('+fields.map(name=>'"'+name+'"').join(',')+') VALUES('+fields.map(()=>'?').join(',')+')')
                  .run(...fields.map(name=>name==='conversation_id'?conversation:part[name]));
                if(table==='raw_parts')db.prepare('UPDATE raw_owner_usage SET saved_bytes=saved_bytes+? WHERE owner_id=?').run(part.byte_count,ns.ownerId);
              }
            }
            result.crossConversation++;if(elsewhere)result.crossNamespace++;
          }
          edge.run(rid,conversation,messageId,k?split:0,k||edgeCount===1?row.total_units:split,'exact');
          result.edges++;
        }
      }
    }
  });
  return result;
}

function scanName(sql) {
  for(const [marker,name] of [
    ['SELECT x.*','exclusions'],['SELECT f.* FROM raw_session_fences','session-fences'],
    ['SELECT l.* FROM edges l','lineage'],['SELECT l.receipt_id,l.conversation_id','ancestors'],
    ['SELECT r.*,m.id AS parent_id','receipts'],['SELECT a.*','maps'],
    ['SELECT f.* FROM content_suppressions','facts'],['SELECT e.*','suppression-epochs'],
    ['SELECT type,name,tbl_name,sql','schema'],['SELECT * FROM content_safety_control','control'],
    ['SELECT id,owner_id','conversations'],['SELECT p.conversation_id','parts'],
    ['SELECT client,revision','capture-controls']])if(sql.includes(marker))return name;
  return 'other';
}

// Wrappers observe the native statements and preserve their results/errors.
// No raw file descriptors, alternate SQLite binding, or runtime hook is used.
function observe() {
  const prepare=DatabaseSync.prototype.prepare;
  let current=null;
  const session=new Session(),scripts=new Map(),sources=new Map();session.connect();
  session.on('Debugger.scriptParsed',({params})=>scripts.set(params.scriptId,params.url));
  session.post('Debugger.enable');session.post('Debugger.setPauseOnExceptions',{state:'all'});
  session.on('Debugger.paused',({params})=>{
    try {
      if(current&&params.reason==='exception') {
        const frame=params.callFrames.find(frame=>['/core/raw-search-authority.mjs','/core/raw-search-index.mjs']
          .some(path=>(scripts.get(frame.location.scriptId)??'').endsWith(path)));
        const description=params.data?.description??'';
        if(frame&&frame.functionName!=='safeFailure'&&description.includes('MemoryStoreError')&&
            !(current.exceptions.length&&description.startsWith('MemoryStoreError: raw_search_unavailable'))) {
          const id=frame.location.scriptId;
          if(!sources.has(id))session.post('Debugger.getScriptSource',{scriptId:id},(error,result)=>{if(!error)sources.set(id,result.scriptSource.split('\n'));});
          const line=sources.get(id)?.[frame.location.lineNumber]?.trim()??'';
          current.exceptions.push({description:description.split('\n')[0],function:frame.functionName,line});
        }
      }
    }finally{session.post('Debugger.resume');}
  });
  DatabaseSync.prototype.prepare=function(sql) {
    const preparing=performance.now();
    let statement;
    try{statement=prepare.call(this,sql);}catch(error){
      if(current)current.nativeErrors.push({code:error.code,message:error.message,phase:'prepare',scan:scanName(sql),index:current.next[scanName(sql)]??0});
      throw error;
    }
    const prepareMs=performance.now()-preparing;
    if(current&&sql.startsWith('SELECT s.*,h.sequence'))current.payloadReads++;
    if(!sql.startsWith('SELECT count(*) AS count,json_group_array')&&sql!=='PRAGMA data_version')return statement;
    const get=statement.get;
    statement.get=function(...args) {
      const started=performance.now(),stack=sql==='PRAGMA data_version'?new Error().stack:'';
      try {
        const value=get.apply(this,args);
        if(current) {
          if(sql==='PRAGMA data_version')current.versions.push({value:value.data_version,
            stage:stack.includes('at fenceInside')?'final-snapshot':stack.includes('at buildFence')?'rebuild':'check',
            stack:stack.split('\n').slice(2,7).map(line=>line.trim())});
          else {
            const scan=scanName(sql),index=current.next[scan]??0;current.next[scan]=index+1;
            const executionMs=performance.now()-started;
            current.pages.push({scan,index,rows:value.count,prepareMs,executionMs,ms:prepareMs+executionMs});
          }
        }
        return value;
      }catch(error){if(current)current.nativeErrors.push({code:error.code,stack:error.stack});throw error;}
    };
    return statement;
  };
  function begin(label) {current={label,pages:[],versions:[],nativeErrors:[],exceptions:[],next:{},payloadReads:0};return current;}
  function end() {const value=current;current=null;return value;}
  return {begin,end,close(){DatabaseSync.prototype.prepare=prepare;session.post('Debugger.setPauseOnExceptions',{state:'none'});session.disconnect();}};
}

function attribution(trace,code) {
  const exception=trace.exceptions.at(-1);
  if(exception) {
    if(exception.line.includes('versionInside()!==expectedVersion'))return 'version-move-during-rebuild';
    if(exception.function==='fenceInside')return 'version-move-before-final-snapshot';
    if(exception.line.includes('fence(expected)!==expected'))return 'real-commitment-change';
    if(exception.line.includes('version()!==observed'))return 'other:version-move-during-eligibility';
    if(exception.function==='candidateEntry')return 'other:expired-or-evicted-candidate';
    if(exception.line.includes('entry.expires<performance.now()'))return 'other:expired-or-missing-ticket';
    if(exception.line.includes('entry.cache')&&new Set(trace.versions.map(row=>row.value)).size>1)return 'version-move-before-final-snapshot';
  }
  let before;
  for(const read of trace.versions) {
    if(before!==undefined&&read.value!==before) {
      if(read.stage==='rebuild')return 'version-move-during-rebuild';
      if(read.stage==='final-snapshot')return 'version-move-before-final-snapshot';
    }
    before=read.value;
  }
  if(trace.nativeErrors.length){
    const error=trace.nativeErrors[0];
    return error.message?.includes('syntax error')?'other:commitment-query-syntax':'other:native-'+error.code;
  }
  return 'other:'+code;
}

async function writer(path) {
  const child=fork(new URL('./raw-search-cadence-writer.mjs',import.meta.url),[path],{stdio:['ignore','ignore','pipe','ipc']});
  let serial=0,stderr='';const pending=new Map();
  child.stderr.on('data',value=>{stderr+=value;});
  let readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{
    for(const entry of pending.values())entry.reject(Error('writer-exited:'+code+':'+signal+':'+stderr));
    resolve({code,signal});
  }));
  child.on('message',value=>{
    if(value.ready)readyResolve();
    else if(pending.has(value.id)){const entry=pending.get(value.id);pending.delete(value.id);value.error?entry.reject(Error(value.error)):entry.resolve(value);}
  });
  await Promise.race([ready,pause(15000).then(()=>{throw Error('writer-start-timeout');})]);
  function call(input) {return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.send({...input,id});});}
  return {call,async close(){try{await call({operation:'stop'});assert.deepEqual(await exited,{code:0,signal:null},stderr);}finally{child.kill();}}};
}

export async function measureLineageProfile({profile,count,path,authority,service,host,input,sections,lineage}) {
  const probe=observe(),writes=await writer(path),report={profile,turns:count,lineage};
  const samples=[],warm=[],errors=[];
  async function call(label,work) {
    probe.begin(label);const started=performance.now();
    try{return {ok:true,value:await work(),ms:performance.now()-started,trace:probe.end()};}
    catch(error){const trace=probe.end();return {ok:false,code:error.code,ms:performance.now()-started,cause:attribution(trace,error.code),trace};}
  }
  try {
    if(profile==='commitment-cost') {
      let expected;
      try{expected=authority.fence();}catch(error){report.initialFenceError=error.code;report.initialFenceDetail=error.message;}
      report.warmOutcomes=[];
      for(let sample=0;sample<36;sample++) {
        const result=await call('warm-search',()=>service.search(input,host.token));
        if(sample>=16){
          if(result.ok){warm.push(result.ms);report.warmOutcomes.push({coverage:result.value.coverage,semantic:result.value.semantic});}
          else errors.push({...result,value:undefined});
        }
      }
      for(let sample=0;sample<20;sample++) {
        const committed=await writes.call({operation:'canonical-commit'});assert.equal(committed.canonicalCommits,1);sections.length=0;
        const result=await call('rebuild',()=>authority.fence(expected));
        if(result.ok&&expected!==undefined)assert.equal(result.value,expected,'unrelated commit changed retained commitment');
        samples.push({...result,value:undefined,commit:committed,shared:summary(sections),sharedValues:[...sections]});
        console.log('measurement lineage-rebuild='+JSON.stringify({turns:count,sample,ok:result.ok,ms:result.ms,pages:result.trace.pages.length,shared:summary(sections),cause:result.cause}));
      }
      const pageGroups={};
      for(const sample of samples)for(const page of sample.trace.pages)(pageGroups[page.scan+':'+page.index]??=[]).push(page.ms);
      report.rebuild=summary(samples.filter(value=>value.ok).map(value=>value.ms));
      report.rebuildAttempts=summary(samples.map(value=>value.ms));
      report.rebuildErrors=samples.filter(value=>!value.ok);
      report.shared=summary(samples.flatMap(sample=>sample.sharedValues));
      report.sharedSections=samples.map(sample=>sample.shared);
      report.pages=samples.map(sample=>sample.trace.pages);
      report.pageTimeByIndex=Object.fromEntries(Object.entries(pageGroups).map(([key,values])=>[key,summary(values)]));
      report.warmSearch=summary(warm);report.searchErrors=errors;
      report.warmAttempts=summary([...warm,...errors.map(row=>row.ms)]);
      report.samples=samples;
    } else {
      let random=0x59140;const rand=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/2**32;};
      report.cadences=[];
      for(const cadenceMs of [2000,5000]) {
        const rows=[],prepares=[],revalidations=[];let previousCommit=null;
        let ticket,candidate,ticketAt,candidateAt,expiredCandidatesSkipped=0,expiredTicketsSkipped=0;
        for(let attempt=0;attempt<16;attempt++) {
          const result=await call('setup',()=>service.search(input,host.token));
          if(result.ok&&result.value.candidates.length){candidate=result.value.candidates[0];candidateAt=performance.now();
            const prepared=await call('setup-prepare',()=>service.prepare(candidate,{},host.token));
            if(prepared.ok){ticket=prepared.value;ticketAt=performance.now();}
            if(result.value.semantic.state==='ready')break;
          }
        }
        const schedule=await writes.call({operation:'cadence',cadenceMs});
        previousCommit=schedule.commits;
        const start=performance.now();
        for(let sample=0;sample<60;sample++) {
          const target=Math.max(performance.now(),start+sample*cadenceMs/3)+rand()*cadenceMs/3;
          await pause(Math.max(0,target-performance.now()));
          const state=await writes.call({operation:'state'}),afterCommit=previousCommit!==state.commits;previousCommit=state.commits;
          const startedOffsetMs=performance.now()-start;
          const result=await call('search',()=>service.search(input,host.token));
          const row={sample,afterCommit,scheduledOffsetMs:target-start,startedOffsetMs,...result,value:undefined};
          if(result.ok){row.outcome=result.value.coverage.status==='complete'&&result.value.semantic.state==='ready'?'complete-hybrid':'partial';row.coverage=result.value.coverage;row.semantic=result.value.semantic;}
          else row.outcome='error';
          rows.push(row);
          if(result.ok&&result.value.candidates.length){candidate=result.value.candidates[0];candidateAt=performance.now();}
          if(candidate&&performance.now()-candidateAt<4500) {
            await pause(Math.floor(rand()*150));
            const prepared=await call('prepare',()=>service.prepare(candidate,{},host.token));
            prepares.push({...prepared,value:undefined});if(prepared.ok){ticket=prepared.value;ticketAt=performance.now();}
          }else if(candidate)expiredCandidatesSkipped++;
          if(ticket&&performance.now()-ticketAt<4500) {
            await pause(Math.floor(rand()*150));
            const checked=await call('revalidate',()=>service.revalidate([ticket]));
            if(!checked.ok&&performance.now()-ticketAt>=5000&&checked.trace.versions.length===0)checked.cause='other:expired-ticket';
            revalidations.push({...checked,value:undefined});
          }else if(ticket)expiredTicketsSkipped++;
          console.log('measurement cadence-progress='+JSON.stringify({cadenceMs,sample,outcome:row.outcome,ms:row.ms,cause:row.cause}));
        }
        const stopped=await writes.call({operation:'pause'});
        report.cadences.push({cadenceMs,seed:schedule.seed,commits:stopped.commits-schedule.commits,searches:rows,
          afterCommit:summary(rows.filter(row=>row.afterCommit).map(row=>row.ms)),
          withoutCommit:summary(rows.filter(row=>!row.afterCommit).map(row=>row.ms)),
          successfulAfterCommit:summary(rows.filter(row=>row.ok&&row.afterCommit).map(row=>row.ms)),
          successfulWithoutCommit:summary(rows.filter(row=>row.ok&&!row.afterCommit).map(row=>row.ms)),
          cache:{hits:rows.filter(row=>row.ok&&!row.trace.payloadReads).length,searches:rows.length,
            rate:rows.filter(row=>row.ok&&!row.trace.payloadReads).length/rows.length},
          prepares,revalidations,expiredCandidatesSkipped,expiredTicketsSkipped});
      }
    }
    return report;
  }finally{probe.close();await writes.close();}
}

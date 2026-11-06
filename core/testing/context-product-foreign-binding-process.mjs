// Engine restart regression, adapted from the diagnosed child-process reproduction.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const [engine, mode='run', dirArg, caseArg='copy-write', killArg='close']=process.argv.slice(2);
const source=resolve(engine),rev='regression';
const root=mode==='run'?mkdtempSync(join(tmpdir(),'context-foreign-binding-')):null;
const emit=(kind,data={})=>console.log(JSON.stringify({rev,mode,kind,...data}));
const children=new Set();
const child=(args,ipc=false)=>{const p=spawn(process.execPath,[fileURLToPath(import.meta.url),engine,...args],{stdio:ipc?['ignore','inherit','inherit','ipc']:['ignore','inherit','inherit']});children.add(p);emit('child_started',{phase:args[0],pid:p.pid});return p;};
const done=p=>new Promise((res,rej)=>{p.once('error',rej);p.once('exit',(code,signal)=>res({code,signal}));});
const command=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8'});emit('command',{cmd,args,pid:r.pid,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0);return r.stdout;};
if(mode==='run'){
  try{
    emit('run_entry',{pid:process.pid});
    const name=dirArg??'copy-write',termination=caseArg==='sigterm'?'sigterm':'close';
    const directory=mkdtempSync(join(root,'data-'+name+'-')),copy=name.startsWith('copy'),write=name.endsWith('write')&&!name.endsWith('no-write'),drop=name==='copy-delete';
    const b=child(['build',directory,name,termination],true),exit=done(b);
    await Promise.race([new Promise(resolve=>b.once('message',resolve)),exit.then(x=>{throw Error('builder early exit '+JSON.stringify(x));})]);
    if(termination==='sigterm')b.kill('SIGTERM');else b.send('close');
    const built=await exit;emit('builder_exit',built);assert.deepEqual(built,termination==='sigterm'?{code:null,signal:'SIGTERM'}:{code:0,signal:null});
    if(write||drop){const p=child(['write',directory]);const r=await done(p);emit('writer_exit',r);assert.equal(r.code,0);}
    let target=directory;
    if(copy){target=join(directory,'copied');mkdirSync(target,{mode:0o700});command('cp',[join(directory,'core.sqlite'),join(directory,'core.sqlite.context-read-product-v1.1.sqlite'),target]);}
    if(drop)command('rm',['--',join(target,'core.sqlite.context-read-product-v1.1.sqlite')]);
    command('stat',['-c','%n %d:%i',join(directory,'core.sqlite'),join(directory,'core.sqlite.context-read-product-v1.1.sqlite'),join(target,'core.sqlite')]);
    let finalRows,pumpExit;
    for(const phase of ['inspect','pump','inspect']){const p=child([phase,target,name],true);p.on('message',m=>{if(m.rows)finalRows=m.rows;});const r=await done(p);emit('child_exit',{phase,...r});if(phase==='pump')pumpExit=r.code;else assert.equal(r.code,0);}
    assert.equal(pumpExit,0);
    const expectedDocuments=write||drop?3:2;
    assert.deepEqual(finalRows,[{intent:'current',documents:expectedDocuments},{intent:'history',documents:expectedDocuments}]);
    emit('asserted',{outcome:'converged',finalRows});
    emit('finished',{case:name,termination,directory,target,expected:write||drop?3:2});
  }finally{
    // A failed assertion can leave a builder waiting for its close message.
    await Promise.all([...children].map(async p=>{
      if(!p.pid||p.exitCode!==null||p.signalCode!==null)return;
      const exit=done(p);p.kill('SIGTERM');await exit;
    }));
    command('rm',['-rf','--',root]);
  }
}else{
  const api=await import(pathToFileURL(join(source,'core/index.mjs'))),pumpApi=await import(pathToFileURL(join(source,'core/context-product-pump.mjs')));
  const protocol=await import(pathToFileURL(join(source,'core/context-product-admission.mjs'))).catch(()=>({}));
  const {configured,personal,project}=await import(pathToFileURL(join(source,'core/testing/context-product-owner-fixture.mjs')));
  const path=join(dirArg,'core.sqlite'),readSet=[personal,project('restart-project')];
  const cleanups=[],t={after:f=>cleanups.push(f)};
  const cleanup=async()=>{for(const f of cleanups.reverse())await f();};
  function admitOne(text,ns=personal){const c=api.openMemoryCore({path});try{assert.equal(c.admit({namespace:ns,memory:{content:text,kind:'fact'},receipts:[{client:'synthetic',sessionId:'restart',eventId:text,role:'user',excerpt:text}]}).ok,true);}finally{c.close();}}
  if(mode==='write'){admitOne('Post-builder restart canary');emit('wrote');process.disconnect?.();}
  else if(mode==='build'){
    admitOne('Synthetic restart admission canary');admitOne('Synthetic project canary',readSet[1]);
    const c=configured(t,path,readSet,{service:true}),h=await c.open();
    for(const intent of (caseArg==='copy-checkpoint'?['current']:['current','history'])){let complete=false;for(let n=0;n<40&&!complete;n++){const r=await h.refreshContextIndex({readSet,types:['memory'],intent,mode:'lexical',budget:{maxItems:caseArg==='copy-checkpoint'?1:32,maxMs:1000}},c.token);emit('build_result',{intent,n,status:r.value?.status,error:r.error?.code});assert.equal(r.ok,true);complete=r.value.status==='complete';if(caseArg==='copy-checkpoint'){assert.equal(complete,false);break;}}if(caseArg!=='copy-checkpoint')assert.equal(complete,true);}
    const closing=async()=>{await cleanup();if(killArg==='sigterm'){process.kill(process.pid,'SIGTERM');}else{process.disconnect();}};
    if(killArg==='sigterm')process.once('SIGTERM',()=>void closing());else process.once('message',()=>void closing());
    process.send({built:true});
  }else if(mode==='inspect'){
    const sidePath=path+'.context-read-product-v1.1.sqlite';
    const d=existsSync(sidePath)?new DatabaseSync(sidePath,{readOnly:true}):null;
    try{const rows=d?d.prepare(`SELECT s.intent,COUNT(d.doc) AS documents FROM publications p JOIN selections s ON s.projection=p.projection JOIN generations g ON g.id=p.generation LEFT JOIN documents d ON d.generation=g.storage_id GROUP BY s.intent ORDER BY s.intent`).all().map(r=>({...r})):[];emit('publications',{rows});process.send?.({rows});}finally{d?.close();}
    const d2=new DatabaseSync(path,{readOnly:true});try{emit('canonical',{count:d2.prepare('SELECT COUNT(*) AS n FROM memories').get().n,journal:d2.prepare('PRAGMA journal_mode').get()});}finally{d2.close();}process.disconnect?.();
  }else if(mode==='pump'){
    const readerApi=await import(pathToFileURL(join(source,'core/context-product-reader.mjs')));
    const c=configured(t,path,readSet,{service:true});let turns=0;const replies=[];const successes=new Set();let release;const enough=new Promise(r=>release=r);
    const wrap=(method,fn)=>async(...args)=>{emit('dispatch',{method,intent:args[1].intent});const r=await fn(...args);emit('reply',{method,intent:args[1].intent,receipt:protocol.maintenanceAdmissionReceipt?.(r)??null,status:r.value?.status,error:r.error?.code});if(!r.ok)setImmediate(()=>emit('failed_reply',{method,intent:args[1].intent,phases:readerApi.maintenancePhaseDiagnostic(r)??null,stall:readerApi.maintenanceStallDiagnostic(r)??null}));replies.push({method,intent:args[1].intent,receipt:protocol.maintenanceAdmissionReceipt?.(r)??null});turns++;if(r.ok&&r.value?.status==='complete')successes.add(args[1].intent);if(turns>=12||successes.size===2)release();return r;};
    const deps={};if(protocol.admitMaintenance){deps.admit=wrap('admitMaintenance',protocol.admitMaintenance);deps.work=wrap('refreshMaintenance',protocol.refreshMaintenance);}else{deps.open=async options=>{const h=await api.openContextIndexMaintainer(options);return {close:()=>h.close(),refreshContextIndex:wrap('refreshContextIndex',(_h,...a)=>h.refreshContextIndex(...a)).bind(null,null)};};}
    const renew=pumpApi.createMaintenancePumpRuntime(deps),now=Number(process.hrtime.bigint())/1e6;
    const p=renew({supervisor:c.supervisor,id:randomUUID(),window:{id:randomUUID(),endsAtMonoMs:Math.floor(now)+60000,usedItems:0,usedMs:0},budgets:{maxItems:2048,maxMs:60000},quantum:{maxItems:32,maxMs:1000},pollMs:1000,renewalMs:60000,serviceCredential:c.token,projections:[{options:c.options,types:['memory']}]});
    const monitor=setInterval(()=>{const s=p.getStatus();if(s.state!=='active')release();},1000);
    const bound=setTimeout(release,16000);
    try{await enough;await new Promise(setImmediate);const s=p.getStatus();emit('bounded_result',{turns,successes:[...successes],status:s,diagnostic:pumpApi.maintenancePumpDiagnostic(s),phases:pumpApi.maintenancePumpPhaseDiagnostic(s)});assert.equal(successes.size,2,'both lanes must converge within bounded observation');}finally{
      clearInterval(monitor);clearTimeout(bound);
      try{await p.close();}finally{
        try{await cleanup();}finally{
          const final=p.getStatus();emit('closed',{status:final,diagnostic:pumpApi.maintenancePumpDiagnostic(final),phases:pumpApi.maintenancePumpPhaseDiagnostic(final)});process.disconnect?.();
        }
      }
    }
  }else throw Error('bad mode');
}

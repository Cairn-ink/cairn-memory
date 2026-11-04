import { randomUUID } from 'node:crypto';
import { actor, terminate } from './actors.mjs';
import { createWriterLedger } from './writer-journal.mjs';
import { PROTOCOL, writerStatistics } from './protocol.mjs';
// Persist stop/startup evidence at the actor boundary, before a caller's
// cleanup can rethrow. Sharing the stop promise also prevents double teardown.
export async function recordedWriter(start,write,series='writer') {
  try {
    const writer=await start();let stopping;
    return {...writer,stop(){return stopping??=(async()=>{
      try {const result=await writer.stop();await write(series,result);return result;}
      catch(e){if(e.writerEvidence)await write(series,e.writerEvidence);throw e;}
    })();}};
  }catch(e){if(e.writerEvidence)await write(series,e.writerEvidence);throw e;}
}
export async function startWriter(config,lifecycle='fresh',{actor:makeActor=actor,terminate:stopChild=terminate}={}) {
  const observation={stream:randomUUID(),epoch:1,capacity:PROTOCOL.telemetry.writerCapacity};
  const ledger=createWriterLedger(observation),expected=new Set(),calls=[];
  let nextExpected=0;const maximumOperations=PROTOCOL.telemetry.writerMaximumOperations;
  const expect=id=>{if(expected.has(id))return;expected.add(id);ledger.expect(id,id==='open'?['open']:id==='shutdown'?['shutdown']:lifecycle==='fresh'?['open','write','inspect','close']:['write','inspect']);};
  if(lifecycle==='retained')expect('open');expect(0);nextExpected=1;
  const {ledger:fixtureLedger,initialCounts,maintainerDiagnostics,signal,oracle,inspectLedger,input,responseSchema,schemas,oracleData,...runtimeConfig}=config;
  const child=makeActor(config.protocol==='P2-product-v4'?'writer-v4':'writer',{...runtimeConfig,lifecycle,observation,maxOperations:maximumOperations},{stallMs:config.protocol==='P2-product-v4'?config.supervision.stallMs:30000});
  // Diagnostic processing is explicitly pumped between observed reader calls.
  // IPC listeners only queue frames. Native recording never awaits an IPC ack.
  function flush() {
    calls.push(...child.take('call').map(m=>m.call));
    for(const m of child.take('diagnostic_chunk')){
      for(const r of m.records) {
        if(Number.isSafeInteger(r.operation)&&r.operation>=0&&r.operation<maximumOperations)while(nextExpected<=r.operation)expect(nextExpected++);
        else if(lifecycle==='retained'&&['open','shutdown'].includes(r.operation))expect(r.operation);
      }
      const through=ledger.chunk(m);if(through!==null&&child.connected)child.send({type:'ack',through});
    }
  }
  try {
    ledger.arm(await child.wait('armed'));child.send({type:'permit'});await child.wait('ready');flush();
    return {child,flush,calls,start(startAt,endAt){child.send({type:'start',startAt,endAt});},async stop(){
      let seal;
      try {
        if(child.connected)child.send({type:'stop'});
        seal=await child.wait('diagnostic_seal');flush();if(lifecycle==='retained')expect('shutdown');
        if(ledger.seal(seal))child.send({type:'seal_ack'});
        else {await stopChild(child);const exit=await child.exited;ledger.exit(exit.code,exit.signal,exit.disconnected);return {exit,diagnostics:ledger.result(),calls:[...calls],hostLoop:null};}
        await child.wait('seal_acknowledged');ledger.acknowledgedSeal();
        const result=await child.wait('result'),exit=await child.exited;ledger.exit(exit.code,exit.signal,exit.disconnected);
        return {...result,exit,diagnostics:ledger.result(),statistics:writerStatistics(result),...(config.protocol==='P2-product-v4'?{targetStatistics:Object.fromEntries(['same','other'].map(target=>[target,writerStatistics({calls:result.calls.filter(c=>c.writerTarget===target)})]))}:{})};
      }catch {
        await stopChild(child);flush();const exit=await child.exited;ledger.exit(exit.code,exit.signal,exit.disconnected);
        return {exit,diagnostics:ledger.result(),calls:[...calls],hostLoop:null,error:'writer_failed',statistics:writerStatistics({calls})};
      }finally{await stopChild(child);}
    }};
  }catch(e){await stopChild(child);flush();const exit=await child.exited;ledger.exit(exit.code,exit.signal,exit.disconnected);
    e.writerEvidence={exit,diagnostics:ledger.result(),calls:[...calls],hostLoop:null,error:'writer_startup_failed'};throw e;}
}

import { performance } from 'node:perf_hooks';
import { configure } from './engine.mjs';
import { PROTOCOL } from './protocol.mjs';
// Configuration is harness work and finishes before the observer starts. During
// observation retain raw engine outputs only; form diagnostics and traces later.
export async function prepareSessionPump(config) {
  const {renewContextMaintenancePump}=await import('../../../../core/index.mjs');
  const c=await configure(config,true),exports=[],completions=[],renewals=[];
  let pump,renewal,drainTimer,draining,lastDrain=performance.now(),incomplete=false,stopped=false,renewFailure;
  const drain=()=>draining??=(async()=>{
    if(performance.now()-lastDrain>500)incomplete=true;
    const records=await c.supervisor.drain();exports.push(records);
    for(const record of records)c.supervisor.ackCleanup(record.cleanupId);
    lastDrain=performance.now();
  })().catch(()=>{incomplete=true;}).finally(()=>{draining=null;});
  const windowBase=Number(process.hrtime.bigint()/1000000n);
  const renew=()=>{
    const now=Number(process.hrtime.bigint()/1000000n),windowId=Math.floor((now-windowBase)/60000);
    pump=renewContextMaintenancePump({supervisor:c.supervisor,id:config.pump.id,window:{id:String(windowId),endsAtMonoMs:windowBase+(windowId+1)*60000,usedItems:0,usedMs:0},
      budgets:config.pump.budgets,quantum:config.pump.quantum,pollMs:config.pump.pollMs,renewalMs:config.pump.renewalMs,
      projections:[{options:c.options,types:config.types}],serviceCredential:c.token});
    // Engine status calls stay observed. Only raw scalars/results are buffered.
    renewals.push(pump.getStatus());
    pump.completion.then(r=>{if(!stopped)completions.push(r);}).catch(()=>{incomplete=true;});
  };
  return {start(){
    const tick=()=>{try{renew();}catch(e){renewFailure??=e;}};
    tick();renewal=setInterval(tick,config.pump.cronMs);drainTimer=setInterval(()=>{void drain();},PROTOCOL.pumpDrainMs);
    return {async stop(){
      stopped=true;clearInterval(renewal);clearInterval(drainTimer);
      await draining;try{await pump?.close();}finally{try{await c.supervisor.close();}finally{await drain();}}
      if(renewFailure)throw renewFailure;
      return exports;
    }};
  },async dispose(){await c.supervisor.close();await drain();},async report(write){
    for(const [ordinal,status] of renewals.entries())await write('pump',{kind:'renew',ordinal,status});
    for(const [tick,r] of completions.entries())await write('pump',{tick,state:r.state,error:r.error});
    return incomplete?[{diagnostics:{protocol:'context-native-v1',coverage:'incomplete',busy:0,records:[]}}]:[];
  }};
}

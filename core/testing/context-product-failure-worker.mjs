import { parentPort, workerData } from 'node:worker_threads';
import * as diagnostics from '../context-product-attribution.mjs';
import { productFailure } from '../context-product-reader.mjs';
let entered=BigInt(workerData.operation.enteredMonoNs);
const meter=workerData.maintenance?diagnostics.createMaintenanceAttribution({buffer:workerData.maintenanceMarker,now:()=>Number(entered)/1e6,hrtime:()=>entered}):undefined;
const checkpoints=new Set();
parentPort.postMessage({operation:workerData.operation,result:{ok:true,value:null},fileIdentity:'12:34'});
parentPort.on('message',message=>{
  if(message.method==='close'){parentPort.close();return;}
  entered=BigInt(message.operation.enteredMonoNs);meter?.reset(message.maintenanceOrdinal);
  meter?.measure('item',()=>{},true);
  const send=(result,detail)=>parentPort.postMessage({operation:message.operation,result,
    ...(result.ok?{observedAtMonoMs:Number(entered)/1e6}:{}),...(workerData.maintenance&&detail?{maintenanceFailure:detail}:{})});
  const mode=workerData.failureMode;
  if(mode==='resume'){
    if(!checkpoints.has(message.input.intent)){checkpoints.add(message.input.intent);send({ok:true,value:{status:'rebuilding',progress:{transformed:0}}});return;}
    try {meter.measure('verify',()=>{throw new TypeError('synthetic private exception text');});}
    catch(error){send(productFailure(error.code),meter.failure?.());}return;
  }
  meter?.start('commit');
  if(mode==='heap'){
    const retained=[];for(;;)retained.push(new Array(10000).fill(retained.length));
  }
  if(mode==='exit'){process.exit(23);}
  if(mode==='named'){throw new TypeError('synthetic private exception text');}
  if(mode==='bad_observation'){parentPort.postMessage({operation:message.operation,result:{ok:true,value:{status:'complete',progress:{transformed:0}}},observedAtMonoMs:Number(entered)/1e6-1});return;}
  if(mode==='protocol'){parentPort.postMessage({operation:{...message.operation,unexpected:true},result:{ok:true,value:null}});return;}
  if(mode==='unmapped'){send({ok:false,error:{code:'synthetic_engine_code',retryable:false}});return;}
  if(mode==='unsafe_code'){send({ok:false,error:{code:'unsafe / private code',retryable:false}});return;}
  if(mode==='mapped'){send(productFailure('synthetic_engine_code'),{kind:'unmapped',engineCode:'synthetic_engine_code'});return;}
  if(mode==='worker_state'){send(productFailure('reader_failed'),{kind:'worker_state'});return;}
  if(mode==='exception_other'){send(productFailure(undefined),{kind:'exception',errorName:'unsafe / name',step:3});return;}
  if(mode==='engine'){send(productFailure('storage_busy'));return;}
  send({ok:true,value:{status:'complete',progress:{transformed:0}}});
});

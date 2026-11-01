import { parentPort, workerData } from 'node:worker_threads';
import { registerHooks } from 'node:module';
const c=workerData.host.configuration;
if(c.protocolTest) {
  const send=(operation,result,extra={})=>parentPort.postMessage({operation,result,...extra});
  if(c.protocolTest==='identity_shape')send(workerData.operation,undefined,{kind:'identity',fileIdentity:'invalid'});
  else send(workerData.operation,{ok:true,value:null},{fileIdentity:c.protocolTest==='open_identity'?'invalid':'12:34'});
  parentPort.on('message',message=>{
    if(message.method==='close'){parentPort.close();return;}
    if(c.protocolTest==='frame_conflict')send({...message.operation,extra:true},{ok:true,value:null});
    else if(c.protocolTest==='result_bounds')send(message.operation,{ok:true,value:{missing:undefined}});
    else if(c.protocolTest==='result_shape')send(message.operation,{ok:'invalid',value:null});
    else send(message.operation,{ok:true,value:{cloneFailure:true}});
  });
} else {
  const Native=process.getBuiltinModule('node:sqlite').DatabaseSync;
  globalThis.classificationDatabase=class extends Native {
    prepare(sql) {
      if(c.faultIndex&&sql==='SELECT store_id FROM store_metadata WHERE singleton=1') {
        const error=Object.assign(Error('synthetic storage failure'),{code:'index_unavailable'});
        if(c.reasonGetter)Object.defineProperty(error,'reason',{get(){Atomics.add(new Int32Array(c.state),7,1);throw Error('reason getter executed');}});
        else error.reason=c.faultReason;
        throw error;
      }
      return super.prepare(sql);
    }
  };
  registerHooks({load(url,context,next){if(url!=='node:sqlite')return next(url,context);return {format:'module',shortCircuit:true,source:`
    export const DatabaseSync=globalThis.classificationDatabase;
    const actual=process.getBuiltinModule('node:sqlite');export const StatementSync=actual.StatementSync,constants=actual.constants,backup=actual.backup;
    export default {...actual,DatabaseSync};`};}});
  await import('../../context-product-worker.mjs');
}

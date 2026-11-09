import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/recall')) options.signal.addEventListener('abort',()=>{
    process.send?.({kind:'recall-aborted',ms:performance.now()});
  },{once:true});
  return nativeFetch(url,options);
};
// A hung unavailable diagnostic is independent of authorization. Model it at
// the actual file sync, so a timer which only aborts fetch is insufficient.
if(process.env.SYNTHETIC_STALL_STATUS==='1') {
  const original=fs.open;
  fs.open=async function(path,...args){
    const handle=await original.call(this,path,...args);
    if(String(path).includes('hosted-pause-status') && String(path).includes('.tmp-')) {
      handle.sync=async()=>{process.send?.({kind:'unavailable-sync-started'});await new Promise(resolve=>setTimeout(resolve,5000));};
    }
    return handle;
  };
  syncBuiltinESMExports();
}
process.channel?.unref();

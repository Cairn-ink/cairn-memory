// Offline rendezvous for provider children, ledger attempts and validation.
import { createContextReadHost as baseHost } from './context-semantic-pump-cutoff-host.mjs';
export async function createContextReadHost(c){
  const host=await baseHost(c);if(!c.semanticServiceBinding)return host;
  const state=new Int32Array(c.turnControl);let settle=false,validation=false;
  async function pause(entered,release){Atomics.add(state,entered,1);Atomics.notify(state,entered);while(Atomics.load(state,release)===0)await Atomics.waitAsync(state,release,0,5000).value;}
  return {...host,
    authorize(...args){if(args[0].method==='validateOwnerSemanticCoverage')validation=true;return host.authorize(...args);},
    semanticLedgerAuthority:{...host.semanticLedgerAuthority,async compareAndSwap(...args){
      if((settle&&Atomics.load(state,4)===1)||(validation&&Atomics.load(state,4)===2)){settle=false;validation=false;await pause(5,6);}
      if(settle&&Atomics.compareExchange(state,4,3,0)===3){settle=false;Atomics.add(state,7,1);throw Error('synthetic settlement fault');}
      return host.semanticLedgerAuthority.compareAndSwap(...args);
    }},
    contextEmbedding:{...host.contextEmbedding,embedder:{...host.contextEmbedding.embedder,async embed(texts,controls){
      if(Atomics.load(state,0)===0)return host.contextEmbedding.embedder.embed(texts,controls);
      controls.beforeDispatch();Atomics.add(state,1,1);Atomics.notify(state,1);
      if(Atomics.load(state,0)===2)process.exit(1);
      await pause(8,2);settle=true;controls.settleInputTokens(texts.reduce((n,s)=>n+Buffer.byteLength(s),0));
      Atomics.add(state,3,1);return texts.map(()=>{const v=new Float32Array(1536);v[0]=1;return v;});
    }}},
  };
}

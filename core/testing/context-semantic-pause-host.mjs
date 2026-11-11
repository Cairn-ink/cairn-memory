// Offline provider race: mutate the synthetic store at the transport callback.
import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as baseHost } from './context-semantic-host.mjs';
import { control } from './context-semantic-pause-fixture.mjs';
export async function createContextReadHost(c) {
  const host=await baseHost(c),embedder=host.contextEmbedding.embedder;
  return {...host,contextEmbedding:{...host.contextEmbedding,embedder:{...embedder,embed(texts,controls){
    return embedder.embed(texts,{...controls,beforeDispatch(){
      if(Atomics.exchange(new Int32Array(c.state),8,0)===1){
        const db=new DatabaseSync(c.pausePath);try{control(db,c.pauseNamespace,{paused:1});}finally{db.close();}
      }
      return controls.beforeDispatch();
    }});
  }}}};
}

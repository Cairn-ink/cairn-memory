// Offline provider races use only synthetic stores and fake embedders.
import { DatabaseSync } from 'node:sqlite';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { createContextReadHost as baseHost } from './context-semantic-host.mjs';
import { control } from './context-semantic-pause-fixture.mjs';
export async function createContextReadHost(c) {
  const host=await baseHost(c),embedder=host.contextEmbedding.embedder,state=new Int32Array(c.state);
  function change(mode) {
    const disabled=mode>=3,db=new DatabaseSync(c.pausePath);
    try {
      if(mode===2||mode===4){
        // Isolate controls from the independent namespace epoch fence, using
        // the real engine episode-control write rather than a stub guard.
        const episodes=createEpisodeStorage({db,rawCapture:{closePending(){}},advanceEpoch:()=>{}});
        episodes.setControl(c.pauseNamespace,{expectedGeneration:episodes.getControl(c.pauseNamespace).generation,...(disabled?{enabled:false}:{paused:true})},disabled);
      }else control(db,c.pauseNamespace,disabled?{enabled:0}:{paused:1});
    }finally{db.close();}
  }
  return {...host,
    semanticPriceAuthority:{...host.semanticPriceAuthority,current(){
      const mode=Atomics.load(state,8);
      if(mode>=5){Atomics.store(state,8,0);change(mode-4);}
      return host.semanticPriceAuthority.current();
    }},
    contextEmbedding:{...host.contextEmbedding,embedder:{...embedder,embed(texts,controls){
      return embedder.embed(texts,{...controls,beforeDispatch(){
        const mode=Atomics.exchange(state,8,0);if(mode)change(mode);
        return controls.beforeDispatch();
      }});
    }}}};
}

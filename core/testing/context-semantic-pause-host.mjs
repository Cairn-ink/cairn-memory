// Offline provider races use only synthetic stores and fake embedders.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { createContextReadHost as baseHost } from './context-semantic-host.mjs';
import { control } from './context-semantic-pause-fixture.mjs';
export async function createContextReadHost(c) {
  const host=await baseHost(c),embedder=host.contextEmbedding.embedder,state=new Int32Array(c.state);
  let snapshotMode=0;
  if(c.transmissionSnapshot) {
    const prepare=DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare=function(sql) {
      const statement=Reflect.apply(prepare,this,[sql]),db=this;
      if(sql.includes('namespace_epochs')&&sql.startsWith('SELECT')) {
        const get=statement.get;
        statement.get=function(...args) {
          const value=Reflect.apply(get,this,args);
          if(snapshotMode&&db.isTransaction&&Reflect.apply(prepare,db,['PRAGMA database_list']).all().some(r=>r.file===c.pausePath)) {
            const mode=snapshotMode;snapshotMode=0;
            const read=()=>Reflect.apply(prepare,db,['SELECT paused,enabled FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?']).get(c.pauseNamespace.ownerId,c.pauseNamespace.scope,c.pauseNamespace.projectId??'')??{paused:0,enabled:1};
            const before=read();
            const writer=spawnSync(process.execPath,[new URL('./context-semantic-pause-writer.mjs',import.meta.url).pathname,c.pausePath,JSON.stringify(c.pauseNamespace),mode===10?'disable':'pause'],{encoding:'utf8',timeout:30000});
            assert.equal(writer.error,undefined);assert.equal(writer.signal,null);assert.equal(writer.status,0,writer.stderr);
            const acknowledgement=JSON.parse(writer.stdout);
            assert.notEqual(acknowledgement.pid,process.pid);
            assert.equal(acknowledgement.committed,true);
            assert.equal(db.isTransaction,true,'commit acknowledged before validation closes');
            assert.deepEqual(read(),before,'validation still sees the pre-commit WAL snapshot');
            Atomics.add(state,10,1);
          }
          return value;
        };
      }
      return statement;
    };
  }
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
      if(mode>=5&&mode<=8){Atomics.store(state,8,0);change(mode-4);}
      return host.semanticPriceAuthority.current();
    }},
    contextEmbedding:{...host.contextEmbedding,embedder:{...embedder,embed(texts,controls){
      return embedder.embed(texts,{...controls,beforeDispatch(){
        const mode=Atomics.exchange(state,8,0);if(mode>=9)snapshotMode=mode;else if(mode)change(mode);
        try{return controls.beforeDispatch();}catch(error){if(c.transmissionSnapshot)Atomics.store(state,11,error.code==='budget_denied'?1:-1);throw error;}
      }});
    }}}};
}

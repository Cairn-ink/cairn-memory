import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, deferHostedPauseStatus, withHostedPauseGate } from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';

test('two hundred completed cycles retain constant warm journal cost and no writes', {timeout:110000}, async t=>{
  const root=join(createTestWorkspace(t).path,'state'); await fs.mkdir(root,{mode:0o700});
  const config={root,endpoint:'http://127.0.0.1:1'};
  let remote={paused:false,generation:0,enforced:true};
  t.mock.method(globalThis,'fetch',async()=>Response.json(remote));
  const observe=()=>observeHostedPause(config,'synthetic-token'); await observe();
  const directory=join(root,'hosted-pause',hostedTargetId(config)+'.json.intents');
  const snapshots=[];
  for(let generation=1;generation<=200;generation++) {
    if(generation%50===0)console.log('JOURNAL_PROGRESS '+JSON.stringify({generation,ms:performance.now()}));
    remote={...remote,generation,paused:true}; await observe();
    remote={...remote,paused:false}; await observe();
    if (generation===1 || generation===200) {
      const names=await fs.readdir(directory);
      const listed=[]; const original=fs.readdir;
      const mock=t.mock.method(fs,'readdir',async function(path,...args){
        const result=await original.call(this,path,...args);
        if(String(path)===directory)listed.push(result.length);
        return result;
      }); syncBuiltinESMExports();
      const handle=await fs.open(join(root,'probe'),'a',0o600), prototype=Object.getPrototypeOf(handle);
      await handle.close(); let syncs=0;
      const sync=t.mock.method(prototype,'sync',async()=>{syncs++;});
      try {
        const observation=deferHostedPauseStatus(config,'synthetic-token');
        await observation.observe(); await observation.observe();
        await withHostedPauseGate(config,generation,async check=>{await check();});
      } finally {sync.mock.restore();mock.mock.restore();syncBuiltinESMExports();}
      const files = (await fs.readdir(root,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()).length;
      snapshots.push({generation,files:names.length,totalFiles:files,listed,syncs});
    }
  }
  t.diagnostic(JSON.stringify(snapshots));
  assert.equal(snapshots[0].totalFiles,snapshots[1].totalFiles,'constant_total_file_count');
  for(const snapshot of snapshots){
    assert.equal(snapshot.syncs,0,'warm_unchanged_no_fsync');
    assert.equal(snapshot.files,2,'bounded_journal_file_count');
    assert.ok(snapshot.listed.length>0);assert.ok(snapshot.listed.every(count=>count===2),'bounded_names_per_check');
  }
});

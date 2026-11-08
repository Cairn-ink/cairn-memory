import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const worker=fileURLToPath(new URL('../testing/raw-search-off-child.mjs',import.meta.url));
test('absent and disabled Raw selection preserve results, errors, SQL arguments, ports and canonical state',{timeout:240000},t=>{
  const ws=createTestWorkspace(t,{prefix:'raw-search-off-'});let cases=0;
  for(const selection of ['absent','disabled'])for(const population of ['fresh','populated'])for(const context of ['none','local','hosted']){
    const outputs=[];
    for(const selected of [selection,selection==='absent'?'disabled':'absent']){
      const scratch=join(ws.path,String(cases)+'-'+selected),report=scratch+'.json';
      const child=spawnSync(process.execPath,[worker,root,scratch,report,selected,population,context,'guard'],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
      assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
      const result=JSON.parse(readFileSync(report,'utf8'));
      assert.deepEqual(result.rawWork,{statements:[],timers:[]});
      assert.ok(result.residency.length>0);assert.ok(result.residency.every(value=>value===false));
      assert.ok(result.trace.every(([,sql])=>!sql.includes('0 AS revision')));
      outputs.push(result);
    }
    assert.deepEqual(outputs[1],outputs[0],`${selection}/${population}/${context}`);
    for(const method of ['correct','forget','deleteConversation','forgetEpisode'])assert.ok(outputs[0].results.some(row=>row[0]===method),method);
    cases++;t.diagnostic(`${selection}/${population}/${context}: absent and disabled matched`);
  }
  assert.equal(cases,12);
});
test('importing the engine alone creates no Raw resources, listeners or files',t=>{
  const ws=createTestWorkspace(t,{prefix:'raw-search-import-'});
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../testing/raw-search-import-child.mjs',import.meta.url)),root,ws.path],{encoding:'utf8',timeout:15000});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
});

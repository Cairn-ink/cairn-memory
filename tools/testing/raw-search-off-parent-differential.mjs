import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const parent=process.argv.find(value=>value.startsWith('--parent='))?.slice(9);
assert.match(parent??'',/^[a-f0-9]{40}$/,'--parent=<full commit> is required');
const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});assert.equal(head.status,0);
const scratchRoot=mkdtempSync(join(tmpdir(),'raw-search-differential-')),ws={path:scratchRoot};
try{
  const baseline=join(ws.path,'parent');mkdirSync(baseline);
  const archive=spawnSync('git',['archive',parent,'core','tools/testing','plugins/cairn-memory/lib'],{maxBuffer:32*1024*1024});assert.equal(archive.status,0,String(archive.stderr));
  const tar=spawnSync('tar',['-x','-C',baseline],{input:archive.stdout});assert.equal(tar.status,0,String(tar.stderr));
  const current=fileURLToPath(new URL('../../',import.meta.url)),worker=fileURLToPath(new URL('../../core/testing/raw-search-off-child.mjs',import.meta.url));
  let cases=0,statements=0;
  for(const selection of ['absent','disabled'])for(const population of ['fresh','populated'])for(const context of ['none','local','hosted']){
    const outputs=[];
    for(const [name,root] of [['parent',baseline],['candidate',current]]){
      const scratch=join(ws.path,String(cases)+'-'+name),report=scratch+'.json';
      const child=spawnSync(process.execPath,[worker,root,scratch,report,selection,population,context],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
      assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
      outputs.push(JSON.parse(readFileSync(report,'utf8')));
    }
    assert.deepEqual(outputs[1],outputs[0],`${selection}/${population}/${context}`);
    const methods=outputs[0].results.map(row=>row[0]);
    for(const method of ['correct','forget','deleteConversation','forgetEpisode'])assert.ok(methods.includes(method),method);
    statements+=outputs[0].trace.length;cases++;console.log(`${selection}/${population}/${context}: exact differential matched`);
  }
  console.log(JSON.stringify({head:head.stdout.trim(),parent,node:process.version,cases,statements,differences:0}));
}finally{rmSync(scratchRoot,{recursive:true,force:true});}

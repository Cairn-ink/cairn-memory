import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/raw-conversations.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
function sourceClosure() {
  return installedImportClosure(root, ["core/index.mjs"]);
}

for(const client of ['claude-code','codex']) test(`B1-04/05/06 installed ${client}: public Raw/Card/delete lifecycle and independently traced closure`,{ timeout:120000 },async t=>{
  const workspace=createTestWorkspace(t,{ prefix:'installed-raw-public-' }), home=join(workspace.path,'home'); mkdirSync(home,{ mode:0o700 });
  const artifact=buildArtifact(), { required:closure, eager:eagerClosure } = sourceClosure();
  assert.equal(closure.includes('core/raw-capture.mjs'),false); assert.equal(artifact.files.includes('core/raw-capture.mjs'),false);
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({ name:'synthetic-installed-raw',version:'0.0.0',private:true }),{ flag:'wx',mode:0o600 });
  assert.equal(command('npm',['prefix','--prefix',workspace.path],workspace.path,artifact.userconfig).trim(),workspace.path);
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const installed=join(workspace.path,'node_modules',packageName), database=join(workspace.path,'store.sqlite'), state=join(workspace.path,'state.json');
  for(const path of closure) {
    assert.ok(artifact.files.includes(path),path+' absent from inspected archive');
    assert.equal(sha(readFileSync(join(installed,path))),artifact.sourceHashes[path]);
    assert.deepEqual(readFileSync(join(installed,path)),readFileSync(join(root,path)));
  }
  const observed=new Set(),pids=new Set();
  for(const phase of ['create','resume','delete','restart-deleted']) {
    const trace=join(workspace.path,phase+'-closure.jsonl');
    const child=spawnSync(process.execPath,[fixture,phase,installed,database,state,client,trace],{ cwd:workspace.path,encoding:'utf8',timeout:30000,
      env:{ PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_DISABLE_COMPILE_CACHE:'1',NODE_NO_WARNINGS:'1' } });
    assert.equal(child.error,undefined,child.error?.message); assert.equal(child.signal,null); assert.equal(child.status,0,child.stderr+'\n'+child.stdout);
    const result=JSON.parse(child.stdout); assert.equal(result.phase,phase); assert.equal(result.client,client);
    assert.equal(result.importedCore,join(installed,'core/index.mjs')); assert.equal(result.networkCalls,0); assert.equal(result.modelCalls,phase==='create' ? 1:0);
    pids.add(result.pid);
    for(const line of readFileSync(trace,'utf8').trim().split('\n').filter(Boolean)) {
      const row=JSON.parse(line); if(row.path.startsWith(installed+'/'))observed.add(relative(installed,row.path));
    }
  }
  assert.equal(pids.size,4);
  assert.deepEqual([...observed].sort(), eagerClosure,'actual installed Node resolution/asset reads must match the independently derived source closure');
  t.diagnostic(JSON.stringify({ client,sourceClosureFiles:closure.length,actualInstalledClosureFiles:observed.size,archiveFiles:artifact.files.length,stages:pids.size }));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path),false);
});

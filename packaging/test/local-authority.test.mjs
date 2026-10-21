import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join,dirname,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact,command,packageName } from '../build.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),fixture=fileURLToPath(new URL('./fixtures/local-authority.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
function sourceClosure() {
  const seen=new Set(),queue=['core/index.mjs'];
  while(queue.length) {
    const path=queue.pop();if(seen.has(path))continue;seen.add(path);if(!path.endsWith('.mjs'))continue;
    const text=readFileSync(join(root,path),'utf8');
    const imports=[...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)].map(row=>row[1]);
    const assets=[...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)].map(row=>row[1]);
    for(const target of [...imports,...assets]) {
      const next=relative(root,resolve(root,dirname(path),target));assert.equal(next.startsWith('..'),false);queue.push(next);
    }
  }
  return [...seen].sort();
}
for(const client of ['claude-code','codex'])test('B2b-08/09 installed '+client+' authority grant/capture/revoke/reopen and failure cleanup',{timeout:120000},async t=>{
  const workspace=createTestWorkspace(t,{prefix:'installed-local-authority-'}),home=join(workspace.path,'home');mkdirSync(home,{mode:0o700});
  const artifact=buildArtifact(),closure=sourceClosure();
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({name:'synthetic-installed-local',version:'0.0.0',private:true}),{flag:'wx',mode:0o600});
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const installed=join(workspace.path,'node_modules',packageName),database=join(workspace.path,'store.sqlite'),state=join(workspace.path,'state.json');
  for(const path of closure) {
    assert.ok(artifact.files.includes(path),path);assert.equal(sha(readFileSync(join(installed,path))),artifact.sourceHashes[path]);
    assert.deepEqual(readFileSync(join(installed,path)),readFileSync(join(root,path)));
  }
  const observed=new Set(),pids=new Set();
  for(const phase of ['grant','capture','revoke','reopen','deliberate-failure']) {
    const trace=join(workspace.path,phase+'-closure.jsonl');
    const child=spawnSync(process.execPath,[fixture,phase,installed,database,state,client,trace],{cwd:workspace.path,encoding:'utf8',timeout:30000,
      env:{PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_DISABLE_COMPILE_CACHE:'1',NODE_NO_WARNINGS:'1'}});
    assert.equal(child.error,undefined,child.error?.message);assert.equal(child.signal,null);
    if(phase==='deliberate-failure') {assert.equal(child.status,1);assert.match(child.stderr,/synthetic_installed_deliberate_failure/);}
    else {
      assert.equal(child.status,0,child.stderr+'\n'+child.stdout);const result=JSON.parse(child.stdout);
      assert.equal(result.phase,phase);assert.equal(result.client,client);assert.equal(result.networkCalls,0);
      assert.equal(result.modelCalls,phase==='capture'?1:0);assert.equal(result.importedCore,join(installed,'core/index.mjs'));pids.add(result.pid);
    }
    for(const line of readFileSync(trace,'utf8').trim().split('\n').filter(Boolean)) {
      const row=JSON.parse(line);if(row.path.startsWith(installed+'/'))observed.add(relative(installed,row.path));
    }
  }
  assert.equal(pids.size,4);assert.deepEqual([...observed].sort(),closure);
  t.diagnostic(JSON.stringify({client,sourceClosureFiles:closure.length,observedInstalledClosureFiles:observed.size,archiveFiles:artifact.files.length,successfulProcesses:pids.size,deliberateFailureExit:1}));
  await workspace.cleanup();assert.equal(existsSync(workspace.path),false);
});

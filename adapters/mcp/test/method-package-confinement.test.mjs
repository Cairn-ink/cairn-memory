import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,openSync,closeSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {prepareMethodFiles,METHOD_IMPORT_LIMITS} from '../method-package-files.mjs';
const fixture=fileURLToPath(new URL('./fixtures/method-files-race.mjs',import.meta.url));
function setup(t,mode){
  const workspace=createTestWorkspace(t,{prefix:'method-confinement-'}),root=join(workspace.path,'root'),outside=join(workspace.path,'outside');mkdirSync(root);mkdirSync(outside);
  writeFileSync(join(outside,'SKILL.md'),'OUTSIDE MUST NEVER BE READ');
  if(mode==='ancestor-swap'){mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','SKILL.md'),'pinned original');}
  else writeFileSync(join(root,'SKILL.md'),'pinned original');
  const config={root,outside,mode,module:new URL('../method-package-files.mjs',import.meta.url).href,result:join(workspace.path,'result')};
  return {workspace,config};
}
function run(workspace,config,namespace=false){
  const path=join(workspace.path,'config.json');writeFileSync(path,JSON.stringify(config));
  const out=join(workspace.path,'stdout'),err=join(workspace.path,'stderr'),stdout=openSync(out,'wx'),stderr=openSync(err,'wx');let result;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const args=namespace?['-Urm','--','/bin/sh','-c',
    'mount --bind "$1" "$2" || exit 77; "$3" "$4" "$5"; result=$?; umount "$2"; exit "$result"',
    'method-mount-test',config.outside,config.root+'/nested',process.execPath,fixture,path]:[fixture,path];
  try{result=spawnSync(namespace?'/usr/bin/unshare':process.execPath,args,{env,timeout:15000,stdio:['ignore',stdout,stderr]});}
  finally{closeSync(stdout);closeSync(stderr);}
  assert.equal(result.error,undefined,String(result.error));assert.equal(result.signal,null,readFileSync(err,'utf8'));
  return {result,stderr:readFileSync(err,'utf8'),outcome:result.status===0?JSON.parse(readFileSync(config.result,'utf8')):null};
}
for(const mode of ['socket','fifo-replacement','path-swap','link-change','growing','ancestor-swap'])test('H02 real process syscall race: '+mode,t=>{
  const {workspace,config}=setup(t,mode),{result,outcome}=run(workspace,config);assert.equal(result.status,0);
  assert.notEqual(outcome.pid,process.pid);assert.equal(outcome.changed,true);
  assert.equal(outcome.refused,mode!=='ancestor-swap');
  assert.ok(!JSON.stringify(outcome).includes('OUTSIDE MUST NEVER BE READ'));
  if(mode==='ancestor-swap')assert.equal(outcome.files[0].text,'pinned original');
  if(['socket','fifo-replacement'].includes(mode))assert.equal(outcome.dataReads,0,'replacement FIFO never receives a data open');
});
test('H02 real special device never receives a data open',t=>{
  const {workspace,config}=setup(t,'device');config.root='/dev';config.exclusions=readdirSync('/dev').filter(name=>name!=='null');
  const {result,outcome}=run(workspace,config);assert.equal(result.status,0);assert.equal(outcome.specialSeen,true);assert.equal(outcome.refused,true);assert.equal(outcome.dataReads,0);
});
test('H02 same-filesystem bind mount is refused before subtree enumeration (unprivileged user+mount namespace)',t=>{
  const {workspace,config}=setup(t,'mount');mkdirSync(join(config.root,'nested'));
  const {result,stderr,outcome}=run(workspace,config,true);
  if(result.status!==0){t.skip('UNVERIFIED bind mount: unshare/mount unavailable: '+stderr.trim());return;}
  assert.equal(outcome.refused,true);assert.equal(outcome.sameDevice,true);assert.ok(outcome.rootMount);assert.ok(outcome.childMount);assert.notEqual(outcome.rootMount,outcome.childMount);assert.ok(!JSON.stringify(outcome).includes('OUTSIDE MUST NEVER BE READ'));
});
test('H02 published depth and entry ceilings refuse before unbounded traversal',t=>{
  const workspace=createTestWorkspace(t,{prefix:'method-traversal-bounds-'}),root=join(workspace.path,'root');mkdirSync(root);
  let path=root;for(let i=0;i<=METHOD_IMPORT_LIMITS.traversalDepth;i++){path=join(path,'a');mkdirSync(path);}
  writeFileSync(join(path,'SKILL.md'),'synthetic');assert.throws(()=>prepareMethodFiles(root));
  const wide=join(workspace.path,'wide');mkdirSync(wide);
  for(let i=0;i<=METHOD_IMPORT_LIMITS.traversalEntries;i++)writeFileSync(join(wide,'skip-'+i),'');
  writeFileSync(join(wide,'SKILL.md'),'synthetic');assert.throws(()=>prepareMethodFiles(wide,['skip-*']));
});

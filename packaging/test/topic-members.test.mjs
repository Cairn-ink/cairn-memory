import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,copyFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';
import {buildArtifact,packageName} from '../build.mjs';
import {installedImportClosure} from './fixtures/installed-import-closure.mjs';
import { runMemberProcess } from './fixtures/topic-members-process.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const walk=(path,prefix='')=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();
test('E1M-09 installed offline archive, exact manifest/closure bytes, physical v18/current DELETE/WAL and real Worker',async t=>{
  const ws=createTestWorkspace(t,{prefix:'installed-topic-members-'}),home=join(ws.path,'home');mkdirSync(home);
  // Seed only lockfile-pinned tarballs into a writable private offline cache.
  const cache=join(ws.path,'npm-cache');
  const sourceCache=process.env.npm_config_cache ?? join(homedir(), process.platform==='win32'?'AppData/Local/npm-cache':'.npm');
  for(const lock of ['adapters/mcp/package-lock.json','adapters/openai/package-lock.json']) {
    const packages=JSON.parse(readFileSync(join(root,lock))).packages;
    for(const name of ['@modelcontextprotocol/server','@modelcontextprotocol/core','zod','tiktoken']) {
      const entry=packages['node_modules/'+name];if(!entry)continue;
      const digest=Buffer.from(entry.integrity.slice('sha512-'.length),'base64').toString('hex');
      const suffix=join('_cacache','content-v2','sha512',digest.slice(0,2),digest.slice(2,4),digest.slice(4));
      mkdirSync(dirname(join(cache,suffix)),{recursive:true});copyFileSync(join(sourceCache,suffix),join(cache,suffix));
    }
  }
  for(const name of ['@modelcontextprotocol/server','@modelcontextprotocol/core','zod','tiktoken']) {
    const url='https://registry.npmjs.org/'+name.replace('/','%2f');
    const key='make-fetch-happen:request-cache:'+url;
    const digest=createHash('sha256').update(key).digest('hex');
    const suffix=join('_cacache','index-v5',digest.slice(0,2),digest.slice(2,4),digest.slice(4));
    const source=join(sourceCache,suffix);
    if(!existsSync(source))continue;
    mkdirSync(dirname(join(cache,suffix)),{recursive:true});copyFileSync(source,join(cache,suffix));
    const entries=readFileSync(source,'utf8').split('\n').filter(line=>line.includes('\t')).map(line=>JSON.parse(line.slice(line.indexOf('\t')+1)));
    for(const entry of entries.filter(entry=>entry.key===key&&entry.integrity)) {
      const hex=Buffer.from(entry.integrity.slice('sha512-'.length),'base64').toString('hex');
      const content=join('_cacache','content-v2','sha512',hex.slice(0,2),hex.slice(2,4),hex.slice(4));
      if(existsSync(join(sourceCache,content))){mkdirSync(dirname(join(cache,content)),{recursive:true});copyFileSync(join(sourceCache,content),join(cache,content));}
    }
  }
  const command=(exe,args,cwd,config)=>{
    const result=runMemberProcess(exe,args,cwd,config,{npm_config_cache:cache});
    if(result.error||result.status!==0)throw Error(JSON.stringify({exe,args,code:result.error?.code,error:result.error?.message,exitCode:result.status,stderr:result.stderr}));
    return result.stdout;
  };
  let artifactDirectory;
  const artifact=buildArtifact({runCommand:command,ownDirectory:directory=>{artifactDirectory=directory;ws.defer(()=>rmSync(directory,{recursive:true,force:true}));}});
  writeFileSync(join(ws.path,'package.json'),JSON.stringify({name:'synthetic-installed-members',private:true}));
  command('npm',['install','--prefix',ws.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],ws.path,artifact.userconfig);
  const installed=join(ws.path,'node_modules',packageName);
  const archived=command('tar',['-tzf',artifact.artifactPath],ws.path,artifact.userconfig).trim().split('\n').map(p=>p.slice('package/'.length)).sort();
  assert.deepEqual(archived,walk(installed));
  const graph=installedImportClosure(installed,['core/index.mjs']),sourceGraph=installedImportClosure(root,['core/index.mjs']);
  assert.deepEqual(graph,sourceGraph);
  const modules=archived.filter(p=>/^core\/(?:topic-(?:members|snapshot)|memory-reader|read-database)/.test(p));
  assert.deepEqual(modules.sort(),graph.required.filter(p=>/^core\/(?:topic-(?:members|snapshot)|memory-reader|read-database)/.test(p)).sort());
  const docs=['docs/topic-overview.md','docs/plans/topic-overview-member-pages.md'];
  const manifest=JSON.parse(readFileSync(join(root,'packaging/artifact-files.json')));
  for(const p of [...graph.required,...docs]) {
    assert.ok(archived.includes(p),p);assert.ok(manifest.includes(p),p);
    assert.deepEqual(readFileSync(join(installed,p)),readFileSync(join(root,p)),p);
    assert.equal(createHash('sha256').update(readFileSync(join(installed,p))).digest('hex'),artifact.sourceHashes[p]);
  }
  for (const [path, hash] of Object.entries(artifact.sourceHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(join(installed,path))).digest('hex'),hash,path);
  }
  const child=runMemberProcess(process.execPath,[fileURLToPath(new URL('./fixtures/topic-members.mjs',import.meta.url)),installed,ws.path],
    ws.path,artifact.userconfig,{HOME:home,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(child.stdout);assert.equal(report.importedCore,join(installed,'core/index.mjs'));assert.equal(report.workersClosed,true);assert.equal(report.outcomes.length,4);
  t.diagnostic(JSON.stringify({...report,childCode:child.status,childSignal:child.signal,archiveFiles:archived.length,closureFiles:graph.required.length,memberModules:modules.length,docs:docs.length,setDifferences:[]}));
  await ws.cleanup();assert.equal(existsSync(ws.path),false);assert.equal(existsSync(artifactDirectory),false);
});

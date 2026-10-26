import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync,writeFileSync,rmSync,readdirSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,delimiter} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildArtifact,commandInvocation,packageName} from '../../build.mjs';

/** Actual npm pack/install with regular-file stdio, including in restricted CI. */
export function fileCommand(workspace,executable,args,cwd,userconfig) {
  writeFileSync(userconfig,'cache='+join(workspace.path,'npm-cache')+'\nregistry=https://registry.npmjs.org/\n');
  const outPath=join(workspace.path,'command-'+randomUUID()+'.stdout'),errPath=join(workspace.path,'command-'+randomUUID()+'.stderr');
  const out=openSync(outPath,'wx',0o600),err=openSync(errPath,'wx',0o600),invocation=commandInvocation(executable,args);
  let result;
  const temp=Object.fromEntries(['TMPDIR','TMP','TEMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  try{result=spawnSync(invocation.executable,invocation.args,{cwd,timeout:120000,stdio:['ignore',out,err],
    env:{PATH:dirname(process.execPath)+delimiter+(process.env.PATH??''),...temp,
      npm_config_userconfig:userconfig,npm_config_audit:'false',npm_config_fund:'false'}});}
  finally{closeSync(out);closeSync(err);}
  const stdout=readFileSync(outPath,'utf8'),stderr=readFileSync(errPath,'utf8');
  assert.equal(result.error,undefined,String(result.error));assert.equal(result.signal,null,stderr);assert.equal(result.status,0,stderr+stdout);
  return stdout;
}
// Isolate cache writes while reusing only the already-warmed public runtime
// metadata/tarballs required by the documented offline artifact prerequisite.
// Never copy unrelated registry entries or forward application environment.
function seedCache(workspace) {
  const source=join(homedir(),'.npm','_cacache'),target=join(workspace.path,'npm-cache','_cacache');
  const wanted=/^make-fetch-happen:request-cache:https:\/\/registry\.npmjs\.org\/(?:@modelcontextprotocol\/(?:core|server)|zod|tiktoken)(?:\/-\/[^/?]+\.tgz)?$/;
  const urls=new Set(['https://registry.npmjs.org/zod','https://registry.npmjs.org/tiktoken']);
  for(const name of ['core','server'])for(const encoded of ['@modelcontextprotocol%2f','@modelcontextprotocol%2F','@modelcontextprotocol/','%40modelcontextprotocol%2f'])urls.add('https://registry.npmjs.org/'+encoded+name);
  for(const adapter of ['mcp','openai']){
    const lock=JSON.parse(readFileSync(new URL('../../../adapters/'+adapter+'/package-lock.json',import.meta.url),'utf8'));
    for(const name of ['@modelcontextprotocol/core','@modelcontextprotocol/server','zod','tiktoken']){
      const entry=lock.packages['node_modules/'+name];if(entry)urls.add(entry.resolved);
    }
  }
  // Frozen fixture archives install the closure pinned in their own shrinkwrap.
  const fixtures=fileURLToPath(new URL('./',import.meta.url));
  for(const name of readdirSync(fixtures).filter(name=>name.endsWith('.tgz'))){
    const listed=spawnSync('tar',['-xzOf',join(fixtures,name),'package/npm-shrinkwrap.json'],{encoding:'utf8'});
    if(listed.status!==0)continue;
    for(const entry of Object.values(JSON.parse(listed.stdout).packages??{}))if(entry.resolved)urls.add(entry.resolved);
  }
  for(const url of urls){
    const key='make-fetch-happen:request-cache:'+url,hash=createHash('sha256').update(key).digest('hex'),suffix=join(hash.slice(0,2),hash.slice(2,4),hash.slice(4));
    const next=join(source,'index-v5',suffix);if(!existsSync(next))continue;
    const retained=[];
    for(const line of readFileSync(next,'utf8').split('\n')) {
      const tab=line.indexOf('\t');if(tab<0)continue;
      let record;try{record=JSON.parse(line.slice(tab+1));}catch{continue;}
      if(!wanted.test(decodeURIComponent(record.key??'')))continue;
      retained.push(line);
      const match=/^sha512-([A-Za-z0-9+/=]+)$/.exec(record.integrity??'');if(!match)continue;
      const hex=Buffer.from(match[1],'base64').toString('hex'),content=join('content-v2','sha512',hex.slice(0,2),hex.slice(2,4),hex.slice(4));
      if(existsSync(join(source,content))){mkdirSync(dirname(join(target,content)),{recursive:true});copyFileSync(join(source,content),join(target,content));}
    }
    if(retained.length){const output=join(target,'index-v5',suffix);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,'\n'+retained.join('\n')+'\n');}
  }
}
export async function installedMethods(workspace) {
  seedCache(workspace);
  const command=(...args)=>fileCommand(workspace,...args),artifact=buildArtifact({runCommand:command});
  workspace.defer(()=>rmSync(dirname(artifact.artifactPath),{recursive:true,force:true}));
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({name:'synthetic-installed-methods',version:'0.0.0',private:true}));
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const root=join(workspace.path,'node_modules',packageName),entry=join(root,'bin/cairn-memory.mjs');
  const {openMemoryCore}=await import(pathToFileURL(join(root,'core/contract.mjs')).href);
  const token=Object.freeze({}),grants=new WeakMap();
  const authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},
    isCurrent(grant){return grants.get(grant)??null;}};
  const path=join(workspace.path,'store.sqlite'),core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}});
  workspace.defer(()=>core.close());
  return {artifact,root,entry,path,core,call(method,input){return core[method](input,token);}};
}

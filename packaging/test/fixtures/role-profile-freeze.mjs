// Explicit maintainer command: refusal binary from 0416ef3c, and the merged
// tree's U5c-1 flag-off reference from the independent U5c-2 head 4aa9327b.
// Normal tests consume frozen archives and never require Git history.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,openSync,closeSync,mkdirSync,copyFileSync,symlinkSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {fileCommand} from './method-packages.mjs';
import {roleLegacyProbe} from '../../../adapters/mcp/test/fixtures/role-profile-legacy-probe.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),workspace=createTestWorkspace(null,{prefix:'role-frozen-base-'});
try {
  let serial=0;
  for(const [kind,base] of [['pre-v32','0416ef3c'],['flag-off','4aa9327b']]) {
    function get(path){
      const outPath=join(workspace.path,'git-'+serial++),out=openSync(outPath,'wx',0o600),err=openSync(outPath+'.err','wx',0o600);let result;
      try{result=spawnSync('git',['show',base+':'+path],{cwd:root,timeout:10000,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
      assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(outPath+'.err','utf8'));return readFileSync(outPath);
    }
    const manifest=JSON.parse(get('packaging/artifact-files.json')),dest=join(workspace.path,base);
    for(const path of new Set([...manifest,'packaging/build.mjs','packaging/artifact-files.json','packaging/bin/cairn-memory.mjs',
      'packaging/README.md','packaging/THIRD_PARTY_NOTICES.md','packaging/licenses/tiktoken-LICENSE','adapters/mcp/package-lock.json','adapters/openai/package-lock.json'])){
      mkdirSync(dirname(join(dest,path)),{recursive:true});writeFileSync(join(dest,path),get(path));
    }
    const {buildArtifact}=await import(pathToFileURL(join(dest,'packaging/build.mjs')));
    const artifact=buildArtifact({runCommand:(...args)=>fileCommand(workspace,...args)});
    workspace.defer(()=>rmSync(dirname(artifact.artifactPath),{recursive:true,force:true}));
    const provenance={base,sha256:artifact.sha256,files:artifact.files,sourceHashes:artifact.sourceHashes};
    copyFileSync(artifact.artifactPath,new URL('./role-profile-'+kind+'.tgz',import.meta.url));
    if(kind==='pre-v32') {
      writeFileSync(new URL('./role-profile-pre-v32.json',import.meta.url),JSON.stringify(provenance,null,2)+'\n');
    } else {
      // Only reviewed pinned SDK/tokenizer dependencies are reused; every
      // application source and packaging input above comes from git show base.
      for(const adapter of ['mcp','openai'])symlinkSync(join(root,'adapters',adapter,'node_modules'),join(dest,'adapters',adapter,'node_modules'),'dir');
      const probeDir=join(workspace.path,'probe');mkdirSync(probeDir);
      const probe=await roleLegacyProbe(dest,probeDir);
      writeFileSync(new URL('../../../adapters/mcp/test/fixtures/role-profile-pre-u5c1.json',import.meta.url),JSON.stringify({base,archive:provenance,value:probe},null,2)+'\n');
    }
    console.log(JSON.stringify({kind,base,files:artifact.files.length,bytes:artifact.bytes,sha256:artifact.sha256,gitExit:0,packExit:0}));
  }
}finally{await workspace.cleanup();}

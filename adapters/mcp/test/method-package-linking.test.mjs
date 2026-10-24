import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';

function child(workspace,source,args=[]) {
  const entry=join(workspace.path,'static-walk.mjs'),stdout=join(workspace.path,'stdout'),stderr=join(workspace.path,'stderr');
  writeFileSync(entry,source);
  const out=openSync(stdout,'w'),err=openSync(stderr,'w');let result;
  try{result=spawnSync(process.execPath,[...args,entry],{stdio:['ignore',out,err],env:{NODE_NO_WARNINGS:'1'}});}
  finally{closeSync(out);closeSync(err);}
  assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(stderr,'utf8'));
  return JSON.parse(readFileSync(stdout,'utf8'));
}
test('H01 CLI static graph resolves relative imports and package exports without reaching SQLite',t=>{
  const workspace=createTestWorkspace(t),entry=new URL('../cli.mjs',import.meta.url).href;
  const walked=child(workspace,`
    import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
    const pending=[${JSON.stringify(entry)}],seen=new Set(),edges=[];
    while(pending.length){
      const url=pending.pop();if(seen.has(url))continue;seen.add(url);
      assert.notEqual(url,'node:sqlite','SQLite must not link before retained runtime checks');
      if(!url.startsWith('file:')||!/[.](?:mjs|js)$/.test(url))continue;
      const source=readFileSync(new URL(url),'utf8');
      const declarations=/^\\s*(?:import\\s+(?:[^;'"()]+?\\s+from\\s+)?|export\\s+(?:\\*[^;'"()]*|\\{[^}]*\\})\\s+from\\s+)['"]([^'"]+)['"]/gm;
      for(const match of source.matchAll(declarations)){
        const target=import.meta.resolve(match[1],url);edges.push({from:url,specifier:match[1],to:target});pending.push(target);
      }
    }
    console.log(JSON.stringify({modules:[...seen],edges}));
  `,['--experimental-import-meta-resolve']);
  assert.ok(walked.modules.some(url=>url.endsWith('/method-package-command.mjs')));
  assert.ok(walked.modules.some(url=>url.endsWith('/method-package-files.mjs')));
  assert.ok(walked.modules.some(url=>url.endsWith('/method-package-transport.mjs')));
  assert.ok(walked.edges.some(edge=>edge.specifier==='@modelcontextprotocol/server/stdio'&&edge.to.includes('/node_modules/')));
  assert.ok(!walked.modules.includes('node:sqlite'));
});

test('H01 retained runtime rejection still precedes SQLite resolution through the statically linked CLI',t=>{
  const workspace=createTestWorkspace(t),entry=new URL('../cli.mjs',import.meta.url).href;
  for(const target of ['platform','node']){
    const result=child(workspace,`
      import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
      ${target==='platform'?"Object.defineProperty(process,'platform',{value:'darwin'});":"Object.defineProperty(process.versions,'node',{value:'22.15.0'});"}
      registerHooks({resolve(specifier,context,next){assert.notEqual(specifier,'node:sqlite','SQLite imported first');return next(specifier,context);}});
      const {start}=await import(${JSON.stringify(entry)});
      await assert.rejects(start(['--retained-raw-profile','/missing/profile.json']),/retained_raw_runtime_unavailable/);
      console.log(JSON.stringify({refused:true}));
    `);
    assert.deepEqual(result,{refused:true});
  }
});

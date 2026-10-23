import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {methodExclude,METHOD_IMPORT_LIMITS} from '../method-package-files.mjs';
import {METHOD_LIMITS} from '../../../core/method-package-input.mjs';

// The pre-fix implementation is an oracle only for small, non-adversarial cases.
// Never run the timeout regression through this backtracking implementation.
function priorExclude(pattern){
  let source='';
  for(let i=0;i<pattern.length;i++){
    const c=pattern[i];
    if(c==='*'){
      if(pattern[i+1]==='*'){
        if(pattern[i+2]==='/'){source+='(?:.*/)?';i+=2;}
        else{source+='.*';i++;}
      }else source+='[^/]*';
    }else if(c==='?')source+='[^/]';
    else if(c==='['){
      const end=pattern.indexOf(']',i+1);if(end<0)throw Error('invalid');
      let body=pattern.slice(i+1,end);if(!body||body.includes('/')||body.includes('['))throw Error('invalid');
      if(body[0]==='!')body='^'+body.slice(1);
      source+='(?!/)['+body+']';i=end;
    }else source+=c.replace(/[.()+^$|{}\]\\]/g,'\\$&');
  }
  const expression=new RegExp('^(?:'+source+(pattern.endsWith('/**')?'|'+source.slice(0,-3).replace(/\/$/,''):'')+')$','u');
  return path=>expression.test(path);
}

test('H02 exclusions preserve anchored Unicode glob semantics and trailing directory matching',()=>{
  const patterns=['**','**/a','**/*.md','assets/**','assets/**/**','a/**/b','a**/b','a***b',
    'a?/[!x].txt','[a-c]','[!a-c]','[^ab]','[!]','[-a]','[a-]',']','a.+($)^{}|.md','😀?','[😀-🙏]','a\n**','**\nb'];
  const paths=['','a','b','c','x','-','/','assets','assets/','assets/a/b','x/assets','a/b','ab','a/x/b',
    'a1/b.txt','a1/x.txt','a.md','x/y.md','x/y.txt','a.+($)^{}|.md',']','😀','😀b','🙏','aa\nb','a\n/b','\r','\u2028','\u2029'];
  const pieces=['a','b','*','**','?','[ab]','[!a]'];
  for(const left of pieces)for(const right of pieces)patterns.push(left+right,left+'/'+right,left+'/**/'+right);
  for(const left of ['a','b','😀','\n'])for(const right of ['a','b','/','\n'])paths.push(left+right,left+'/'+right);
  for(const pattern of patterns){const old=priorExclude(pattern),bounded=methodExclude(pattern);
    for(const path of paths)assert.equal(bounded(path),old(path),JSON.stringify({pattern,path}));}
  for(const pattern of ['[','[]','[z-a]','a/[a/b]','[[a]','a//b','a/../b','/a','a\\b','a\0b','x'.repeat(METHOD_IMPORT_LIMITS.excludeUnits+1)])
    assert.throws(()=>methodExclude(pattern),{code:'invalid_input'},JSON.stringify(pattern));
});

test('H02 adversarial and maximum-length exclusion matching completes in a real process before a hard deadline',t=>{
  const workspace=createTestWorkspace(t),stdout=join(workspace.path,'stdout'),stderr=join(workspace.path,'stderr');
  const source=`import assert from 'node:assert/strict';
    import {methodExclude,METHOD_IMPORT_LIMITS} from ${JSON.stringify(new URL('../method-package-files.mjs',import.meta.url).href)};
    import {METHOD_LIMITS} from ${JSON.stringify(new URL('../../../core/method-package-input.mjs',import.meta.url).href)};
    assert.equal(methodExclude('*a'.repeat(20)+'b')('a'.repeat(100)+'.md'),false);
    const pattern='*a'.repeat(255)+'?b',path='a'.repeat(509)+'.md';
    assert.equal(pattern.length,METHOD_IMPORT_LIMITS.excludeUnits);assert.equal(path.length,METHOD_LIMITS.pathUnits);
    const across='a'.repeat(200)+'/'+'a'.repeat(200)+'/'+'a'.repeat(107)+'.md';
    assert.equal(across.length,METHOD_LIMITS.pathUnits);
    assert.equal(methodExclude(pattern)(path),false);
    assert.equal(methodExclude('**'.repeat(256))(across),true);
    assert.equal(methodExclude('?'.repeat(512))(path),true);
    assert.equal(methodExclude('a'.repeat(512))('a'.repeat(512)),true);
    console.log(JSON.stringify({patternUnits:pattern.length,pathUnits:path.length}));`;
  const out=openSync(stdout,'wx'),err=openSync(stderr,'wx');let child;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  try{child=spawnSync(process.execPath,['--input-type=module','-e',source],{env,timeout:2000,killSignal:'SIGKILL',stdio:['ignore',out,err]});}
  finally{closeSync(out);closeSync(err);}
  assert.equal(child.error,undefined,String(child.error));assert.equal(child.signal,null,readFileSync(stderr,'utf8'));assert.equal(child.status,0,readFileSync(stderr,'utf8'));
  assert.deepEqual(JSON.parse(readFileSync(stdout,'utf8')),{patternUnits:METHOD_IMPORT_LIMITS.excludeUnits,pathUnits:METHOD_LIMITS.pathUnits});
});

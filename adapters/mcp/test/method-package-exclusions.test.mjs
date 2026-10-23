import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {methodExclude,prepareMethodFiles,METHOD_IMPORT_LIMITS} from '../method-package-files.mjs';
import {METHOD_LIMITS} from '../../../core/method-package-input.mjs';

// Contract cases, rather than an oracle that inherits the former regex defects.
test('H02 exclusions implement anchored POSIX glob syntax, Unicode classes and trailing directory matching',()=>{
  const cases=[
    ['**','a/b',true],['**/a','a',true],['**/a','x/a',true],['**/a','a/x',false],
    ['**/*.md','x/y.md',true],['**/*.md','x/y.txt',false],['assets/**','assets',true],
    ['assets/**','assets/a/b',true],['assets/**','x/assets',false],['a/**/b','a/b',true],
    ['a/**/b','a/x/y/b',true],['a**/b','ab',true],['a***b','a/x/b',true],
    ['a?/[!x].txt','a1/b.txt',true],['a?/[!x].txt','a1/x.txt',false],['a?/[!x].txt','a12/b.txt',false],
    ['[a-c]','b',true],['[!a-c]','x',true],['[!a-c]','b',false],['[^ab]','x',true],
    ['[!]','a',true],['[!]','/',false],['[-a]','-',true],['[a-]','-',true],
    [']',']',true],['a.+($)^{}|.md','a.+($)^{}|.md',true],['a.+($)^{}|.md','prefixa.+($)^{}|.md',false],
    ['😀?','😀b',true],['😀?','😀bc',false],['[😀-🙏]','🙏',true],
    ['*.png','a/b.png',false],['?.png','/.png',false],['[!x].png','/.png',false],
  ];
  for(const [pattern,path,expected] of cases)assert.equal(methodExclude(pattern)(path),expected,JSON.stringify({pattern,path}));
  for(const pattern of ['[','[]','[z-a]','a/[a/b]','[[a]','a//b','a/../b','/a','a\\b','a\0b','x'.repeat(METHOD_IMPORT_LIMITS.excludeUnits+1)])
    assert.throws(()=>methodExclude(pattern),{code:'invalid_input'},JSON.stringify(pattern));
});

const lineTerminators=[['LF','\n'],['CR','\r'],['U+2028','\u2028'],['U+2029','\u2029']];
for(const [name,character] of lineTerminators)test(`H02 POSIX wildcards/classes match ${name} in files and directories; globstar corrects the old matcher`,()=>{
  const file='file'+character+'name.png',directory='dir'+character+'name';
  const cases=[
    ['file*.png',file],['file?name.png',file],['file['+character+']name.png',file],['file[!x]name.png',file],
    ['**.png',file],['dir*name/image.png',directory+'/image.png'],
    ['dir?name/image.png',directory+'/image.png'],['dir['+character+']name/image.png',directory+'/image.png'],
    ['dir[!x]name/image.png',directory+'/image.png'],['**/*.png',directory+'/image.png'],
    ['prefix/**/image.png','prefix/'+directory+'/nested/image.png'],['assets/**','assets/'+directory+'/'+file],
  ];
  for(const [pattern,path] of cases)assert.equal(methodExclude(pattern)(path),true,JSON.stringify({pattern,path}));
  for(const pattern of ['file*.png','file?name.png','file[!x]name.png'])assert.equal(methodExclude(pattern)('file/path/name.png'),false);
  assert.equal(methodExclude('**/*.png')(directory+'/image.png.suffix'),false);
});

test('H02 real line-terminator directory names permit explicit binary pruning, correcting the old globstar refusal',t=>{
  const workspace=createTestWorkspace(t),root=join(workspace.path,'package');mkdirSync(root);writeFileSync(join(root,'SKILL.md'),'Synthetic method');
  const excluded=[];
  for(const [,character] of lineTerminators){
    const directory='dir'+character+'name',file='file'+character+'name.png';mkdirSync(join(root,directory));
    writeFileSync(join(root,directory,'image.png'),Buffer.from([0xff]));writeFileSync(join(root,file),Buffer.from([0xff]));
    excluded.push(directory+'/image.png',file);
  }
  const prepared=prepareMethodFiles(root,['**/*.png']);workspace.defer(()=>prepared.close());
  assert.deepEqual(prepared.files.map(file=>file.path),['SKILL.md']);assert.deepEqual(prepared.pruned,excluded.sort());prepared.validate();
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

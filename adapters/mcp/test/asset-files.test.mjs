import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runFile } from './asset-support.mjs';

for(let position=1;position<=6;position++)test(`L02 input close ${position}: retain first error, close all once`,{timeout:30000},t=>{
  const workspace=createTestWorkspace(t,{prefix:'asset-input-close-'}),a=join(workspace.path,'a.txt'),b=join(workspace.path,'b.txt');
  writeFileSync(a,'supplied a');writeFileSync(b,'supplied b');
  const child=join(workspace.path,'close-child.mjs');
  writeFileSync(child,`
    import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    import {prepareAssetFiles} from ${JSON.stringify(new URL('../asset-files.mjs',import.meta.url).href)};
    const files=prepareAssetFiles();files.read(${JSON.stringify(a)},100);files.read(${JSON.stringify(b)},100);
    const original=fs.closeSync,attempts=[],first=Error('first private close error'),second=Error('second private close error');
    fs.closeSync=fd=>{attempts.push(fd);original(fd);if(attempts.length===${position})throw first;if(attempts.length===${position+1})throw second;};
    syncBuiltinESMExports();let failure;
    try{files.close();}catch(error){failure=error;}
    finally{fs.closeSync=original;syncBuiltinESMExports();}
    assert.equal(failure,first);assert.equal(attempts.length,6);assert.equal(new Set(attempts).size,6);
    // Tracking was consumed on the first attempt, even for a failed close.
    fs.closeSync=()=>{throw Error('must not retry');};syncBuiltinESMExports();
    try{files.close();}finally{fs.closeSync=original;syncBuiltinESMExports();}
    console.log(JSON.stringify({attempts:attempts.length,firstErrorRetained:true,retries:0}));
  `);
  const result=runFile(workspace,[],{command:child});assert.equal(result.code,0,result.stderr);
  assert.deepEqual(JSON.parse(result.output),{attempts:6,firstErrorRetained:true,retries:0});
});

for(let position=1;position<=3;position++)test(`L04 pre-publication export close ${position}: first close error survives later errors`,{timeout:30000},t=>{
  const workspace=createTestWorkspace(t,{prefix:'asset-export-first-close-'}),child=join(workspace.path,'close-export.mjs');
  writeFileSync(child,`
    import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    import {exportAsset} from ${JSON.stringify(new URL('../asset-export.mjs',import.meta.url).href)};
    const parent=${JSON.stringify(workspace.path)},originalClose=fs.closeSync,originalWrite=fs.writeSync,attempts=[];
    const first=Error('first private close error'),second=Error('second private close error');
    fs.writeSync=(fd,...args)=>{if(fs.readlinkSync('/proc/self/fd/'+fd).startsWith(parent+'/.cairn-export-'))throw Error('private write failure');return originalWrite(fd,...args);};
    fs.closeSync=fd=>{
      const target=fs.readlinkSync('/proc/self/fd/'+fd),ours=target.startsWith(parent+'/.cairn-export-')||target===parent;
      originalClose(fd);if(!ours)return;attempts.push(fd);
      if(attempts.length===${position})throw first;if(attempts.length===${position+1})throw second;
    };
    syncBuiltinESMExports();let failure;const before=fs.readdirSync(parent).sort();
    const version={type:'asset-version',namespace:{ownerId:'synthetic',scope:'personal',projectId:null},assetId:'asset',versionId:'version',contentIdentity:'x'.repeat(43)};
    try{exportAsset(()=>({ok:true,value:{status:'available',version,index:0,encoding:'base64',bytes:'YWJj',byteCount:3,totalByteCount:3,complete:true,nextCursor:null}}),version,parent+'/private.pdf');}
    catch(error){failure=error;}
    finally{fs.closeSync=originalClose;fs.writeSync=originalWrite;syncBuiltinESMExports();}
    assert.equal(failure,first);assert.equal(attempts.length,3);assert.equal(new Set(attempts).size,3);
    assert.deepEqual(fs.readdirSync(parent).sort(),before);
    console.log(JSON.stringify({attempts:3,firstErrorRetained:true}));
  `);
  const result=runFile(workspace,[],{command:child});assert.equal(result.code,0,result.stderr);
  assert.deepEqual(JSON.parse(result.output),{attempts:3,firstErrorRetained:true});
});

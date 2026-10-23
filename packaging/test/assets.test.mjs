import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installedMethods } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';

test('K01/K03/K12 actual installed artifact includes the complete asset closure and standalone restart lifecycle',{timeout:180000},async t=>{
  const w=createTestWorkspace(t,{prefix:'installed-assets-'}),installed=await installedMethods(w),root=installed.root;
  const {openMemoryCore}=await import(pathToFileURL(join(root,'core/contract.mjs')).href);
  const {ASSET_METHODS}=await import(pathToFileURL(join(root,'core/asset-input.mjs')).href);
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token||!ASSET_METHODS.includes(request.method))return null;const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const namespace={ownerId:'synthetic-installed-assets',scope:'personal',projectId:null},path=join(w.path,'asset.sqlite'),options={path,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}};
  let core=openMemoryCore(options);w.defer(()=>core.close());
  const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
  const data=Buffer.alloc(65537,0xff);data.set(Buffer.from('%PDF-1.7'));
  const input={namespace,actionId:'import',title:'Synthetic installed asset',filename:'synthetic.pdf',mediaType:'application/pdf',bytes:data};
  const receipt=ok(core.importAssetVersion(input,token));core.close();core=openMemoryCore(options);
  const chunks=[];let cursor;
  do {const page=ok(core.readAssetBytes({version:receipt.version,...(cursor?{cursor}:{})},token));chunks.push(Buffer.from(page.bytes,'base64'));cursor=page.nextCursor;}while(cursor);
  assert.deepEqual(Buffer.concat(chunks),data);assert.equal(ok(core.verifyAssetBytes({version:receipt.version,bytes:data},token)).matches,true);
  ok(core.deleteAsset({actionId:'delete',ref:receipt.asset,expectedRevision:1},token));
  assert.deepEqual(ok(core.importAssetVersion(input,token)),receipt);assert.equal(ok(core.getAssetUsage({namespace},token)).retainedBinaryBytes,0);
  const closure=installedImportClosure(root,['core/contract.mjs']),manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  for(const name of ['facade','input','identity','schema','storage']){
    const path='core/asset-'+name+'.mjs';assert.ok(manifest.files.includes(path));assert.ok(closure.eager.includes(path));
  }
});

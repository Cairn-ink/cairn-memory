import { familyCostParity } from '../testing/receipt-event-time-gates.mjs';
import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { METHOD_READS } from '../method-package-input.mjs';
import { ASSET_READS } from '../asset-input.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
const bytes=Buffer.alloc(33000,0x61);bytes.set(Buffer.from('%PDF-1.7'));
const cursorMethods=new Set(['readMethodFile','listMethodManifest','listMethodPackages','listMethodVersions','resolveMethodsForRole','listMethodBindingEvents','listAssets','listAssetVersions','listAssetDerivatives','readAssetBytes','readMethodAttachmentBytes','readAssetDerivative']);

// Every Method/Asset retained read has a distinct public invocation here. List
// cases deliberately include cursor pages; the expected record set is pinned.
export function catalogCases(m,a,d) {
 const context={readSet:[ns],roleId:null};
 return [
 ['getMethodVersion',{version:m.version,intent:'history'}],['listMethodManifest',{version:m.version,intent:'history'}],
 ['readMethodFile',{version:m.version,intent:'history',path:'SKILL.md'}],['readMethodAttachmentBytes',{version:m.version,intent:'history',path:'reference.pdf'}],
 ['listMethodPackages',{namespace:ns,limit:1}],['listMethodVersions',{package:m.package,limit:1}],
 ['compareMethodVersions',{from:m.version,to:m.version}],['listMethodEffects',{namespace:ns,limit:1}],['getMethodPackageUsage',{namespace:ns}],
 ['resolveMethod',{package:m.package,...context}],['resolveMethodsForRole',{...context,limit:1}],['listMethodBindingEvents',{bindingNamespace:ns,limit:1}],
 ['checkMethodReasonRefs',{namespace:ns,reasonRefs:[]}],
 ['listAssets',{namespace:ns,limit:1}],['listAssetVersions',{asset:a.asset,limit:1}],['getAssetVersion',{version:a.version}],
 ['readAssetBytes',{version:a.version}],['verifyAssetBytes',{version:a.version,bytes}],['getAssetUsage',{namespace:ns}],
 ['listAssetEffects',{namespace:ns,limit:1}],['listAssetDerivatives',{version:a.version,limit:1}],['readAssetDerivative',{ref:d.derivative}],
 ];
}

test('R2 Method/Asset catalog: all 22 read identities, zero/five facts and cursor pages',async t=>{
 const measured=[];
 for(const [safety,facts]of costGatePopulations()) {
  const f=safetyFixture(t,33);if(safety)await f.migrate();const db=f.connect();
  const core=openMemoryCore({path:f.path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
  t.after(()=>{core.close();db.close();});
  const m=ok(core.importMethodVersion({namespace:ns,actionId:'method',title:'Synthetic method',manifestFormat:'mixed-v1',files:[{kind:'text',path:'SKILL.md',text:'Synthetic retained text'+'x'.repeat(9000),mediaType:'text/markdown'},{kind:'binary',path:'reference.pdf',bytes,mediaType:'application/pdf'},...Array.from({length:19},(_,i)=>({kind:'text',path:'guide-'+i+'.md',text:'Synthetic extra guide',mediaType:'text/markdown'}))]},{}));
  ok(core.adoptMethodVersion({bindingNamespace:ns,package:m.package,version:m.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt'},{}));
  const a=ok(core.importAssetVersion({namespace:ns,actionId:'asset',title:'Synthetic asset',filename:'reference.pdf',bytes,mediaType:'application/pdf'},{}));
  const d=ok(core.createAssetDerivative({version:a.version,actionId:'derivative',expectedVersionRevision:1,kind:'description',text:'\u0001'.repeat(20000),method:{kind:'user-provided'}},{}));
  ok(core.importMethodVersion({namespace:ns,actionId:'method-next',title:'Synthetic next',package:m.package,expectedPackageRevision:1,basedOn:m.version,files:[{path:'SKILL.md',text:'Synthetic next text',mediaType:'text/markdown'}]},{}));
  const extra=ok(core.importMethodVersion({namespace:ns,actionId:'method-other',title:'Synthetic other',files:[{path:'SKILL.md',text:'Synthetic other text',mediaType:'text/markdown'}]},{}));
  ok(core.adoptMethodVersion({bindingNamespace:ns,package:extra.package,version:extra.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt-other'},{}));
  ok(core.importAssetVersion({namespace:ns,actionId:'asset-next',title:'Synthetic asset next',filename:'next.pdf',bytes,mediaType:'application/pdf',asset:a.asset,expectedAssetRevision:1},{}));
  ok(core.importAssetVersion({namespace:ns,actionId:'asset-other',title:'Synthetic asset other',filename:'other.pdf',bytes,mediaType:'application/pdf'},{}));
  ok(core.createAssetDerivative({version:a.version,actionId:'derivative-other',expectedVersionRevision:1,kind:'description',text:'Synthetic other description',method:{kind:'user-provided'}},{}));
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,33,safety,facts,ns.ownerId,{testName:t.name});
  const cases=catalogCases(m,a,d);
  const missingNamespace={...ns,scope:'project',projectId:'absent'};
  const missingM={package:{...m.package,namespace:missingNamespace,packageId:'absent'},version:{...m.version,namespace:missingNamespace,packageId:'absent',versionId:'absent'}};
  const missingA={asset:{...a.asset,namespace:missingNamespace,assetId:'absent'},version:{...a.version,namespace:missingNamespace,assetId:'absent',versionId:'absent'}};
  const missingD={derivative:{...d.derivative,namespace:missingNamespace,assetId:'absent',versionId:'absent',derivativeId:'absent'}};
  const absentCases=catalogCases(missingM,missingA,missingD).map(([method,input])=>[method,{...input,...(input.namespace?{namespace:missingNamespace}:{}),...(input.bindingNamespace?{bindingNamespace:missingNamespace}:{}),...(input.readSet?{readSet:[missingNamespace]}:{})}]);
  assert.deepEqual(cases.map(([name])=>name).sort(),[...METHOD_READS,...ASSET_READS].sort(),'all real read method names have a case');
  const records=[];
  for(const [method,input]of cases) {
   assert.equal(typeof core[method],'function');
   const row=await measureContentRead(method,'hit',()=>core[method](input,{}));
   assert.equal(row.result.ok,true,method+' '+JSON.stringify(row.result));
   records.push({...row,result:undefined});
   if(cursorMethods.has(method)){assert.equal(typeof row.result.value.nextCursor,'string','required cursor case: '+method);const page=await measureContentRead(method,'cursor',()=>core[method]({...input,cursor:row.result.value.nextCursor},{}));assert.equal(page.result.ok,true,JSON.stringify(page.result));records.push({...page,result:undefined});}
  }
  const noHit=new Set(['listMethodPackages','listMethodEffects','getMethodPackageUsage','resolveMethodsForRole','listMethodBindingEvents','checkMethodReasonRefs','listAssets','getAssetUsage','listAssetEffects']);
  for(const [method,input]of absentCases){const row=await measureContentRead(method,noHit.has(method)?'no-hit':'missing-ref',()=>core[method](input,{}));if(noHit.has(method))assert.equal(row.result.ok,true,method+' no-hit '+JSON.stringify(row.result));else {assert.equal(row.result.ok,false,method+' missing-ref');assert.equal(row.result.error.code,ASSET_READS.has(method)?'asset_not_found':'method_not_found',method);} assert.doesNotMatch(JSON.stringify(row.result),/Synthetic retained text|Synthetic method|Synthetic asset|Synthetic description/);for(const key of ['packages','versions','files','methods','events','effects','assets','derivatives','parts','reasonRefs'])if(Array.isArray(row.result.value?.[key]))assert.equal(row.result.value[key].length,0,method+' empty '+key);records.push({...row,result:undefined});}
  assert.deepEqual(records.map(r=>[r.method,r.variant]),[...cases.flatMap(([method])=>[[method,'hit'],...(cursorMethods.has(method)?[[method,'cursor']]:[])]),...absentCases.map(([method])=>[method,noHit.has(method)?'no-hit':'missing-ref'])],'exact expected method/case/cell set');
  assert.deepEqual(records.filter(r=>r.variant==='hit').map(r=>r.method).sort(),cases.map(([method])=>method).sort());
  assertCostGateCases('catalog',records);
  measured.push({safety,facts,records});
 }
 t.diagnostic('R3_CATALOG_COUNTS '+JSON.stringify(measured));
 if(assertCostGateCells(measured))return;
 const [legacy,zero,five]=measured;
 for(const current of [zero,five]) {
  assert.deepEqual(current.records.map(r=>[r.method,r.variant]),legacy.records.map(r=>[r.method,r.variant]),'exact method/case/cell inventory');
  for(const [i,row]of current.records.entries()) {const old=legacy.records[i];assert.equal(row.statements-old.statements,current.facts?6:4,row.method);assert.equal(row.begin,old.begin,row.method);}
 }
});


test('R2 product family gate B: catalog smallest case, exact zero/five-fact parity', async t => {
  await familyCostParity(t, 33, async (f, db, facts) => {

  const core = openMemoryCore({ path: f.path, methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } });
  t.after(() => core.close());
  const m = ok(core.importMethodVersion({ namespace: ns, actionId: 'family-method', title: 'Synthetic family method',
    files: [{ path: 'SKILL.md', text: 'Synthetic retained text', mediaType: 'text/markdown' }] }, {}));
  return { method: 'getMethodVersion', variant: 'hit', call: () => core.getMethodVersion({ version: m.version, intent: 'history' }, {}),
    check(result) { assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(result.value); } };
  });
});

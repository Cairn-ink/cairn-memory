import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../core/index.mjs';

// Scripted synthetic approvals demonstrate the port; a real host must obtain
// independent explicit user intent and fresh exact-namespace read authority.
const namespace = { ownerId:'synthetic-method-owner',scope:'personal',projectId:null };
const tokens = new WeakMap(), grants = new WeakMap();
const authority = {
  authorize(request,token) {
    const approved = tokens.get(token);
    if (!approved || approved.method !== request.method || !isDeepStrictEqual(approved.input,request.input) ||
        !isDeepStrictEqual(request.namespace,namespace) ||
        !(request.actionClass==='read' || request.actionClass==='explicit-user' && ['importMethodVersion','adoptMethodVersion','disableMethodBinding','deleteMethodVersion','deleteMethodPackage'].includes(request.method))) return null;
    const grant = {}, { input,...binding } = request;
    grants.set(grant,{...binding,accessGeneration:1});return grant;
  },
  isCurrent: grant => grants.get(grant) ?? null,
};
const path = join(mkdtempSync(join(tmpdir(),'cairn-method-demo-')),'synthetic.sqlite');
const configuration = {path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}};
let core = openMemoryCore(configuration);
const ok = result => {assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
function call(method,input) {
  const token = {};tokens.set(token,{method,input:structuredClone(input)});
  try{return ok(core[method](input,token));}finally{tokens.delete(token);}
}
try {
  const firstInput = {namespace,actionId:'import-one',title:'Synthetic planning method',submittedBy:'Synthetic author',files:[{
    path:'SKILL.md',mediaType:'text/markdown',text:'# Synthetic method\n\nWrite a small plan.\n'}]};
  const first = call('importMethodVersion',firstInput);
  const second = call('importMethodVersion',{...firstInput,actionId:'import-two',package:first.package,
    expectedPackageRevision:1,basedOn:first.version,files:[{...firstInput.files[0],text:'# Synthetic method\n\nWrite and review a small plan.\n'}],
    change:{items:[{summary:'Explicitly authored addition of a review step.',paths:['SKILL.md']}],reasonRefs:[]}});
  const history = call('readMethodFile',{version:first.version,path:'SKILL.md',intent:'history'});
  assert.equal(history.parts[0].text,firstInput.files[0].text);assert.equal(history.adoptionStatus,'unassessed');
  const comparison = call('compareMethodVersions',{from:first.version,to:second.version});
  assert.equal(comparison.changes[0].status,'changed');assert.equal(comparison.reason,'not-recorded');
  const adopted=call('adoptMethodVersion',{bindingNamespace:namespace,actionId:'adopt',package:first.package,
    version:second.version,roleId:'planner',expectedRevision:null,readSet:[namespace]});
  const context={readSet:[namespace],roleId:'planner'};
  const resolved=call('resolveMethod',{...context,package:first.package});
  assert.equal(resolved.status,'current');assert.deepEqual(resolved.version,second.version);
  const pinned=call('readMethodFile',{version:second.version,path:'SKILL.md',intent:'current',context,snapshot:resolved.snapshot});
  assert.equal(pinned.adoptionStatus,'current');
  call('disableMethodBinding',{bindingNamespace:namespace,actionId:'disable',package:first.package,roleId:'planner',
    expectedRevision:adopted.binding.revision,readSet:[namespace]});
  assert.equal(call('resolveMethod',{...context,package:first.package}).status,'disabled');
  assert.equal(call('readMethodFile',{version:second.version,path:'SKILL.md',intent:'history',snapshot:resolved.snapshot}).parts[0].text,pinned.parts[0].text);
  call('deleteMethodPackage',{actionId:'purge',ref:first.package,expectedRevision:2});
  core.close();core=openMemoryCore(configuration);
  assert.deepEqual(call('importMethodVersion',firstInput),first);
  assert.equal(call('getMethodVersion',{version:first.version,intent:'history'}).status,'unavailable');
  assert.equal(call('getMethodPackageUsage',{namespace}).retainedFileBytes,0);
  assert.deepEqual(call('listMethodEffects',{namespace}).effects.map(effect=>effect.kind),['binding_changed','binding_changed','method_package_deleted']);
  console.log(JSON.stringify({syntheticDatabase:path,versions:[first.ordinal,second.ordinal],historyStatus:history.adoptionStatus,
    comparison:comparison.changes[0].status,reason:comparison.reason,adoptResolvePinDisable:true,replayAfterPurge:true,retainedFileBytes:0},null,2));
} finally {core.close();}

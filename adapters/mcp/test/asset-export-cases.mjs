import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync,writeFileSync,readFileSync,readdirSync,statSync,symlinkSync,chmodSync,existsSync } from 'node:fs';
import { fixture,input,pdf,ok,ns } from '../../../core/testing/asset-fixtures.mjs';
import { runFile,assertExportReceipt } from './asset-support.mjs';
const preload=fileURLToPath(new URL('./fixtures/asset-export-fault.mjs',import.meta.url));
export async function exportCases(test,{command}={}){
function setup(t){
  const f=fixture(t),data=pdf(65537),prose='Confidential supplied binary prose',title='Confidential supplied asset title',filename='private-source.pdf';
  data.set(Buffer.from(prose),16);
  const saved=ok(f.call('importAssetVersion',input('export',{bytes:data,title,filename}))),parent=join(f.workspace.path,'private-output');
  mkdirSync(parent,{mode:0o700});return {...f,data,saved,parent,prose,title,filename,command};
}
function run(f,extra={},options={}){
  const args=['assets','export','--db',f.path,'--owner',ns.ownerId,'--version',JSON.stringify(f.saved.version),'--out',join(f.parent,'final.pdf')];
  const check=result=>{
    assertExportReceipt(result.output,{version:f.saved.version,byteCount:f.data.length,
      forbidden:[f.workspace.path,f.parent,'final.pdf',f.filename,f.title,f.prose,'%PDF-1.7',f.data.toString('base64'),f.data.toString('hex'),'synthetic private I/O prose']});
    return result;
  };
  if(!extra.operation)return check(runFile(f.workspace,args,{command:f.command,...options}));
  const config=join(f.workspace.path,'fault.json'),trace=join(f.workspace.path,'trace'),audit=join(f.workspace.path,'audit.json');
  writeFileSync(config,JSON.stringify({...extra,parent:f.parent,trace,audit}));
  const result=check(runFile(f.workspace,args,{command:f.command,...options,imports:[preload],env:{U4B_FAULT_CONFIG:config},signal:extra.action==='kill'?'SIGKILL':null}));
  assert.equal(readFileSync(trace,'utf8').trim().split('\n').length,1,'fault must execute exactly once');
  return {...result,...(extra.action==='kill'?{}:{audit:JSON.parse(readFileSync(audit,'utf8'))})};
}
await test('L04 export create-only exact multi-page bytes; existing file/symlink and unsafe parents refuse',{timeout:30000},t=>{
  const f=setup(t),final=join(f.parent,'final.pdf');mkdirSync(join(f.parent,'.cairn-export-stale'));writeFileSync(join(f.parent,'.cairn-export-stale','foreign'),'preserve');
  const first=run(f);assert.equal(first.code,0,first.output);assert.deepEqual(readFileSync(final),f.data);assert.equal(statSync(final).mode&0o777,0o600);
  const repeat=run(f);assert.equal(repeat.code,1);assert.equal(JSON.parse(repeat.output).error.code,'EEXIST');assert.deepEqual(readFileSync(final),f.data);
  const second={...f,parent:join(f.workspace.path,'symlink')};mkdirSync(second.parent);symlinkSync(final,join(second.parent,'final.pdf'));
  const linked=run(second);assert.equal(linked.code,1);assert.equal(JSON.parse(linked.output).error.code,'EEXIST');assert.deepEqual(readFileSync(final),f.data);
  chmodSync(second.parent,0o777);assert.equal(run(second).code,1);assert.equal(readFileSync(join(f.parent,'.cairn-export-stale','foreign'),'utf8'),'preserve');
  assert.deepEqual(readdirSync(f.parent).sort(),['.cairn-export-stale','final.pdf']);
});
for(const operation of ['write','fsync','link','unlink'])for(const index of operation==='fsync'?[1,2,3,4]:[1])for(const phase of ['before','after'])for(const action of ['throw','kill'])await test(`L04 ${action} ${phase} ${operation} ${index}: no partial final`,{timeout:30000},t=>{
  const f=setup(t),result=run(f,{operation,index,phase,action}),final=join(f.parent,'final.pdf');
  const wasPublished=operation==='write'?false:operation==='fsync'?index>1:operation==='unlink'||phase==='after';
  assert.equal(existsSync(final),wasPublished);
  if(wasPublished)assert.deepEqual(readFileSync(final),f.data);
  if(action==='throw'){
    assert.equal(result.code,1,result.output);
    if(wasPublished)assert.equal(JSON.parse(result.output).error.code,'published-but-durability-uncertain');
    assert.deepEqual(readdirSync(f.parent),wasPublished?['final.pdf']:[]);
  }else{
    assert.equal(result.signal,'SIGKILL');
    for(const name of readdirSync(f.parent).filter(n=>n!== 'final.pdf')){
      assert.match(name,/^\.cairn-export-/);const dir=join(f.parent,name);assert.equal(statSync(dir).mode&0o777,0o700);
      for(const temp of readdirSync(dir)){const actual=readFileSync(join(dir,temp));assert.deepEqual(actual,operation==='write'?f.data.subarray(0,phase==='before'?0:32768):f.data);assert.equal(statSync(join(dir,temp)).mode&0o777,0o600);}
    }
  }
});
for(const [operation,index] of [['open-parent',1],['inspect-parent',1],['mkdir-stage',1],['open-stage',1],['inspect-stage',1],['inspect-stage',2],['open-data',1],['inspect-data',1]])await test(`L04 setup ${operation} ${index} failure removes owned staging`,{timeout:30000},t=>{
  const f=setup(t),result=run(f,{operation,index,phase:'before',action:'throw'});
  assert.equal(result.code,1,result.output);assert.deepEqual(readdirSync(f.parent),[]);
  assert.deepEqual(result.audit.closeAttempts,[...result.audit.opened].reverse(),'every acquired setup descriptor closes once');
});
for(const operation of ['open-sync-parent','open-sync-stage'])await test(`L04 ${operation} failure reports content-free uncertain publication`,{timeout:30000},t=>{
  const f=setup(t),result=run(f,{operation,index:1,phase:'before',action:'throw'});
  assert.equal(result.code,1,result.output);assert.equal(JSON.parse(result.output).error.code,'published-but-durability-uncertain');
  assert.deepEqual(readFileSync(join(f.parent,'final.pdf')),f.data);assert.deepEqual(readdirSync(f.parent),['final.pdf']);
  const expected=operation==='open-sync-parent'?['data','stage','parent']:['data','sync-parent','stage','parent'];
  assert.deepEqual(result.audit.closeAttempts,expected);
});
for(const beforePublish of [true,false])for(const index of beforePublish?[1,2,3]:[1,2,3,4,5])for(const phase of ['before','after'])await test(`L04 close ${index} ${phase}, ${beforePublish?'before':'after'} publication attempts remaining closes`,{timeout:30000},t=>{
  const f=setup(t),result=run(f,{operation:'close',index,phase,action:'throw',beforePublish}),final=join(f.parent,'final.pdf');
  assert.equal(result.code,1,result.output);assert.equal(existsSync(final),!beforePublish);
  if(!beforePublish){assert.deepEqual(readFileSync(final),f.data);assert.equal(JSON.parse(result.output).error.code,'published-but-durability-uncertain');}
  else assert.equal(JSON.parse(result.output).error.code,'storage_error');
  const expected=beforePublish?['data','stage','parent']:['sync-stage','data','sync-parent','stage','parent'];
  assert.deepEqual(result.audit.closeAttempts,expected,'each acquired fd is attempted exactly once, even after a failed close');
  assert.deepEqual(readdirSync(f.parent),beforePublish?[]:['final.pdf']);
});
await test('L04 completed-file readback detects disk byte substitution before publication',{timeout:30000},t=>{
  const f=setup(t),result=run(f,{operation:'write',index:1,phase:'before',action:'corrupt'});
  assert.equal(result.code,1,result.output);assert.deepEqual(readdirSync(f.parent),[]);
});
await test('L04 parent relocation publishes through pinned original; source replacement refuses and preserves unowned leftovers',{timeout:30000},t=>{
  const f=setup(t),r=run(f,{operation:'fsync',index:1,phase:'before',action:'parent-swap'});assert.equal(r.code,0,r.output);
  assert.deepEqual(readdirSync(f.parent),[]);assert.deepEqual(readFileSync(join(f.parent+'.old','final.pdf')),f.data);
  const g=setup(t),bad=run(g,{operation:'fsync',index:1,phase:'before',action:'source-swap'});assert.equal(bad.code,1);assert.equal(existsSync(join(g.parent,'final.pdf')),false);
  const stage=readdirSync(g.parent)[0],names=readdirSync(join(g.parent,stage));assert.equal(names.length,2);
  assert.equal(readFileSync(join(g.parent,stage,names.find(n=>n!=='owned-original')),'utf8'),'FOREIGN');
});

}

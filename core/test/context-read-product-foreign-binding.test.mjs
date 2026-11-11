import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const runner=fileURLToPath(new URL('../testing/context-product-foreign-binding-process.mjs',import.meta.url));
for(const scenario of ['copy-write','copy-no-write','same-write','same-no-write','copy-delete','copy-checkpoint'])
  test('real Worker restart matrix: '+scenario,t=>{
    const child=spawnSync(process.execPath,[runner,root,'run',scenario,'close'],{encoding:'utf8',timeout:60000});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stdout+'\n'+child.stderr);
    const rows=child.stdout.split('\n').filter(Boolean).map(x=>JSON.parse(x));
    const admission=rows.filter(r=>r.kind==='reply'&&r.method==='admitMaintenance');
    // The builder's deadline is setup-sized; the checkpoint case must still stop on its one-item budget.
    if(scenario==='copy-checkpoint'){const builds=rows.filter(r=>r.kind==='build_result');assert.equal(builds.length,1);assert.equal(builds[0].error,undefined);assert.notEqual(builds[0].status,'complete');assert.equal(typeof builds[0].status,'string');}
    assert.ok(admission.length>0);assert.ok(admission.every(r=>r.receipt==='admitted'));
    assert.equal(rows.some(r=>r.kind==='reply'&&r.receipt==='required'),false,'binding repair precedes admitted');
    const result=rows.find(r=>r.kind==='bounded_result');
    assert.equal(result.diagnostic.cadenceMisses,0);assert.deepEqual(result.successes.sort(),['current','history']);
    const expected=scenario==='copy-write'||scenario==='same-write'||scenario==='copy-delete'?3:2;
    assert.deepEqual(rows.find(r=>r.kind==='asserted').finalRows,[{intent:'current',documents:expected},{intent:'history',documents:expected}]);
    t.diagnostic('RESTART_MATRIX '+JSON.stringify({scenario,publications:rows.find(r=>r.kind==='asserted').finalRows,admissions:admission.length,required:rows.filter(r=>r.kind==='reply'&&r.receipt==='required').length,state:result.status.state,error:result.status.error}));
  });
test('real Worker restart matrix: copied publication after SIGTERM builder disposal',t=>{
  const child=spawnSync(process.execPath,[runner,root,'run','copy-write','sigterm'],{encoding:'utf8',timeout:60000});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stdout+'\n'+child.stderr);
  const rows=child.stdout.split('\n').filter(Boolean).map(x=>JSON.parse(x));
  assert.deepEqual(rows.find(r=>r.kind==='builder_exit'),{rev:'regression',mode:'run',kind:'builder_exit',code:null,signal:'SIGTERM'});
  t.diagnostic('RESTART_MATRIX '+JSON.stringify({scenario:'copy-write-sigterm',builderExit:rows.find(r=>r.kind==='builder_exit'),publications:rows.find(r=>r.kind==='asserted').finalRows}));
});
// Builder setup policy: only read_timeout is retried, at most twice, and every retry is visible.
for(const [fault,passes,retries] of [['read_timeout:1',true,1],['read_timeout:2',true,2],['read_timeout:3',false,2],['store_closed:1',false,0]])
  test('builder setup retry policy: '+fault,()=>{
    const child=spawnSync(process.execPath,[runner,root,'run','same-no-write','close'],{encoding:'utf8',timeout:60000,env:{...process.env,CAIRN_TEST_FOREIGN_BINDING_BUILD_FAULT:fault}});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);
    const rows=child.stdout.split('\n').filter(Boolean).map(x=>JSON.parse(x));
    assert.equal(rows.filter(r=>r.kind==='build_retry').length,retries);
    assert.equal(child.status===0,passes,child.stdout+'\n'+child.stderr);
    if(passes){const result=rows.find(r=>r.kind==='bounded_result');assert.equal(result.diagnostic.cadenceMisses,0);assert.deepEqual(result.successes.sort(),['current','history']);}
    else assert.equal(rows.some(r=>r.kind==='builder_exit'),false);
  });

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

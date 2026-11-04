import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
const source=String.raw`
import {DatabaseSync} from 'node:sqlite';
const [root,path,product]=process.argv.slice(1);
const {openReadDatabase}=await import(root+'/core/read-database.mjs');
const {validateContextProductLayout}=await import(root+'/core/context-product-schema.mjs');
const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
let total=0;const counts=new Map();function charge(db,n=1){total+=n;counts.set(db,(counts.get(db)??0)+n);}
DatabaseSync.prototype.exec=function(sql){charge(this,sql.split(';').filter(x=>x.trim()).length);return exec.call(this,sql);};
DatabaseSync.prototype.prepare=function(sql){const db=this,stmt=prepare.call(this,sql);return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);return typeof value!=='function'?value:(...args)=>{if(['get','all','run','iterate'].includes(key))charge(db);return value.apply(target,args);};}});};
const result=openReadDatabase(path,product==='true'?{contextRead:true,validateProduct:validateContextProductLayout}:{});
console.log(JSON.stringify({total,target:counts.get(result.db)??0}));result.db.close();
`;
const root=fileURLToPath(new URL('../../',import.meta.url));
const baseline=new Map([[18,[45,194]],[23,[45,223]],[33,[568,358]]]);
test('S2h-1 read-open budgets equal main 8c698dda on every legacy base and hosted safety cell',async t=>{
  for(const base of [18,23,33]){
    const f=safetyFixture(t,base);
    for(const migrated of [false,true]){
      if(migrated)await f.migrate();
      for(const product of [false,true]){
        const child=spawnSync(process.execPath,['--input-type=module','-e',source,root,f.path,String(product)],{encoding:'utf8',timeout:30000});
        assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
        const counts=JSON.parse(child.stdout),expected=migrated&&base===33&&!product?357:baseline.get(base)[Number(product)];
        assert.equal(counts.total,expected);
        // Legacy v33 validates with a second in-memory schema connection.
        assert.equal(counts.target,!migrated&&base===33&&!product?276:expected);
        t.diagnostic(JSON.stringify({base,physical:migrated?{18:34,23:38,33:48}[base]:base,product,...counts,main:baseline.get(base)[Number(product)]}));
      }
    }
  }
});
test('S2h-1 agreed opener seam attests first and marks productLayout immediately after product validation',()=>{
  const code=readFileSync(new URL('../read-database.mjs',import.meta.url),'utf8');
  assert.match(code,/const validate = \(\) => \{\s*const layout = attestContentSafety\(db\);\s*const version = layout.base;\s*validateProduct\?\.\(db, layout\);\s*nativeObserver\?\.openDiagnostic\?\.mark\('productLayout'\);/);
});

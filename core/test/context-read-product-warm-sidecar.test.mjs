import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fixture,ns,ok } from '../testing/context-read-fixture.mjs';
import { configured,descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar,PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';

const p={readSet:[ns],types:['memory'],intent:'current',ownerCoverage:descriptor([ns])};
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
function child(role,path,mode) {
  const result=spawnSync(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,role,path,...(mode?[mode]:[])],{env:{},encoding:'utf8',timeout:10000,maxBuffer:1024});
  assert.equal(result.status,0,result.stderr);assert.equal(result.error,undefined);
}
test('warm sidecar control: unsupported in-place WAL switch reuses the cached connection',t=>{
  const f=fixture(t);f.admit('warm sidecar control');const facade=openContextProductFacade(f.path,{});
  const options={path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features};
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),writer=productSidecar({...options,writable:true});
  try {let complete=false;for(let i=0;i<100;i++){writer.refresh(p,access,refresh.budget);if(writer.observe(p,access).publication){complete=true;break;}}assert.equal(complete,true);}
  finally {writer.close();}
  const storage=productSidecar(options);t.after(()=>{storage.close();facade.close();});
  assert.equal(storage.observe(p,access).dto.lexical.state,'ready');const path=f.path+PRODUCT_SIDECAR_SUFFIX;
  child('mode',path,'WAL');assert.equal(existsSync(path+'-wal'),false);assert.equal(existsSync(path+'-shm'),false);
  assert.equal(storage.observe(p,access).dto.lexical.state,'ready','passing control: cached sidecar does not repeat the header probe');
  assert.equal(existsSync(path+'-wal'),true);assert.equal(existsSync(path+'-shm'),true);
  const cold=productSidecar(options);
  try {assert.equal(cold.observe(p,access).dto.lexical.reason,'storage_unavailable','passing control: a new connection refuses the companions');}
  finally {cold.close();}
});
test('writable maintenance control: a crashed sidecar writer is recovered by SQLite',async t=>{
  const f=fixture(t);f.admit('sidecar recovery control');const c=configured(t,f.path,[ns],{service:true});
  const builder=await c.open();try {let complete=false;for(let i=0;i<100;i++)if(ok(await builder.refreshContextIndex(refresh,c.token)).status==='complete'){complete=true;break;}assert.equal(complete,true);}
  finally {await builder.close();}
  const path=f.path+PRODUCT_SIDECAR_SUFFIX;child('hot-sidecar',path);assert.equal(existsSync(path+'-journal'),true);
  const h=await c.open();try {
    assert.equal(ok(await h.refreshContextIndex(refresh,c.token)).status,'complete','passing control: explicit writable maintenance retains hot-journal recovery');
    assert.equal(existsSync(path+'-journal'),false);
  } finally {await h.close();}
});

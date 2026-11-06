import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const pins=JSON.parse(readFileSync(new URL('./fixtures/context-product-transaction-counts.json',import.meta.url),'utf8'));
const root=new URL('../../',import.meta.url).pathname;
const stamp='SELECT stamp FROM product_attestation WHERE singleton=1';
const seal='INSERT INTO product_attestation(singleton,stamp,record) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET stamp=excluded.stamp,record=excluded.record';
assert.equal(pins.baseline,'cdd89676');assert.equal(pins.rows.length,72);
for(const physical of [18,23,33,34,38,48,51,52,53])for(const n of [12,24])test(`steady maintenance retains baseline transactions ${physical}/${n}`,()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,['core/testing/content-safety-s2h-path-cost-probe.mjs','maintenance',String(physical),String(n),'0','match','lexical','12'],{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  assert.equal(r.status,0,r.stderr);assert.equal(r.error,undefined);
  const rows=r.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).filter(r=>r.phase==='maintenance');
  assert.equal(rows.length,4);
  for(const row of rows){
    const old=pins.rows.find(p=>p.physical===physical&&p.n===n&&p.variant===row.variant);assert.ok(old);
    const sql=new Map(row.sql.map(([q,n])=>[q.trim().replace(/\s+/g,' '),n]));
    assert.equal(row.begin,old.oldBegin,'no added BEGIN, including warm repeat');
    assert.equal(sql.get('COMMIT'),old.oldCommit,'no added COMMIT');
    assert.equal(sql.get('BEGIN IMMEDIATE')??0,old.oldWriteBegin,'seals share existing write transactions');
    assert.equal(sql.get(stamp)??0,old.oldWriteBegin,'one stamp read per existing logical write');
    assert.equal(sql.get(seal)??0,old.oldWriteBegin,'one seal update per existing logical write');
    assert.ok(row.statements<=old.old+2*old.oldWriteBegin,'increases are limited to stamp/seal pairs');
  }
});

for(const phase of ['first','repeat'])test(`legacy maintenance ceilings retain baseline BEGIN headroom: ${phase}`,()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-unmigrated-counts.json',import.meta.url),'utf8'));
  const rows=fixture.records.filter(r=>{const key=JSON.parse(r.key);return key[2]==='refreshContextIndex'&&key[3].endsWith(phase);});
  assert.equal(rows.length,12);
  for(const row of rows){
    const [,job,,variant]=JSON.parse(row.key),n=Number(job.split('-')[2]);
    assert.equal(row.counts[1],variant.endsWith('repeat')?11:n===12?40:52,'no new BEGIN allowance: '+row.key);
  }
});

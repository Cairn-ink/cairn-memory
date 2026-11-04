import { familyCostParity } from '../testing/receipt-event-time-gates.mjs';
import { assertCostGateCases } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const pins=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-topic-counts.json',import.meta.url),'utf8'));
const probe=fileURLToPath(new URL('../testing/content-safety-s2h-topic-cost-probe.mjs',import.meta.url));
for(const [v,base]of [[34,18],[38,23],[48,33]])test(`R2 public topic v${v}: legacy/optin/member sessions and all cursor pages`,t=>{
 const fixed=new Map(),miss=new Map();
 for(const n of [12,24])for(const absent of [false,true]){
  const records=[];
  for(const [physical,facts]of [[base,0],[v,0],[v,5]]){
   const child=spawnSync(process.execPath,[probe,String(physical),String(n),String(facts),absent?'absent':'match'],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});assert.equal(child.status,0,child.stderr+child.stdout.slice(-5000));
   const rows=child.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).filter(row=>row.tag!=='R3_NATIVE_CELL');
   assert.deepEqual(rows.map(r=>[r.method,r.variant]),[['readTopicOverview','legacy'],...(!absent?[['readTopicOverview','legacy-cursor']]:[]),['readTopicOverview','optin'],...(!absent?[['readTopicOverview','optin-cursor']]:[]),['readTopicMembers','members'],...(!absent?[['readTopicMembers','members-cursor']]:[])]);
   assertCostGateCases('topic-public-'+(absent?'absent':'hit'),rows);
   records.push({physical,facts,rows});
  }
  t.diagnostic('R3_TOPIC_PUBLIC_COUNTS '+JSON.stringify({v,base,n,absent,records}));
  for(const cell of records)for(const row of cell.rows)assert.deepEqual([row.statements,row.begin,row.hostInvocations],pins[JSON.stringify([cell.physical,n,cell.facts,absent,row.method,row.variant])],'exact corrected topic execution pin');
  const [legacy,zero,five]=records;
  for(const current of [zero,five])for(const [i,row]of current.rows.entries()){
   const old=legacy.rows[i],delta=row.statements-old.statements;assert.ok(row.begin<=old.begin,'R2-A1 BEGIN <= same-engine legacy: '+row.variant);assert.equal(row.ports,0);assert.equal(delta,current.facts?6:4,row.variant);
   assert.ok(row.statements<=old.statements+6+row.ports,'R2-A1 same-engine ceiling, e9 11-01 17:15: '+row.variant);
   const key=JSON.stringify([current.facts,row.method,row.variant,absent]);if(fixed.has(key))assert.ok(delta<=fixed.get(key),'R2-A1 slope <= same-engine legacy, e9 11-01 17:15: '+row.variant);fixed.set(key,delta);
   if(absent){const key=JSON.stringify([current.facts,row.method,row.variant]);if(miss.has(key))assert.deepEqual([row.statements,row.begin],miss.get(key),'corpus-independent no-hit');else miss.set(key,[row.statements,row.begin]);}
  }
 }
});


test('R2 product family gate B: topic-public smallest case, exact zero/five-fact parity', async t => {
  await familyCostParity(t, 33, async (f, db, facts) => {

  const physical = db.prepare('PRAGMA user_version').get().user_version;
  return { method: 'readTopicOverview', variant: 'optin',
    measure() {
      const child = spawnSync(process.execPath, [probe, String(physical), '12', String(facts), 'match'], { encoding: 'utf8', timeout: 120000, maxBuffer: 16*1024*1024 });
      assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr + child.stdout.slice(-5000));
      const rows = child.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
        .filter(row => row.tag !== 'R3_NATIVE_CELL' && row.method === 'readTopicOverview' && row.variant === 'optin');
      assert.equal(rows.length, 1, 'one representative public topic case');
      const row = rows[0]; assert.equal(row.node, process.version); assert.equal(row.physical, physical); assert.equal(Number(row.factCount), facts);
      return { ...row, result: { ok: true } };
    }, check(result) { assert.equal(result.ok, true); } };
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {openReadDatabase} from '../read-database.mjs';
import {createRawSearchAuthority} from '../raw-search-authority.mjs';
import {sourceFixture,savedSource} from '../testing/raw-source-fixtures.mjs';
import {searchFixture} from '../testing/raw-search-fixtures.mjs';

async function fixture(t){
  const f=sourceFixture(t);
  for(let i=0;i<65;i++)await savedSource(f,'Synthetic copper telescope.',{sessionId:'synthetic-'+i});
  const s=await searchFixture(f),reader=openReadDatabase(f.path,{contextRead:true});
  t.after(()=>reader.db.close());const authority=createRawSearchAuthority(reader,s.options);
  return {f,authority,rows:authority.inventory(undefined,128).rows.filter(row=>row.source)};
}
function observe(t,{statementMs=0,move}={}){
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100,active,changed=false;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare,units=[];
  DatabaseSync.prototype.exec=function(sql){
    const selected=new Error().stack.includes('at selectUnit');
    const value=exec.call(this,sql);
    if(selected&&sql==='BEGIN')active={start:now,rows:0};
    if(selected&&['COMMIT','ROLLBACK'].includes(sql)&&active){
      if(active.rows)units.push({...active,holdMs:now-active.start});active=undefined;
      if(move&&!changed){changed=true;move();}
    }
    return value;
  };
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(active&&new Error().stack.includes('at checkInside')){
      if(sql.startsWith('SELECT 1 FROM raw_source_maps WHERE'))active.rows++;
      for(const method of ['all','get']){const execute=statement[method];statement[method]=function(...args){
        const result=execute.apply(this,args);now+=statementMs;return result;
      };}
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.exec=exec;DatabaseSync.prototype.prepare=prepare;
    if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  return units;
}
test('selection snapshots check at most 32 rows and preserve per-row classifications',async t=>{
  const {authority,rows}=await fixture(t),units=observe(t);
  const result=authority.select(rows,'current',1100);
  assert.equal(result.eligible.length,65);assert.equal(result.denied,0);
  assert.deepEqual(units.map(unit=>unit.rows),[32,32,1]);
  assert.equal(authority.check(rows[0].source).classification.kind,'current-eligible-bare');
});
test('selection completes a row costing more than 25 milliseconds and moves past it',async t=>{
  const {authority,rows}=await fixture(t),units=observe(t,{statementMs:4});
  const result=authority.select(rows.slice(0,8),'current',1100);
  assert.equal(result.eligible.length,8);assert.equal(result.denied,0);
  assert.equal(result.timedOut,false);assert.equal(units.length,8);
  const rowMs=units[0].holdMs;assert.ok(rowMs>25);
  assert.ok(units.every(unit=>unit.rows===1&&unit.holdMs<=25+rowMs));
  assert.ok(units.reduce((n,unit)=>n+unit.rows,0)>=8);
});
test('a canonical commit inside a selection unit refuses the same rows as individual checks',async t=>{
  const {f,authority,rows}=await fixture(t);
  const units=observe(t,{move:()=>f.db.exec('UPDATE raw_owner_usage SET revision=revision+1')});
  assert.throws(()=>authority.select(rows,'current',1100),{code:'source_changed'});
  assert.equal(units.length,1);
});

test('selection releases a snapshot at the first row boundary past its time slice',async t=>{
  const {authority,rows}=await fixture(t),units=observe(t,{statementMs:.25});
  assert.equal(authority.select(rows.slice(0,32),'current',1100).eligible.length,32);
  assert.ok(units.length>1);const rowMs=units.reduce((sum,u)=>sum+u.holdMs,0)/32;
  assert.ok(units.every(u=>u.holdMs<=25+rowMs));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {sourceFixture,savedSource} from '../testing/raw-source-fixtures.mjs';
import {searchFixture} from '../testing/raw-search-fixtures.mjs';
import {openReadDatabase} from '../read-database.mjs';
import {createRawSearchAuthority} from '../raw-search-authority.mjs';

test('a deadline-torn commitment admits nothing and the next rebuild starts at page zero',async t=>{
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');const s=await searchFixture(f);
  const reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
  const authority=createRawSearchAuthority(reader,s.options),own=Object.getOwnPropertyDescriptor(performance,'now');let now=100,pages=0,armed=true;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(sql.startsWith('SELECT * FROM (')){
      const all=statement.all;statement.all=function(...args){const result=all.apply(this,args);pages++;if(armed&&pages===2){armed=false;now+=1001;}return result;};
    }return statement;
  };
  try{
    assert.throws(()=>authority.fence(undefined,1100),{code:'search_deadline'});assert.equal(pages,2);
    const before=pages,fence=authority.fence(undefined,now+1000);
    assert.ok(pages>before,'no torn commitment can satisfy the next read without rebuilding');
    authority.reset();assert.equal(authority.fence(undefined,now+1000),fence);
  }finally{DatabaseSync.prototype.prepare=prepare;if(own)Object.defineProperty(performance,'now',own);else delete performance.now;}
});

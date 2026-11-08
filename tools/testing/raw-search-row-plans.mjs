// Read-only predicate-plan census over an owned synthetic measurement fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {openReadDatabase} from '../../core/read-database.mjs';
import {createRawSearchAuthority} from '../../core/raw-search-authority.mjs';
import {withContentSuppressionRequest} from '../../core/content-suppression-storage.mjs';
import {rawSearchHost} from '../../core/testing/raw-search-fixtures.mjs';
import {localPlainPort,rawNamespace as ns} from '../../core/testing/raw-fixtures.mjs';

const [fixture,output]=process.argv.slice(2);assert.ok(fixture&&output);
const record=JSON.parse(readFileSync(fixture,'utf8'));
Object.defineProperty(performance,'now',{configurable:true,value:()=>100});
Error.stackTraceLimit=100;
const reader=openReadDatabase(join(record.path,'canonical.sqlite'),{contextRead:true});
try{
  const authority=createRawSearchAuthority(reader,{ownerId:ns.ownerId,readSet:[ns],crypto:localPlainPort(),authority:rawSearchHost().authority});
  const samples=new Map(),population=[];let after;
  while(samples.size<2||population.length<32){
    const inventory=authority.inventory(after,128);
    for(const row of inventory.rows){after=row.key;if(row.source){population.push(row.source);if(!samples.has(row.source.classification.kind))samples.set(row.source.classification.kind,row.source);}}
    if(inventory.complete)break;
  }
  assert.ok(samples.size>=2,'both bare and linked predicates required');
  const native=reader.db.prepare,rows=[];
  for(const [kind,source] of samples)for(const method of ['inspect','check','check32']){
    const statements=[];let prepareCalls=0;
    reader.db.prepare=function(sql){
      const statement=native.call(this,sql),stack=new Error().stack;
      if(!stack.includes('at inspectInside')&&!stack.includes('at checkInside'))return statement;
      prepareCalls++;
      for(const operation of ['get','all','iterate']){
        const execute=statement[operation];statement[operation]=function(...args){
          const plan=native.call(reader.db,'EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail);
          statements.push({sql,operation,header:stack.includes('at installedContentLayout'),plan});
          return execute.apply(this,args);
        };
      }
      return statement;
    };
    try{withContentSuppressionRequest(()=>{if(method==='inspect')authority.inspect(source.ref);else if(method==='check')authority.check(source);else for(const row of population.slice(0,32))authority.check(row,'current',1100);},{fresh:true});}
    finally{reader.db.prepare=native;}
    rows.push({kind,method,checkedRows:method==='check32'?32:1,prepareCalls,statementCount:statements.length,headerPrepares:statements.filter(row=>row.header).length,statements});
  }
  writeFileSync(output,JSON.stringify({turns:record.count,rows},null,2)+'\n');
  console.log(JSON.stringify({turns:record.count,rows:rows.map(({statements,...row})=>row)}));
}finally{reader.db.close();}

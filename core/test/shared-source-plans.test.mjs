import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { installReceiptDelivery } from '../content-safety.mjs';

const root=new URL('../../',import.meta.url),base='88a054fa';
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const normalize=text=>text.replace(/\s+/g,' ').trim();
function inventory(source) {
  const prepared=[],variables=new Map();
  const walk=(node,fn='')=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration')fn=node.id?.name??fn;
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init)
      variables.set(fn+':'+node.id.name,source.slice(node.init.start,node.init.end));
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='prepare'){
      assert.equal(node.arguments.length,1);
      prepared.push({fn,expression:source.slice(node.arguments[0].start,node.arguments[0].end)});
    }
    for(const [key,value]of Object.entries(node))if(!['start','end'].includes(key)){
      if(Array.isArray(value))value.forEach(child=>walk(child,fn));else walk(value,fn);
    }
  };
  walk(parse(source,{ecmaVersion:'latest',sourceType:'module'}));return {prepared,variables};
}
const evaluate=(expression,scope)=>Function(...Object.keys(scope),'return ('+expression+');')(...Object.values(scope));
// Evaluate the production expressions themselves. No SQL is copied into this
// test. Unknown dependencies fail the test, including newly added prepare sites.
function variants(site,variables) {
  const result=new Set();
  for(const enabled of [false,true])for(const stateCount of [1,2,3,4])for(const direction of ['forward','recent','id','both']){
    const scope={where:'owner_id=? AND scope=? AND project_id=?',denySharedSource:enabled,type:enabled?'memory':'card',
      input:{states:Array(stateCount).fill('confirmed')},memoryAncestry:()=>'',
      db:{},hasCardLineage:()=>enabled};
    if(variables.has(site.fn+':lineage'))scope.lineage=evaluate(variables.get(site.fn+':lineage'),scope);
    scope.index=direction==='id'?'capture_memory_receipts':'memory_receipts';
    scope.order=direction==='id'?'candidate.id':direction==='recent'?'candidate.created_at DESC,candidate.id':'candidate.created_at,candidate.id';
    if(variables.has(site.fn+':memorySQL')){
      scope.memorySQL=evaluate(variables.get(site.fn+':memorySQL'),scope);
      scope.recentSQL=direction==='both'?scope.memorySQL.replace('ORDER BY '+scope.order,'ORDER BY candidate.created_at DESC,candidate.id'):'';
    }
    const sql=evaluate(site.expression,scope);assert.equal(typeof sql,'string',site.expression);
    result.add(normalize(sql));
  }
  return [...result];
}

test('every added or changed production prepared text has an indexed plan',async t=>{
  const f=await lineageFixture(t,{base:33});installReceiptDelivery(f.db);
  const b=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic plan seed',kind:'fact'},receipts:[receipt('synthetic-plan-seed')]})).memory;
  const template=f.db.prepare('SELECT * FROM memories WHERE id=?').get(b.id);
  const source=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(b.id);
  const draft=f.draft([ok(f.call('fetchEvidence',{intent:'current',refs:[{type:'memory',namespace:ns,memoryId:b.id,revision:b.revision}]})).items[0].provenance.sources[0]],'synthetic-plan-card');
  const card=f.row(draft.id);
  const insert=(table,row)=>f.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`);
  const memoryInsert=insert('memories',template),receiptInsert=insert('receipts',source),cardInsert=insert('private_cards',card);
  f.db.exec('BEGIN');
  try{
    for(let i=0;i<4096;i++){
      const id='synthetic-plan-memory-'+i;
      memoryInsert.run(...Object.values({...template,id,content:'Synthetic plan row '+i,fingerprint:i.toString(16).padStart(64,'0')}));
      receiptInsert.run(...Object.values({...source,id:'synthetic-plan-receipt-'+i,memory_id:id}));
      if(i<256)cardInsert.run(...Object.values({...card,id:'synthetic-plan-card-'+i}));
    }
    f.db.exec('COMMIT');
  }catch(error){f.db.exec('ROLLBACK');throw error;}
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get(),undefined);
  const files=git(['diff','--name-only',base]).trim().split('\n').filter(file=>file.startsWith('core/')&&file.endsWith('.mjs')&&!/\/(test|testing)\//.test(file));
  const texts=new Map();let sites=0;
  for(const file of files){
    const current=inventory(readFileSync(new URL(file,root),'utf8'));
    const old=inventory(git(['show',base+':'+file]));
    const prior=new Set(old.prepared.map(site=>normalize(site.expression)));
    for(const site of current.prepared)if(!prior.has(normalize(site.expression))){
      sites++;
      for(const sql of variants(site,current.variables)){
        const key=normalize(sql);texts.set(key,[...(texts.get(key)??[]),file+':'+site.fn]);
      }
    }
  }
  assert.ok(sites>0);assert.ok(texts.size>=sites/2);
  for(const [sql,sites]of texts){
    const bindings=Array((sql.match(/\?/g)??[]).length).fill(null);
    const plan=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...bindings);
    for(const {detail}of plan){
      if(/\bSCAN\b/.test(detail))assert.match(detail,/SCAN \w+ VIRTUAL TABLE INDEX/,sites+'\n'+sql+'\n'+detail);
      if(/SEARCH (?:m|memories|r|receipts|c|private_cards) /.test(detail)&&/owner_id=\? AND scope=\? AND project_id=\?\)/.test(detail))
        assert.fail(sites+' uses a namespace-only search: '+detail);
      if(/SEARCH (?:s|si|sa) /.test(detail)&&/suppressed/.test(detail)){
        assert.match(detail,/sqlite_autoindex_suppressed_1/);
        for(const term of ['owner_id=?','scope=?','project_id=?','fingerprint=?'])assert.ok(detail.includes(term),detail);
      }
    }
    if(/FROM suppressed|JOIN suppressed/.test(sql))assert.ok(plan.some(row=>/sqlite_autoindex_suppressed_1/.test(row.detail)),sql);
  }
  t.diagnostic(`Derived ${sites} changed prepare sites and ${texts.size} distinct statement texts from production source.`);
});

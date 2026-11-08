import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import test,{after} from 'node:test';
test.beforeEach(installRawSearchTestClock);
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

const prepare=DatabaseSync.prototype.prepare,plans=new Map();
after(()=>{DatabaseSync.prototype.prepare=prepare;});
DatabaseSync.prototype.prepare=function(sql){
  const statement=prepare.call(this,sql),db=this;
  if(sql.startsWith('SELECT count(*) AS count,json_group_array')||sql.startsWith('SELECT * FROM (')){
    for(const method of ['get','all']){
      const execute=statement[method].bind(statement);
      statement[method]=(...args)=>{
        if(!plans.has(sql))plans.set(sql,prepare.call(db,'EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail));
        return execute(...args);
      };
    }
  }
  return statement;
};
// Reuse the independent small and multi-page fixtures, including tied keys.
await import('./raw-search-pagination.test.mjs');
test('commitment page plans sort only bounded batches and seek source prefixes',t=>{
  DatabaseSync.prototype.prepare=prepare;
  assert.ok(plans.size>=25);
  for(const [sql,details] of plans)t.diagnostic('commitment-page-plan='+JSON.stringify({sql,details}));
  for(const [sql,details] of plans){
    // Identity batches contain at most 32 keys. Schema and header controls
    // and the two capture clients have a fixed size, independent of sources.
    const bounded=sql.includes('json_each(?)')||sql.includes('sqlite_master')||sql.includes('content_safety_control')||sql.includes('local_capture_controls');
    if(!bounded)assert.ok(!details.some(line=>line.includes('USE TEMP B-TREE')),JSON.stringify({sql,details}));
    for(const detail of details.filter(line=>/^SCAN /.test(line))){
      // A first membership page streams at most 32 index entries. Subsequent
      // pages must seek. Filtering bound membership happens after this LIMIT.
      const initialStream=sql.startsWith('SELECT * FROM (')&&sql.includes(') WHERE 1 ORDER BY ')
        &&!/WHERE c\.|WHERE owner_id/.test(sql);
      assert.ok(bounded||initialStream||/^SCAN \(subquery-/.test(detail),JSON.stringify({sql,detail}));
    }
    if(sql.includes('conversation_id=? AND ('))assert.ok(details.some(line=>
      /SEARCH [ap] USING INDEX/.test(line)&&line.includes('conversation_id=?')&&line.includes('message_id')),
      'source pages seek the suffix within their conversation: '+JSON.stringify({sql,details}));
  }
});

test('conversation partitions preserve SQLite binary ordering for Unicode identities',async t=>{
  const {safetySourceFixture,searchFixture}=await import('../testing/raw-search-fixtures.mjs');
  const {savedSource}=await import('../testing/raw-source-fixtures.mjs');
  const {openReadDatabase}=await import('../read-database.mjs');
  const {createRawSearchAuthority}=await import('../raw-search-authority.mjs');
  const f=safetySourceFixture(t);await savedSource(f,'copper retained');const s=await searchFixture(f);
  f.db.exec('BEGIN IMMEDIATE');
  try{
    for(const id of ['\u{10000}-partition','\uE000-partition'])for(const table of ['raw_conversations','raw_messages','raw_parts','raw_source_maps']){
      const row={...f.db.prepare('SELECT * FROM '+table+' LIMIT 1').get()};
      if(table==='raw_conversations'){row.id=id;row.session_key=id;}else row.conversation_id=id;
      const names=Object.keys(row);
      f.db.prepare('INSERT INTO '+table+' ('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...Object.values(row));
    }
  }finally{f.db.exec('COMMIT');}
  const reader=openReadDatabase(f.path,{contextRead:true});f.workspace.defer(()=>reader.db.close());
  const authority=createRawSearchAuthority(reader,s.options),native=reader.db.prepare.bind(reader.db),rows=[];
  reader.db.prepare=sql=>{
    const statement=native(sql);
    if(sql.startsWith('SELECT count(*) AS count,json_group_array')&&sql.includes('SELECT a.* FROM raw_source_maps')){
      const get=statement.get.bind(statement);statement.get=(...args)=>{const page=get(...args);rows.push(...JSON.parse(page.rows));return page;};
    }
    return statement;
  };
  authority.fence();
  const expected=f.db.prepare('SELECT * FROM raw_source_maps ORDER BY conversation_id,message_id,source_key,start,end');
  const columns=expected.columns().map(column=>column.name);
  assert.deepEqual(rows,expected.all().map(row=>columns.map(name=>row[name])));
});

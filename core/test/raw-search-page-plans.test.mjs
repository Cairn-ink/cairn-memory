import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

const prepare=DatabaseSync.prototype.prepare,plans=new Map();
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

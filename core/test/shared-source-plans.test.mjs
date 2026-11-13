import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { openMemoryCore } from '../index.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';

const root=new URL('../../',import.meta.url),base='88a054fa';
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const normalize=text=>text.replace(/\s+/g,' ').trim();
function inventory(source) {
  const prepared=[],sqlLiterals=[],variables=new Map(),functions=new Map();
  const walk=(node,fn='')=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration'){fn=node.id?.name??fn;functions.set(fn,source.slice(node.start,node.end));}
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init)
      variables.set(fn+':'+node.id.name,source.slice(node.init.start,node.init.end));
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='prepare'){
      assert.equal(node.arguments.length,1);
      prepared.push({fn,line:node.loc.start.line,expression:source.slice(node.arguments[0].start,node.arguments[0].end)});
    }
    // An independent SQL-literal census catches changed query builders even
    // when the enclosing prepare(query.sql) call itself remains unchanged.
    const head=node.type==='TemplateLiteral'?node.quasis[0].value.cooked:node.type==='Literal'&&typeof node.value==='string'?node.value:'';
    if(/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|PRAGMA)\b/i.test(head))
      sqlLiterals.push({fn,line:node.loc.start.line,expression:source.slice(node.start,node.end)});
    for(const [key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){
      if(Array.isArray(value))value.forEach(child=>walk(child,fn));else walk(value,fn);
    }
  };
  walk(parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true}));return {prepared,sqlLiterals,variables,functions};
}
const evaluate=(expression,scope)=>Function(...Object.keys(scope),'return ('+expression+');')(...Object.values(scope));
// Only production expressions are evaluated, as strings. A dependency that is
// not covered by the finite variant space fails closed instead of being skipped.
function variants(site,variables) {
  const result=new Set();
  for(const enabled of [false,true])for(const stateCount of [1,2,3,4])for(const direction of ['forward','id'])
  for(const group of ['nextSteps','procedural','background'])for(const after of [undefined,{ordinal:7,id:'synthetic-anchor'}]) {
    const scope={where:'owner_id=? AND scope=? AND project_id=?',denySharedSource:enabled,type:enabled?'memory':'card',
      input:{states:Array(stateCount).fill('confirmed')},direction,group,after,rawAncestry:enabled,
      db:{},hasCardLineage:()=>enabled,cachedContentLayout:()=>({suppressionRevision:enabled?1:0,rawLineage:enabled})};
    const ancestryBuilder=[...variables].find(([name])=>name.endsWith(':memoryAncestry'));
    if(ancestryBuilder)scope.memoryAncestry=evaluate(ancestryBuilder[1],scope);
    // Resolve the engine-owned SQL fragments from their actual initializers.
    for(const name of ['lineage','ancestry','index','order','keyset'])if(variables.has(site.fn+':'+name))
      scope[name]=evaluate(variables.get(site.fn+':'+name),scope);
    const sql=evaluate(site.expression,scope);assert.equal(typeof sql,'string',site.expression);
    result.add(normalize(sql));
  }
  return [...result];
}
function changedStatements() {
  const files=git(['diff','--name-only',base]).trim().split('\n').filter(file=>file.startsWith('core/')&&file.endsWith('.mjs')&&!/\/(test|testing)\//.test(file));
  const texts=new Map();let sites=0,literals=0;
  const add=(site,variables,file)=>{
    sites++;
    for(const sql of variants(site,variables))texts.set(sql,[...(texts.get(sql)??[]),file+':'+site.line]);
  };
  for(const file of files){
    const current=inventory(readFileSync(new URL(file,root),'utf8')),old=inventory(git(['show',base+':'+file]));
    const prior=new Set(old.prepared.map(site=>normalize(site.expression)));
    for(const site of current.prepared)if(!prior.has(normalize(site.expression)))add(site,current.variables,file);
    const previousLiterals=new Set(old.sqlLiterals.map(site=>normalize(site.expression)));
    for(const site of current.sqlLiterals)if(!previousLiterals.has(normalize(site.expression))){
      literals++;add(site,current.variables,file);
    }
  }
  // Follow the changed next-step input through BOTH unchanged proof envelopes.
  // Inventorying its SQL literal alone misses the statements SQLite prepares.
  const projection=inventory(readFileSync(new URL('core/episode-reads.mjs',root),'utf8'));
  const proof=inventory(readFileSync(new URL('core/raw-lineage-storage.mjs',root),'utf8'));
  const proofFunctions=Object.fromEntries(['episodeSourceEvidenceCTE','episodeSourceEvidenceSQL']
    .map(name=>[name,evaluate(proof.functions.get(name),{})]));
  const envelopes=projection.sqlLiterals.filter(site=>site.expression.includes('WITH candidates AS MATERIALIZED (${query.sql})'));
  assert.equal(envelopes.length,2,'header fence and full evidence envelopes');
  const inputs=[...texts].filter(([sql,locations])=>sql.startsWith('SELECT e.* FROM json_each(?) wanted')&&
    locations.some(location=>location.startsWith('core/session-context.mjs:')));
  assert.equal(inputs.length,1,'the final next-step selected-ID input');
  for(const [input,locations]of inputs)for(const site of envelopes)for(const rawLineage of [false,true]){
    const sql=normalize(evaluate(site.expression,{query:{sql:input},layout:{rawLineage},...proofFunctions}));
    texts.set(sql,[...locations,'core/episode-reads.mjs:'+site.line]);
  }
  // The retained base probe is now also part of the prefetch cost contract.
  const cards=inventory(readFileSync(new URL('core/private-card-storage.mjs',root),'utf8'));
  const probes=cards.prepared.filter(site=>site.expression.includes('state=? AND id>? ORDER BY id LIMIT ?'));
  assert.equal(probes.length,2,'token prefetch and physical visibility probes');
  for(const site of probes)add(site,cards.variables,'core/private-card-storage.mjs');
  assert.ok([...texts.keys()].some(sql=>sql.includes('invalid_raw_ancestry')&&sql.includes('FROM memories WHERE owner_id=?')&&sql.includes('AND id = ?')),
    'get includes the populated memoryAncestry variant');
  assert.ok(sites>0);assert.ok(literals>0);
  return {texts,sites,literals};
}
function assertInputBounds(sql,label) {
  assert.doesNotMatch(sql,/FROM private_cards WHERE[^)]*state IN \([^)]*\)[^;]*ORDER BY id/,'unbounded multi-state prefetch: '+label);
}
function assertPlan(db,sql,sites,statistics) {
  assertInputBounds(sql,sites);
  const bindings=Array((sql.match(/\?/g)??[]).length).fill(null);
  const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...bindings),label=statistics+' '+sites+'\n'+sql;
  const composed=sql.startsWith('WITH candidates AS MATERIALIZED (');
  // Multiple lexical scopes may reuse an alias. Retain every physical table
  // it can name so a later alias cannot hide a namespace-sized physical read.
  const aliases=new Map();
  for(const [,table,alias]of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)){
    const name=alias&&!/^(?:WHERE|ON|INDEXED|ORDER|LIMIT|CROSS|LEFT|UNION|GROUP)$/i.test(alias)?alias:table;
    if(!aliases.has(name))aliases.set(name,new Set());aliases.get(name).add(table);
  }
  const virtual=new Set([...sql.matchAll(/\bjson_each\([^)]*\)\s+(\w+)/gi)].map(match=>match[1]));
  // The unchanged envelopes necessarily scan materialized proof intermediates.
  // Permit only these engine-owned derived rows, after pinning their physical
  // input limits below. Physical tables still require indexed SEARCHes.
  const ctes=new Set(composed?[...sql.matchAll(/\b(\w+) AS MATERIALIZED \(/g)].map(match=>match[1]):[]);
  const parent=new Map(plan.map(row=>[row.id,row]));
  const within=(row,name)=>{
    for(let next=parent.get(row.parent),seen=new Set();next&&!seen.has(next.id);next=parent.get(next.parent)){
      seen.add(next.id);if(next.detail==='MATERIALIZE '+name)return true;
    }
    return false;
  };
  if(composed){
    assert.match(sql,/^WITH candidates AS MATERIALIZED \(SELECT e\.\* FROM json_each\(\?\) wanted CROSS JOIN session_episodes e ON e\.id=wanted\.value WHERE e\.owner_id=\? AND e\.scope=\? AND e\.project_id=\?/);
    if(ctes.has('headers'))assert.match(sql,/FROM candidates c CROSS JOIN episode_sources s INDEXED BY episode_source_page ON s\.episode_id=c\.id LEFT JOIN session_episodes o ON o\.id=s\.origin_episode_id LIMIT 817\)/);
    if(ctes.has('proof_memories')){
      assert.match(sql,/proof_memories AS MATERIALIZED \( SELECT m\.id,m\.revision,m\.deleted FROM memories m INDEXED BY namespace_memories WHERE \(m\.owner_id,m\.scope,m\.project_id\)=\(SELECT owner_id,scope,project_id FROM candidates LIMIT 1\) LIMIT 4097\)/);
      assert.match(sql,/proof_receipt_input AS MATERIALIZED \( SELECT r\.rowid receipt_row,m\.id memory_id,m\.revision memory_revision,m\.deleted memory_deleted FROM proof_memories m CROSS JOIN receipts r INDEXED BY memory_receipts ON r\.memory_id=m\.id LIMIT 4097\)/);
    }
  }
  // A final LIMIT above multi-state ranges cannot bound their sorting input.
  const stateProbe=/FROM private_cards WHERE owner_id=\? AND scope=\? AND project_id=\? AND state=\? AND id>\? ORDER BY id LIMIT \?$/.test(sql);
  if(stateProbe){
    assert.equal(plan.some(row=>/TEMP B-TREE|\bSCAN\b/.test(row.detail)),false,label+' must limit an ordered per-state range');
    assert.ok(plan.some(row=>/private_card_scope/.test(row.detail)&&row.detail.includes('state=?')&&row.detail.includes('id>?')),label);
  }
  for(const row of plan){
    const {detail}=row,scan=detail.match(/\bSCAN (\w+)/);
    if(scan){
      const tables=aliases.get(scan[1])??new Set([scan[1]]);
      const derived=ctes.has(scan[1])||[...tables].some(table=>ctes.has(table))||
        scan[1]==='anchor'&&sql.includes('FROM (SELECT 1) anchor');
      assert.ok(virtual.has(scan[1])&&/VIRTUAL TABLE INDEX/.test(detail)||
        composed&&(derived||/SCAN CONSTANT ROW/.test(detail)),label+'\n'+detail);
    }
    const search=detail.match(/\bSEARCH (\w+) /),tables=search&&aliases.get(search[1]);
    if(tables&&[...tables].some(table=>/^(?:memories|receipts|private_cards|card_\w+)$/.test(table))&&
      detail.includes('owner_id=? AND scope=? AND project_id=?')&&!/\b(?:id|rowid)[=<>]/.test(detail)){
      // The existing source proof has an unsorted LIMIT directly on its input.
      assert.ok(composed&&within(row,'proof_memories'),label+' unbounded namespace search: '+detail);
    }
    if(tables?.has('suppressed')){
      assert.match(detail,/USING PRIMARY KEY|sqlite_autoindex_suppressed_1/,label);
      for(const term of ['owner_id=?','scope=?','project_id=?','fingerprint=?'])assert.ok(detail.includes(term),label+'\n'+detail);
    }
  }
  if(/\b(?:FROM|JOIN) suppressed\b/.test(sql))assert.ok(plan.some(row=>/USING PRIMARY KEY|sqlite_autoindex_suppressed_1/.test(row.detail)),label);
}

test('every added or changed production statement has bounded indexed inputs with and without statistics',{timeout:60000},async t=>{
  const model=rationaleModel();
  model.relate=()=>({edges:[{from:0,to:1,relation:'supports-decision',fromReceipt:0,toReceipt:0}]});
  const f=await lineageFixture(t,{base:33,options:{model}}),memories=[];
  // All content and lineage rows come from valid public calls. Both collector
  // arms have substantial joined populations; no template rows are cloned.
  for(let i=0;i<96;i++)memories.push(ok(f.core.admit({namespace:ns,memory:{content:'Synthetic plan claim '+i,kind:'fact'},
    receipts:[receipt('synthetic-plan-'+i)]})).memory);
  for(let i=0;i<32;i++) {
    const memory=memories[i];
    const card=ok(f.call('createCardDraft',{actionId:'synthetic-plan-card-'+i,drafting:'authored',input:{title:'Synthetic plan title',body:'Synthetic plan body',
      memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
    f.confirm(card);
  }
  for(let i=0;i<8;i++)f.confirm(f.draft([f.note('synthetic-plan-note-'+i)],'synthetic-plan-note-card-'+i));
  const anchor=receipt('synthetic-plan-anchor');
  ok(f.core.admit({namespace:ns,memory:{content:'Synthetic plan instruction',kind:'instruction'},receipts:[anchor],
    qualification:{version:1,slot:{subject:'User',property:null,scope:null,applies:null},value:null,attribution:'unknown',commitment:'unknown',
      anchors:[{receiptIndex:0,start:0,end:anchor.excerpt.length,text:anchor.excerpt,fields:['subject']}]},
    procedural:{anchors:[{receiptIndex:0,start:0,end:anchor.excerpt.length}]}}));
  for(let i=0;i<16;i++)ok(await f.core.reviewRationale({namespace:ns,refs:memories.slice(i,i+2).map(memory=>({memoryId:memory.id,revision:memory.revision}))}));
  const episodes=openMemoryCore({path:f.path,...episodeOptions,model:episodeModel({
    extract:({input})=>({items:Array.from({length:8},(_,i)=>({content:'Synthetic plan Episode '+input.messages[0].content+' '+i,kind:'fact',confidence:.8,sourceIndices:[0]}))}),
    interpretEpisode:request=>{const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:request.input.sources[0].text.length}]});
      return {type:field('work'),language:'mixed',gist:field('Synthetic plan gist'),outcome:null,nextStep:field('Synthetic plan next step'),disposition:null};},
  })});
  t.after(()=>episodes.close());
  for(let i=0;i<16;i++)ok(await episodes.capture(episodeInput(1,'synthetic-plan-episode-'+i,{namespace:ns,
    messages:[{id:'synthetic-plan-episode-message-'+i,role:'user',content:'Synthetic plan Episode source '+i,occurredAt:'1901-02-03T04:05:06.789Z'}]})));
  // Populate the ancestry branch through genuine Raw capture on this same
  // layout, then ordinary capture above continues to exercise empty ancestry.
  const raw=openRawCaptureCore({path:f.path,model:rationaleModel()}, {mode:'raw-v1',sources:true,
    port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});
  t.after(()=>raw.close());
  for(let i=0;i<8;i++){
    const result=ok(await raw.captureRaw(request(splitRaw('Synthetic Raw plan support '+i,{id:'synthetic-raw-plan-'+i})[0],
      {namespace:ns,sessionId:'synthetic-raw-plan-session-'+i,eventId:'synthetic-raw-plan-event-'+i})));
    if(result.interpretation.ok!==undefined)ok(result.interpretation);
  }
  const forgotten=memories.at(-1);ok(f.core.forget({namespace:ns,memoryId:forgotten.id,expectedRevision:forgotten.revision}));
  for(const table of ['memories','receipts','private_cards','card_bindings','card_memory_bindings','card_body_sources','qualification_anchors','procedural_tags','suppressed','rationale_edges','session_episodes','episode_sources','episode_memory_links','raw_conversations','raw_messages','raw_receipt_lineage','raw_receipt_origins','raw_source_maps'])
    assert.ok(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n>0,table+' has real public-call rows');
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get(),undefined);
  const {texts,sites,literals}=changedStatements();
  assert.throws(()=>assertInputBounds('SELECT id FROM private_cards WHERE owner_id=? AND scope=? AND project_id=? AND state IN (?,?) AND id>? ORDER BY id LIMIT ?', 'negative control'),
    /unbounded multi-state prefetch/,'an indexed multi-state sort must be refused');
  for(const statistics of ['absent','analyzed']) {
    if(statistics==='analyzed') {f.db.exec('ANALYZE');assert.ok(f.db.prepare('SELECT count(*) n FROM sqlite_stat1').get().n>0);}
    for(const [sql,locations]of texts)assertPlan(f.db,sql,locations,statistics);
  }
  t.diagnostic(`Derived ${sites} prepare/literal sites (${literals} independent changed SQL literals) and ${texts.size} distinct texts; each pinned twice.`);
});

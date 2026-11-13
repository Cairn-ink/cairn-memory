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

const root=new URL('../../',import.meta.url),base='88a054fa';
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const normalize=text=>text.replace(/\s+/g,' ').trim();
function inventory(source) {
  const prepared=[],sqlLiterals=[],variables=new Map();
  const walk=(node,fn='')=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration')fn=node.id?.name??fn;
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
  walk(parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true}));return {prepared,sqlLiterals,variables};
}
const evaluate=(expression,scope)=>Function(...Object.keys(scope),'return ('+expression+');')(...Object.values(scope));
// Only production expressions are evaluated, as strings. A dependency that is
// not covered by the finite variant space fails closed instead of being skipped.
function variants(site,variables) {
  const result=new Set();
  for(const enabled of [false,true])for(const stateCount of [1,2,3,4])for(const direction of ['forward','id'])
  for(const group of ['nextSteps','procedural','background'])for(const after of [undefined,{ordinal:7,id:'synthetic-anchor'}]) {
    const scope={where:'owner_id=? AND scope=? AND project_id=?',denySharedSource:enabled,type:enabled?'memory':'card',
      input:{states:Array(stateCount).fill('confirmed')},memoryAncestry:()=>'',direction,group,after,rawAncestry:enabled,
      db:{},hasCardLineage:()=>enabled};
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
  assert.ok(sites>0);assert.ok(literals>0);
  return {texts,sites,literals};
}
function assertPlan(db,sql,sites,statistics) {
  const bindings=Array((sql.match(/\?/g)??[]).length).fill(null);
  const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...bindings),label=statistics+' '+sites+'\n'+sql;
  // Map aliases back to physical tables; checking only familiar aliases would
  // let a renamed Card/receipt/Memory alias silently escape this assertion.
  const aliases=new Map([...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)]
    .map(([,table,alias])=>[alias&&!/^(?:WHERE|ON|INDEXED|ORDER|LIMIT|CROSS|LEFT|UNION)$/i.test(alias)?alias:table,table]));
  const virtual=new Set([...sql.matchAll(/\bjson_each\([^)]*\)\s+(\w+)/gi)].map(match=>match[1]));
  for(const {detail}of plan){
    const scan=detail.match(/\bSCAN (\w+)/);
    if(scan)assert.ok(virtual.has(scan[1])&&/VIRTUAL TABLE INDEX/.test(detail),label+'\n'+detail);
    const search=detail.match(/\bSEARCH (\w+) /),table=search&&aliases.get(search[1]);
    if(table&&/^(?:memories|receipts|private_cards|card_\w+)$/.test(table)&&
      /\(owner_id=\? AND scope=\? AND project_id=\?\)/.test(detail))assert.fail(label+' namespace-only search: '+detail);
    if(table==='suppressed') {
      assert.match(detail,/USING PRIMARY KEY|sqlite_autoindex_suppressed_1/,label);
      for(const term of ['owner_id=?','scope=?','project_id=?','fingerprint=?'])assert.ok(detail.includes(term),label+'\n'+detail);
    }
  }
  if(/\b(?:FROM|JOIN) suppressed\b/.test(sql))assert.ok(plan.some(row=>/USING PRIMARY KEY|sqlite_autoindex_suppressed_1/.test(row.detail)),label);
}

test('every added or changed production statement has an indexed plan with and without statistics',async t=>{
  const model=rationaleModel();
  model.relate=()=>({edges:[{from:0,to:1,relation:'supports-decision',fromReceipt:0,toReceipt:0}]});
  const f=await lineageFixture(t,{base:33,options:{model}}),memories=[];
  // All content and lineage rows come from valid public calls. Both collector
  // arms have substantial joined populations; no template rows are cloned.
  for(let i=0;i<256;i++)memories.push(ok(f.core.admit({namespace:ns,memory:{content:'Synthetic plan claim '+i,kind:'fact'},
    receipts:[receipt('synthetic-plan-'+i)]})).memory);
  for(let i=0;i<128;i++) {
    const memory=memories[i];
    const card=ok(f.call('createCardDraft',{actionId:'synthetic-plan-card-'+i,drafting:'authored',input:{title:'Synthetic plan title',body:'Synthetic plan body',
      memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
    f.confirm(card);
  }
  for(let i=0;i<32;i++)f.confirm(f.draft([f.note('synthetic-plan-note-'+i)],'synthetic-plan-note-card-'+i));
  const anchor=receipt('synthetic-plan-anchor');
  ok(f.core.admit({namespace:ns,memory:{content:'Synthetic plan instruction',kind:'instruction'},receipts:[anchor],
    qualification:{version:1,slot:{subject:'User',property:null,scope:null,applies:null},value:null,attribution:'unknown',commitment:'unknown',
      anchors:[{receiptIndex:0,start:0,end:anchor.excerpt.length,text:anchor.excerpt,fields:['subject']}]},
    procedural:{anchors:[{receiptIndex:0,start:0,end:anchor.excerpt.length}]}}));
  for(let i=0;i<255;i++)ok(await f.core.reviewRationale({namespace:ns,refs:memories.slice(i,i+2).map(memory=>({memoryId:memory.id,revision:memory.revision}))}));
  const episodes=openMemoryCore({path:f.path,...episodeOptions,model:episodeModel({
    extract:({input})=>({items:Array.from({length:8},(_,i)=>({content:'Synthetic plan Episode '+input.messages[0].content+' '+i,kind:'fact',confidence:.8,sourceIndices:[0]}))}),
    interpretEpisode:request=>{const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:request.input.sources[0].text.length}]});
      return {type:field('work'),language:'mixed',gist:field('Synthetic plan gist'),outcome:null,nextStep:field('Synthetic plan next step'),disposition:null};},
  })});
  t.after(()=>episodes.close());
  for(let i=0;i<32;i++)ok(await episodes.capture(episodeInput(1,'synthetic-plan-episode-'+i,{namespace:ns,
    messages:[{id:'synthetic-plan-episode-message-'+i,role:'user',content:'Synthetic plan Episode source '+i,occurredAt:'1901-02-03T04:05:06.789Z'}]})));
  const forgotten=memories.at(-1);ok(f.core.forget({namespace:ns,memoryId:forgotten.id,expectedRevision:forgotten.revision}));
  for(const table of ['memories','receipts','private_cards','card_bindings','card_memory_bindings','card_body_sources','qualification_anchors','procedural_tags','suppressed','rationale_edges','session_episodes','episode_sources','episode_memory_links'])
    assert.ok(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n>0,table+' has real public-call rows');
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get(),undefined);
  const {texts,sites,literals}=changedStatements();
  for(const statistics of ['absent','analyzed']) {
    if(statistics==='analyzed') {f.db.exec('ANALYZE');assert.ok(f.db.prepare('SELECT count(*) n FROM sqlite_stat1').get().n>0);}
    for(const [sql,locations]of texts)assertPlan(f.db,sql,locations,statistics);
  }
  t.diagnostic(`Derived ${sites} prepare/literal sites (${literals} independent changed SQL literals) and ${texts.size} distinct texts; each pinned twice.`);
});

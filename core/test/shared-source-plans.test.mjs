import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { openMemoryCore } from '../index.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';

const root=new URL('../../',import.meta.url);
// The modules in this fix are explicit data. Empty function lists identify
// modules whose changes do not own a prepared-statement cost contract.
// In dispatchers, bindings name the complete owned SQL regions; unrelated
// operations and their pre-existing queries are outside this catalog.
const modules=[
  {file:'adapters/openai/index.mjs',functions:[]},
  {file:'adapters/openai/schemas.mjs',functions:[]},
  {file:'core/content-safety.mjs',functions:[
    {name:'receiptDenialsInside'},{name:'cardReceiptTokens'},{name:'anchorsDeliverable'},
    {name:'receiptCoordinateCache'},{name:'receiptStoredCountInside'},
    {name:'receiptDeliverySnapshot'},{name:'deliveryReceiptRows'},
  ]},
  {file:'core/content-suppression-storage.mjs',functions:[{name:'suppressReceiptsInside'}]},
  {file:'core/content-write-safety.mjs',functions:[]},
  {file:'core/context-product-index.mjs',functions:[{name:'assemble'}]},
  {file:'core/context-product-sidecar.mjs',functions:[]},
  {file:'core/context-read-facade.mjs',functions:[{name:'contextRead'}]},
  {file:'core/context-read-sidecar.mjs',functions:[]},
  {file:'core/contract.mjs',functions:[]},
  {file:'core/database.mjs',functions:[]},
  {file:'core/episode-reads.mjs',functions:[{name:'episodeReadRowsInside'}],
    builders:[{name:'begin',kind:'envelopes'}]},
  {file:'core/episode-storage.mjs',functions:[{name:'inspect',bindings:['linkRows','linkedReceipts']}]},
  {file:'core/moc-storage.mjs',functions:[]},
  {file:'core/private-card-storage.mjs',functions:[{name:'cardSourceDeliverable'},
    {name:'read',bindings:['candidateProbe','probe']}]},
  {file:'core/private-evidence-storage.mjs',functions:[{name:'select',bindings:['scanRefs']}]},
  {file:'core/rationale-storage.mjs',functions:[]},
  {file:'core/raw-source-roots.mjs',functions:[]},
  {file:'core/recall.mjs',functions:[]},
  {file:'core/role-context-evidence.mjs',functions:[{name:'item'}]},
  {file:'core/role-context-facade.mjs',functions:[]},
  {file:'core/runtime.mjs',functions:[{name:'getPage'},{name:'usageSnapshot'},
    {name:'storedSourceEvidence'},{name:'projectRationale'}]},
  {file:'core/session-context.mjs',functions:[],builders:[
    {name:'contextQuery',kind:'nextSteps'},
    {name:'nextStepPage',kind:'selectedInput'},
  ]},
  {file:'core/source-evidence.mjs',functions:[]},
];
const proofBuilders={file:'core/raw-lineage-storage.mjs',functions:['episodeSourceEvidenceCTE','episodeSourceEvidenceSQL']};
const normalize=text=>text.replace(/\s+/g,' ').trim();
function inventory(source) {
  const prepared=[],sqlLiterals=[],variables=new Map(),functions=new Map();
  const walk=(node,fn='',binding='')=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'&&node.id){
      fn=node.id?.name??fn;binding='';assert.ok(!functions.has(fn),'unique function '+fn);
      functions.set(fn,source.slice(node.start,node.end));
    }
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init){
      binding=node.id.name;variables.set(fn+':'+binding,source.slice(node.init.start,node.init.end));
    }
    if(node.type==='Property'&&node.key.name==='query'&&node.value.type==='ObjectExpression'){
      const sql=node.value.properties.find(property=>property.key.name==='sql');
      if(sql)variables.set(fn+':query.sql',source.slice(sql.value.start,sql.value.end));
    }
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='prepare'){
      assert.equal(node.arguments.length,1);
      prepared.push({fn,binding,line:node.loc.start.line,expression:source.slice(node.arguments[0].start,node.arguments[0].end)});
    }
    // Keep a separate literal census: missing and orphan catalog texts must
    // fail even when a prepare call delegates to an unchanged SQL builder.
    const head=node.type==='TemplateLiteral'?node.quasis[0].value.cooked:node.type==='Literal'&&typeof node.value==='string'?node.value:'';
    if(/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|PRAGMA)\b/i.test(head))
      sqlLiterals.push({fn,binding,line:node.loc.start.line,expression:source.slice(node.start,node.end)});
    for(const [key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){
      if(Array.isArray(value))value.forEach(child=>walk(child,fn,binding));else walk(value,fn,binding);
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
function statementCatalog() {
  const sources=new Map(modules.map(({file})=>[file,inventory(readFileSync(new URL(file,root),'utf8'))]));
  const texts=new Map(),producible=new Set();let sites=0,literals=0;
  const add=(sql,file,site)=>{
    sql=normalize(sql);
    texts.set(sql,[...(texts.get(sql)??[]),`${file}:${site.line} (${site.fn})`]);
  };
  const owned=(site,owner)=>site.fn===owner.name&&(!owner.bindings||owner.bindings.includes(site.binding));
  for(const {file,functions}of modules){
    const current=sources.get(file);
    for(const owner of functions){
      assert.ok(current.functions.has(owner.name),file+' owns '+owner.name);
      const prepared=current.prepared.filter(site=>owned(site,owner));
      const sqlLiterals=current.sqlLiterals.filter(site=>owned(site,owner));
      assert.ok(prepared.length,file+' '+owner.name+' prepares statements');
      for(const binding of owner.bindings??[])assert.ok(prepared.some(site=>site.binding===binding),file+' '+owner.name+'.'+binding);
      for(const site of prepared){
        sites++;
        for(const sql of variants(site,current.variables))add(sql,file,site);
      }
      for(const site of sqlLiterals){
        literals++;
        for(const sql of variants(site,current.variables))producible.add(sql);
      }
    }
  }
  // The next-step builder prepares both cursor shapes. Evaluate the whole
  // current builder, so its final query (rather than a SQL fragment) is pinned.
  const sessionFile='core/session-context.mjs',session=sources.get(sessionFile);
  const projectionFile='core/episode-reads.mjs',projection=sources.get(projectionFile);
  const proof=inventory(readFileSync(new URL(proofBuilders.file,root),'utf8'));
  const proofFunctions=Object.fromEntries(proofBuilders.functions.map(name=>{
    assert.ok(proof.functions.has(name),proofBuilders.file+' owns '+name);
    return [name,evaluate(proof.functions.get(name),{})];
  }));
  let selectedInput;
  for(const {file,builders=[]}of modules)for(const builder of builders){
    const current=sources.get(file);
    assert.ok(current.functions.has(builder.name),file+' owns builder '+builder.name);
    if(builder.kind==='nextSteps'){
      const build=evaluate(current.functions.get(builder.name),{});
      const candidates=current.sqlLiterals.filter(site=>site.fn===builder.name&&site.expression.includes('episode_open_step_read'));
      assert.equal(candidates.length,1,'next-step range input');
      for(const after of [undefined,{ordinal:7,id:'synthetic-anchor'}])
        add(build({ownerId:'synthetic',scope:'owner',projectId:''},'nextSteps',{after}).sql,file,candidates[0]);
      // Independent source-literal expansion must yield the same full texts.
      for(const sql of variants(candidates[0],current.variables))producible.add(sql);
      sites++;literals++;
    }else if(builder.kind==='selectedInput'){
      const inputs=current.sqlLiterals.filter(site=>site.fn===builder.name);
      assert.equal(inputs.length,1,'the final next-step selected-ID input');
      [selectedInput]=inputs;
      for(const sql of variants(selectedInput,current.variables)){add(sql,file,selectedInput);producible.add(sql);}
      sites++;literals++;
    }else assert.equal(builder.kind,'envelopes','known builder kind');
  }
  assert.ok(selectedInput,'selected-ID input has a named owner');
  // Follow that selected input through BOTH production proof envelopes.
  // The first is prepared here; the second is returned to the session reader.
  const envelopeOwner=modules.find(({file})=>file===projectionFile).builders.find(builder=>builder.kind==='envelopes').name;
  const envelopes=projection.sqlLiterals.filter(site=>site.fn===envelopeOwner);
  assert.equal(envelopes.length,2,'header fence and full evidence envelopes');
  assert.equal(projection.prepared.filter(site=>site.fn===envelopeOwner).length,1,'header fence preparation');
  const fence=projection.prepared.find(site=>site.fn===envelopeOwner);
  for(const input of variants(selectedInput,session.variables))for(const rawLineage of [false,true]){
    const scope={query:{sql:input},layout:{rawLineage},...proofFunctions};
    add(evaluate(fence.expression,scope),projectionFile,fence);
    // Read the returned query from its actual object-property initializer.
    const returned=projection.variables.get(envelopeOwner+':query.sql');
    assert.ok(returned,'full evidence query has an initializer');
    add(evaluate(returned,scope),projectionFile,envelopes.find(site=>site.expression===returned));
    for(const site of envelopes)producible.add(normalize(evaluate(site.expression,scope)));
  }
  sites+=2;literals+=envelopes.length;
  assert.deepEqual([...texts.keys()].sort(),[...producible].sort(),
    'catalog equals every producible owned statement text: no missing or orphan texts');
  assert.ok([...texts.keys()].some(sql=>sql.includes('invalid_raw_ancestry')&&sql.includes('FROM memories WHERE owner_id=?')&&sql.includes('AND id = ?')),
    'get includes the populated memoryAncestry variant');
  const probes=[...texts.keys()].filter(sql=>/FROM private_cards WHERE .*state=\? AND id>\? ORDER BY id LIMIT \?$/.test(sql));
  assert.equal(probes.length,2,'token prefetch and physical visibility probes');
  const anchorCollectors=[...texts.keys()].filter(sql=>sql.includes('CROSS JOIN qualification_anchors q'));
  assert.equal(anchorCollectors.length,1,'the batched collector is in the complete source catalog');
  assert.match(anchorCollectors[0],/FROM json_each\(\?\) j CROSS JOIN qualification_anchors q ON q\.memory_id=json_extract\(j\.value,'\$\.id'\)/);
  assert.match(anchorCollectors[0],/UNION SELECT j\.value AS input,p\.memory_id,.*FROM json_each\(\?\) j CROSS JOIN procedural_tags p ON p\.memory_id=json_extract\(j\.value,'\$\.id'\)/);
  assert.doesNotMatch(anchorCollectors[0],/excerpt|r\.\*/,'anchor collection projects tokens only');
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
  const candidateAncestry=sql.includes('WITH RECURSIVE ancestors(id) AS (');
  // Multiple lexical scopes may reuse an alias. Retain every physical table
  // it can name so a later alias cannot hide a namespace-sized physical read.
  const aliases=new Map();
  for(const [,table,alias]of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)){
    const name=alias&&!/^(?:WHERE|ON|INDEXED|ORDER|LIMIT|CROSS|LEFT|UNION|GROUP)$/i.test(alias)?alias:table;
    if(!aliases.has(name))aliases.set(name,new Set());aliases.get(name).add(table);
  }
  // An unaliased json_each appears in the plan under its own name.
  const virtual=new Set(['json_each',...[...sql.matchAll(/\bjson_each\([^)]*\)\s+(\w+)/gi)].map(match=>match[1])
    .filter(name=>!/^(?:CROSS|JOIN|WHERE|ON|ORDER|GROUP|LIMIT|UNION|LEFT|INNER)$/i.test(name))]);
  // The unchanged envelopes necessarily scan materialized proof intermediates.
  // Permit only these engine-owned derived rows, after pinning their physical
  // input limits below. Physical tables still require indexed SEARCHes.
  const ctes=new Set(composed?[...sql.matchAll(/\b(\w+) AS MATERIALIZED \(/g)].map(match=>match[1]):[]);
  const parent=new Map(plan.map(row=>[row.id,row]));
  // Bounded beyond the namespace: the search also fixes an id column (or ranges over one), or fixes
  // another key column by equality. Low-cardinality columns alone (a state, a kind) do not bound it.
  const lowCardinality=new Set(['state','deleted','kind','role','source_kind','review_state','currentness','scope']);
  const boundedBeyondNamespace=detail=>[...detail.matchAll(/\b(\w+)\s*([=<>])/g)].some(([,column,operator])=>
    !['owner_id','scope','project_id'].includes(column)&&
    (/(?:^|_)(?:id|rowid)$/.test(column)||operator==='='&&!lowCardinality.has(column)));
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
  if(candidateAncestry){
    assert.match(sql,/AND NOT EXISTS \( WITH RECURSIVE ancestors\(id\) AS \( SELECT e\.id UNION SELECT s\.origin_episode_id FROM ancestors a CROSS JOIN episode_sources s INDEXED BY episode_source_page ON s\.episode_id=a\.id \) SELECT 1 FROM ancestors a CROSS JOIN episode_memory_links l ON l\.episode_id=a\.id CROSS JOIN memories m ON m\.id=l\.memory_id WHERE m\.deleted=0 AND m\.review_state='awaiting' LIMIT 1\) ORDER BY .* LIMIT \?$/,
      label+' hidden eligibility is correlated and precedes the page limit');
    assert.doesNotMatch(sql,/review_hidden_episodes/,label+' must not enumerate the global hidden view');
    assert.ok(plan.some(row=>/CORRELATED SCALAR SUBQUERY/.test(row.detail)),label+' candidate correlation');
    for(const [alias,key]of [['s','episode_id'],['l','episode_id'],['m','id']])
      assert.ok(plan.some(row=>row.detail.startsWith('SEARCH '+alias+' ')&&row.detail.includes(key+'=?')),
        label+' ancestry reaches '+alias+' by '+key);
    assert.ok(plan.some(row=>/episode_open_step_read/.test(row.detail)),label+' ordered candidate range');
    assert.ok(!plan.some(row=>/TEMP B-TREE/.test(row.detail)),label+' no namespace-sized sorting input');
  }
  if(sql.includes('CROSS JOIN qualification_anchors q')){
    for(const alias of ['q','p'])assert.ok(plan.some(row=>row.detail.startsWith('SEARCH '+alias+' ')&&
      row.detail.includes('memory_id=?')),label+' anchors must be reached by memory_id: '+alias);
    // A receipt or Memory is reached by its unique id: directly, or through an index whose
    // equality prefix ends in id (memory_id,id or the namespace keyset). One row either way.
    for(const alias of ['r','m'])assert.equal(plan.filter(row=>row.detail.startsWith('SEARCH '+alias+' ')&&
      /\((?:[a-z_]+=\? AND )*id=\?\)$/.test(row.detail)).length,2,label+' both anchor arms reach '+alias+' by id: '+plan.map(row=>row.detail).join(' ; '));
  }
  for(const row of plan){
    const {detail}=row,scan=detail.match(/\bSCAN (\w+)/);
    if(scan){
      const tables=aliases.get(scan[1])??new Set([scan[1]]);
      const derived=ctes.has(scan[1])||[...tables].some(table=>ctes.has(table))||
        scan[1]==='anchor'&&sql.includes('FROM (SELECT 1) anchor');
      assert.ok(virtual.has(scan[1])&&/VIRTUAL TABLE INDEX/.test(detail)||
        candidateAncestry&&([...tables].every(table=>table==='ancestors')||detail==='SCAN CONSTANT ROW')||
        composed&&(derived||/SCAN CONSTANT ROW/.test(detail)),label+'\n'+detail);
    }
    const search=detail.match(/\bSEARCH (\w+) /),tables=search&&aliases.get(search[1]);
    if(tables&&[...tables].some(table=>/^(?:memories|receipts|private_cards|card_\w+)$/.test(table))&&
      detail.includes('owner_id=? AND scope=? AND project_id=?')&&!boundedBeyondNamespace(detail)){
      // A search that also fixes an id column (id, card_id, memory_id, receipt_id) is bounded by that id;
      // only the namespace columns alone are not. The existing source proof has an unsorted LIMIT directly on its input.
      assert.ok(composed&&within(row,'proof_memories'),label+' unbounded namespace search: '+detail);
    }
    if(tables?.has('suppressed')){
      assert.match(detail,/USING PRIMARY KEY|sqlite_autoindex_suppressed_1/,label);
      for(const term of ['owner_id=?','scope=?','project_id=?','fingerprint=?'])assert.ok(detail.includes(term),label+'\n'+detail);
    }
  }
  if(/\b(?:FROM|JOIN) suppressed\b/.test(sql))assert.ok(plan.some(row=>/USING PRIMARY KEY|sqlite_autoindex_suppressed_1/.test(row.detail)),label);
}

test('every owned production statement has bounded indexed inputs with and without statistics',{timeout:60000},async t=>{
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
    extract:({input})=>({items:Array.from({length:5},(_,i)=>({content:'Synthetic plan Episode '+input.messages[0].content+' '+i,kind:'fact',confidence:.8,sourceIndices:[0]}))}),
    interpretEpisode:request=>{const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:request.input.sources[0].text.length}]});
      return {type:field('work'),language:'mixed',gist:field('Synthetic plan gist'),outcome:null,nextStep:field('Synthetic plan next step'),disposition:null};},
  })});
  t.after(()=>episodes.close());
  for(let i=0;i<16;i++)ok(await episodes.capture(episodeInput(1,'synthetic-plan-episode-'+i,{namespace:ns,
    messages:[{id:'synthetic-plan-episode-message-'+i,role:'user',content:'Synthetic plan Episode source '+i,occurredAt:'1901-02-03T04:05:06.789Z'}]})));
  // Populate the ancestry branch through genuine Raw capture on this same
  // layout, then ordinary capture above continues to exercise empty ancestry.
  const raw=openRawCaptureCore({path:f.path,model:rationaleModel(),privateCards:f.host.options}, {mode:'raw-v1',sources:true,
    port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});
  t.after(()=>raw.close());
  for(let i=0;i<8;i++){
    const result=ok(await raw.captureRaw(request(splitRaw('Synthetic Raw plan support '+i,{id:'synthetic-raw-plan-'+i})[0],
      {namespace:ns,sessionId:'synthetic-raw-plan-session-'+i,eventId:'synthetic-raw-plan-event-'+i})));
    ok(result.interpretation);
  }
  const forgotten=memories.at(-1);ok(f.core.forget({namespace:ns,memoryId:forgotten.id,expectedRevision:forgotten.revision}));
  for(const table of ['memories','receipts','private_cards','card_bindings','card_memory_bindings','card_body_sources','qualification_anchors','procedural_tags','suppressed','rationale_edges','session_episodes','episode_sources','episode_memory_links','raw_conversations','raw_messages','raw_receipt_lineage','raw_receipt_origins','raw_source_maps'])
    assert.ok(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n>0,table+' has real public-call rows');
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get(),undefined);
  const {texts,sites,literals}=statementCatalog();
  assert.throws(()=>assertInputBounds('SELECT id FROM private_cards WHERE owner_id=? AND scope=? AND project_id=? AND state IN (?,?) AND id>? ORDER BY id LIMIT ?', 'negative control'),
    /unbounded multi-state prefetch/,'an indexed multi-state sort must be refused');
  const violations=[],headerPlans={};
  for(const statistics of ['absent','analyzed']) {
    if(statistics==='analyzed') {
      f.db.exec('ANALYZE');assert.ok(f.db.prepare('SELECT count(*) n FROM sqlite_stat1').get().n>0);
      // Statistics of this small store would make the planner prefer scans of one-row tables. A host that
      // analyzes does so on a large store, so scale the row counts: every prefix shared by all rows grows
      // with the table, and a unique index keeps one row per full key.
      const unique=new Set();
      for(const {tbl} of f.db.prepare('SELECT DISTINCT tbl FROM sqlite_stat1').all())
        for(const index of f.db.prepare(`PRAGMA index_list("${tbl.replaceAll('"','""')}")`).all())if(index.unique)unique.add(tbl+'\0'+index.name);
      for(const row of f.db.prepare('SELECT rowid,tbl,idx,stat FROM sqlite_stat1').all()){
        const counts=row.stat.split(' ').map(Number),total=counts[0];
        const scaled=counts.map((count,position)=>position===counts.length-1&&position>0&&unique.has(row.tbl+'\0'+row.idx)?1:
          position===0||count===total?count*20000:count);
        f.db.prepare('UPDATE sqlite_stat1 SET stat=? WHERE rowid=?').run(scaled.join(' '),row.rowid);
      }
      f.db.exec('ANALYZE sqlite_schema');
    }
    // Collect every violation so that one run reports the complete picture.
    for(const [sql]of texts)if(/^SELECT id,revision,currentness,review_state FROM memories WHERE .* AND \+deleted=0 AND id>\? ORDER BY id LIMIT \?$/.test(sql))
      headerPlans[statistics]=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...Array((sql.match(/\?/g)??[]).length).fill(null)).map(row=>row.detail);
    for(const [sql,locations]of texts)try{assertPlan(f.db,sql,locations,statistics);}catch(error){
      const lines=String(error.message).split('\n');
      violations.push([lines[0],...lines.slice(1).filter(line=>!/^\s*(?:SELECT|INSERT|WITH|FROM|WHERE|CROSS|UNION|AND)\b/i.test(line)).map(line=>line.trim().slice(-260))].join(' | ').slice(0,900));
    }
  }
  assert.deepEqual(violations,[]);
  // The Memory scan-header read of evidence selection must stay on the id keyset in both passes: with
  // large-store statistics the planner would otherwise prefer the (namespace, deleted) index and sort.
  assert.deepEqual(Object.keys(headerPlans).sort(),['absent','analyzed']);
  for(const [statistics,details] of Object.entries(headerPlans)){
    assert.ok(details.some(detail=>/index_memory_keyset/.test(detail)&&detail.includes('id>?')),statistics+': '+details.join(' | '));
    assert.ok(!details.some(detail=>/TEMP B-TREE|namespace_memories/.test(detail)),statistics+': '+details.join(' | '));
  }
  t.diagnostic(`Derived ${sites} prepare/literal sites (${literals} independent source SQL literals) and ${texts.size} distinct texts; each pinned twice.`);
});

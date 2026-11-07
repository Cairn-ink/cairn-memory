// Independent engines receive identical identities, clocks, providers and input.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let sequence=0,sqlSequence=0,tracing=false;const clockTrace=[];
crypto.randomUUID=()=>{if(tracing)clockTrace.push(['uuid']);return '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');};
crypto.randomBytes=size=>{if(tracing)clockTrace.push(['randomBytes',size]);return Buffer.alloc(size,7);};syncBuiltinESMExports();
const RealDate=Date,clock=Date.parse('2026-01-02T00:00:00.000Z');
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]));if(tracing)clockTrace.push(['Date',args]);}static now(){if(tracing)clockTrace.push(['Date.now']);return clock;}};
Object.defineProperty(performance,'now',{configurable:true,value:()=>{if(tracing)clockTrace.push(['performance.now']);return 0;}});
const [root,scratch,report,selection,population,contextMode,guard]=process.argv.slice(2);
Error.stackTraceLimit=50;
const rawCaller=()=>/[/\\]core[/\\]raw-search-[^/\\\n]*\.mjs/.test(new Error().stack);
const rawWork={statements:[],timers:[]},timerHandles=[];
for(const method of ['setTimeout','setInterval']){const schedule=globalThis[method];globalThis[method]=(...args)=>{
  const raw=rawCaller();if(raw)rawWork.timers.push(method);const handle=schedule(...args);if(raw)timerHandles.push(handle);return handle;
};}
const residency=[];
mkdirSync(scratch,{recursive:true,mode:0o700});
const load=file=>import(pathToFileURL(join(root,file)).href);
const ns={ownerId:'synthetic-owner',scope:'personal',projectId:null},path=join(scratch,'canonical.sqlite');
const trace=[],ports=[],results=[],timeline=[];
for(const [kind,array] of [['sql',trace],['port',ports],['clock',clockTrace]]){
  const push=array.push.bind(array);array.push=(...items)=>{for(const item of items)timeline.push([kind,item]);return push(...items);};
}
const encode=value=>value instanceof Uint8Array?{bytes:Buffer.from(value).toString('hex')}:
  typeof value==='bigint'?String(value):Array.isArray(value)?value.map(encode):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)])):value;
const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare;
DatabaseSync.prototype.exec=function(sql){if(rawCaller())rawWork.statements.push(['exec',sql]);if(tracing)trace.push(['exec',sql,[]]);return exec.call(this,sql);};
DatabaseSync.prototype.prepare=function(sql){
  if(rawCaller())rawWork.statements.push(['prepare',sql]);
  // Control the sidecar's generated incarnation at its INSERT. Keep native
  // randomblob available to canonical triggers under trusted_schema=OFF.
  if(sql.startsWith('INSERT INTO generations(')&&!sql.slice(0,sql.indexOf(')')).includes('incarnation')){
    const incarnation=(++sqlSequence).toString(16).padStart(32,'0');
    sql=sql.replace('INSERT INTO generations(','INSERT INTO generations(incarnation,').replace(' VALUES('," VALUES('"+incarnation+"',");
  }
  const statement=prepare.call(this,sql);
  for(const method of ['all','get','run']){const execute=statement[method];statement[method]=function(...args){
    if(tracing)trace.push([method,sql,encode(args)]);return execute.apply(this,args);};}return statement;};
const engine=await load('core/index.mjs');
const embedding=guard?await load('core/context-read-embedder.mjs'):null;
const checkResidency=()=>{if(guard){residency.push(embedding.rawVectorResidencySelected);assert.equal(embedding.rawVectorResidencySelected,false);}};
const {openRawCaptureCore}=await load('core/raw-capture.mjs');
const {rationaleModel}=await load('core/testing/rationale-model.mjs');
const {interpretation}=await load('core/testing/episode-capture-helpers.mjs');
const port={version:'raw-seal-v1',async sealRaw(value){if(tracing)ports.push(['seal',encode(value)]);
  return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(value.text)};},
async openRaw(value){if(tracing)ports.push(['open',encode(value)]);return {text:Buffer.from(value.sealed).toString('utf8')};}};
const base=rationaleModel(),model={...base,interpretEpisode:interpretation,
  extract:({input})=>({items:[{content:'Synthetic retained assertion '+input.messages[0].id+'.',kind:'fact',confidence:.8,sourceIndices:[0]}]})};
for(const method of Object.keys(model)){const work=model[method];if(typeof work==='function'&&method!=='countTokens')model[method]=async value=>{
  if(tracing)ports.push(['model',method,encode(value)]);return work(value);};}
model.countTokens=value=>{if(tracing)ports.push(['model-count',value]);return base.countTokens(value);};
const raw={mode:'raw-v1',sources:true,port,readPolicy:()=>{if(tracing)ports.push(['policy']);return {generation:'synthetic',reason:null};}};
const options={path,model,
  privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',
    authority:{authorize(){return null;},isCurrent(){return null;}}}};
const request=(id,session='session',ordinal=1)=>({namespace:ns,client:'codex',sessionId:session,eventId:id,
  messages:[{
    id,role:'user',occurredAt:null,messageOrdinal:ordinal,content:'Synthetic retained source '+id+'.',
    part:{index:0,start:0,totalUnits:('Synthetic retained source '+id+'.').length,totalBytes:Buffer.byteLength('Synthetic retained source '+id+'.')}}]});
let core;
if(population==='populated'){
  core=openRawCaptureCore(options,raw);await core.captureRaw(request('prior','prior-session'));core.close();
  // Previously created derived files are untouched when no service is selected.
  const old=new DatabaseSync(join(scratch,'previous.raw-search.sqlite'));old.exec('CREATE TABLE synthetic_prior_index(id INTEGER)');old.close();
}
tracing=true;
if(engine.openRawSearch)await engine.openRawSearch(selection==='disabled'?{enabled:false}:undefined);
core=openRawCaptureCore(options,raw);checkResidency();
const grants=new WeakMap();
const authority={authorize(request){ports.push(['authorize',request]);const grant={};const {input,...binding}=request;grants.set(grant,binding);return grant;},
  isCurrent(grant,request){ports.push(['current',request]);return {...grants.get(grant),accessGeneration:1};}};
let reader=core;
if(contextMode!=='none')reader=engine.openMemoryCore({path,contextRead:{version:'context-read-v1',authority,
  counter:{id:'synthetic-counter',countTokens(text){ports.push(['count',text]);return text.length;}},
  ...(contextMode==='hosted'?{policy:{family:'hosted',maxRequests:20,maxUsd:1,estimateUsd:()=>0},
    embedder:{id:'synthetic',revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){controls.beforeDispatch();ports.push(['embed',texts]);return texts.map(()=>[1,0]);}}}:{})}});
checkResidency();
const call=(method,input)=>{try{const value=core[method](input);results.push([method,value]);return value;}catch(error){results.push([method,{error:error.code}]);}};
const commit=(method,input)=>{const value=call(method,input);if(value?.ok!==true)throw Error('privacy_fixture_failed_'+method+':'+JSON.stringify(value));return value;};
for(const [id,session,ordinal] of [['first','session',1],['second','session',2],['first','session',1],['delete','delete',1]])
  {const result=await core.captureRaw(request(id,session,ordinal));if(!result.ok)throw Error('capture_fixture_failed:'+id+'/'+population+'/'+contextMode+':'+JSON.stringify(result));results.push(['capture',result]);}
const episodeCore=openRawCaptureCore({...options,captureQualification:'source-bound-v2',captureEvidence:'staged-v1',
  sessionEpisodes:{mode:'episode-v1',draftEveryBatches:2}},raw);
const episodeResult=await episodeCore.captureRaw({...request('episode','episode'),
  episodeContext:{clientLabel:'Synthetic client',generation:'initial',origin:'ordinary'}});
if(!episodeResult.ok)throw Error('episode_fixture_failed:'+JSON.stringify(episodeResult));results.push(['episode-capture',episodeResult]);episodeCore.close();
for(const id of ['first','second'])commit('admit',{namespace:ns,memory:{content:'Synthetic seeded '+id+' fact.',kind:'fact'},
  receipts:[{client:'codex',sessionId:'session',eventId:id,role:'user',excerpt:'Synthetic retained source '+id+'.'}]});
call('list',{namespace:ns});
call('getRawUsage',{ownerId:ns.ownerId});
{const legacy=engine.openMemoryStore({path}),scoped=legacy.scope({ownerId:ns.ownerId});results.push(['legacy-search',scoped.search('synthetic')]);legacy.close();}
if(reader!==core){
  for(const intent of ['current','history']){
    const refresh=await reader.refreshContextIndex({readSet:[ns],types:['memory'],intent,budget:{maxItems:100,maxMs:1000}},{});
    if(refresh.ok!==true)throw Error('refresh_fixture_failed');results.push(['refresh-'+intent,refresh]);
  }
  for(const semantic of [false,true])for(const representation of ['representation-v2','representation-v2-dated'])for(const maxTokens of [undefined,1500,4000,4001])for(const intent of ['current','history']){results.push(['context',await reader.contextRead({readSet:[ns],types:['memory'],intent,query:'synthetic',semantic,
    representation,...(maxTokens===undefined?{}:{budget:{maxTokens,maxItems:12}})}, {})]);checkResidency();}
  results.push(['context-capabilities',reader.getContextReadCapabilities()]);
}
const db=new DatabaseSync(path),memories=db.prepare('SELECT id,revision FROM memories WHERE deleted=0 ORDER BY id').all();
if(memories[0])commit('correct',{namespace:ns,memoryId:memories[0].id,expectedRevision:memories[0].revision,
  content:'Synthetic replacement.',kind:'fact',receipt:{client:'manual',sessionId:'manual',eventId:'manual',role:'user',excerpt:'Synthetic replacement.'}});
const remaining=db.prepare('SELECT id,revision FROM memories WHERE deleted=0 AND id!=? ORDER BY id LIMIT 1').get(memories[0]?.id??'');
if(remaining)commit('forget',{namespace:ns,memoryId:remaining.id,expectedRevision:remaining.revision});
const conversation=db.prepare("SELECT id,revision FROM raw_conversations WHERE id IN (SELECT conversation_id FROM raw_messages WHERE message_id='delete')").get();
if(conversation)commit('deleteConversation',{namespace:ns,conversationId:conversation.id,expectedRevision:conversation.revision,actionId:'delete'});
const episode=db.prepare('SELECT id,revision FROM session_episodes WHERE deleted=0 ORDER BY id LIMIT 1').get();
if(episode)commit('forgetEpisode',{namespace:ns,episodeId:episode.id,expectedRevision:episode.revision});
call('getRawUsage',{ownerId:ns.ownerId});
{const legacy=engine.openMemoryStore({path}),scoped=legacy.scope({ownerId:ns.ownerId});results.push(['legacy-search',scoped.search('synthetic')]);legacy.close();}
if(reader!==core)reader.close();core.close();
const reopened=engine.openMemoryCore({path});results.push(['reopened',reopened.list({namespace:ns})]);reopened.close();
tracing=false;
const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
const data=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,
  db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>encode(row))]);db.close();
const {readSqliteFixture}=await load('core/testing/content-safety-s2h-fixture.mjs');
const canonicalBytes=readSqliteFixture(path).toString('hex');
const auxiliaryBytes=readdirSync(scratch).filter(name=>name.endsWith('.sqlite')&&name!=='canonical.sqlite').sort()
  .map(name=>[name,readSqliteFixture(join(scratch,name)).toString('hex')]);
if(guard){
  for(const handle of timerHandles){clearTimeout(handle);clearInterval(handle);}
  assert.deepEqual(rawWork,{statements:[],timers:[]});
  assert.deepEqual(readdirSync(scratch).filter(name=>name.includes('.raw-search.')),population==='populated'?['previous.raw-search.sqlite']:[]);
  assert.ok(trace.every(([,sql])=>!sql.includes('0 AS revision')));
}
writeFileSync(report,JSON.stringify(encode({...(guard?{rawWork,residency}:{}),results,trace,ports,clockTrace,timeline,schema,data,canonicalBytes,auxiliaryBytes,files:readdirSync(scratch).sort()})));

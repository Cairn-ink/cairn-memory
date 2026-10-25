#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventory} from '../generator/inventory.mjs';
import {SENTENCES} from '../generator/bank.mjs';
import {engineeringStressFixtures} from './cap-stress-fixtures.mjs';
import {STAGE_CONFIGURATION,ARM_CONFIGURATION} from './run-configuration.mjs';
import {PUBLIC_AUTHOR_PATHS,PRODUCT_SCHEMA_BINDINGS,publicVocabulary} from './public-paths-a4.mjs';
import {hash} from './common.mjs';
import {NameRegistry} from './name-registry-a6.mjs';
import {authenticatedGeneratorTrivia} from './trivia-authority-a6.mjs';
import {compileTrivia} from '../scorer/support.mjs';

// The renderer grammar declares placeholders with /\{(\w+)\}/g. These
// identifiers are map keys, not metadata field names. Values remain private:
// recurse into every value, and never grant a model-visible subtree exemption.
export function templatePlaceholders() {
  return [...new Set(Object.values(SENTENCES).flatMap(languages=>Object.values(languages).flatMap(template=>[...template.matchAll(/\{(\w+)\}/g)].map(m=>m[1]))))].sort();
}
export function collectPrivateMetadata(value,origin,add,publicNames=publicVocabulary()) {
  const declared=new Set(templatePlaceholders());
  function visit(value,path) {
    if(Array.isArray(value)){for(const v of value)visit(v,path+'[]');return;}
    if(!value||typeof value!=='object')return;
    const placeholderMap=path==='private_generator_support.optional_trivia.emission_inputs[].variables';
    for(const [key,v]of Object.entries(value)) {
      if(placeholderMap)assert.ok(declared.has(key),'undeclared_template_placeholder:'+key);
      else if(!publicNames.has(key))add(key,path+'.'+key);
      visit(v,path+'.'+key);
    }
  }
  visit(value,origin);
}

// Visit every object, including all AST events and control/expected subtrees.
export function derivePrivateFieldInventory() {
  const path='evaluation/hr3/generator/artifacts/pilot/families.jsonl';
  const bytes=readFileSync(path),families=bytes.toString().trim().split('\n').map(JSON.parse);
  const origins=new Map(),publicNames=publicVocabulary(),publicPaths=new Set(PUBLIC_AUTHOR_PATHS),decisions=[];
  const add=(name,origin)=>{if(!origins.has(name))origins.set(name,new Set());origins.get(name).add(origin);};
  const keys=(value,origin)=>collectPrivateMetadata(value,origin,add,publicNames);
  function visit(value,path,origin){
    if(Array.isArray(value)){for(const item of value)visit(item,path?path+'.*':'*',origin);return;}
    if(value&&typeof value==='object')for(const [name,child]of Object.entries(value)){
      const p=path?path+'.'+name:name,allowed=publicPaths.has(p);
      decisions.push({path:p,public:allowed,publicSchemaCollision:!allowed&&publicNames.has(name)});
      if(!allowed&&!publicNames.has(name))add(name,origin+'.'+p);
      visit(child,p,origin);
    }
  }
  for(const [cohort,rows]of [['pilot',families],['engineering',engineeringStressFixtures().map(b=>b.family)]])for(const family of rows)visit(family,'',cohort+'.family');
  // Inspect the actual identity-only registry shape, not an exempt subtree or
  // a hand-maintained approximation. This independent witness has no values.
  const registry=new NameRegistry();registry.register({event_id:'independent-event',identity_partition:'independent-family',subject:'engineering example',predicate:'dispatch configuration',observed_at:'2034-01-01T00:00:00.000Z',batch:1,source_turns:['independent-turn'],record_name:{name:'independentName',anchor:{turn_id:'independent-turn',quote:'independentName',start:0,end:15}}});
  keys(registry.audit(),'private_name_registry');
  const supportPath='evaluation/hr3/generator/artifacts/pilot/support.jsonl';
  for(const line of readFileSync(supportPath,'utf8').trim().split('\n'))keys(JSON.parse(line),'private_generator_support');
  // Freeze-bound authentication handles and producer tape stay scoring-private.
  keys(JSON.parse(readFileSync('evaluation/hr3/generator/freeze.json')).optional_trivia,'private_trivia_authority');
  const firstSupport=JSON.parse(readFileSync(supportPath,'utf8').split('\n')[0]);
  const firstFamily=families.find(f=>f.family_id===firstSupport.family_id);
  const authenticated=authenticatedGeneratorTrivia(firstFamily,firstSupport.optional_trivia,firstFamily.checkpoints[0]);
  keys(authenticated.supportTrivia,'private_authenticated_support');keys(authenticated.scoringOptions,'private_scoring_case');
  keys(compileTrivia(authenticated.supportTrivia,new Map(),authenticated.scoringOptions.triviaCase,firstFamily.checkpoints[0].question).authentication,'private_case_authentication');
  // Allocation metadata is inspected without rendering held-out sources.
  for(const lineage of inventory().lineages) {
    for(const [key,value] of Object.entries(lineage))if(!['bank','type','members'].includes(key)){add(key,'allocation.lineage.'+key);keys(value,'allocation.lineage.'+key);}
    for(const member of lineage.members)for(const key of Object.keys(member))if(key!=='language')add(key,'allocation.lineage.members[].'+key);
  }
  for(const config of [...STAGE_CONFIGURATION,...ARM_CONFIGURATION])keys(config,'run_configuration');
  // Previously supported private identifiers stay covered even when absent in
  // this allocation; their origin is explicit rather than an implicit regex.
  for(const name of ['valid_name','identity_partition','source_turn_order','name_errors','name_diagnostics','private_identity_registry','naming_registry','bindings_private','fixture_id','bank_id','world_id','allocation_id','condition_id','change_type_id','case_id','private_label','private_labels','authored_change_type'])add(name,'reserved_private_identifier');
  const variants=name=>{
    const words=name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().split(/[_ -]+/);
    return [...new Set([words.join('_'),words[0]+words.slice(1).map(w=>w[0].toUpperCase()+w.slice(1)).join(''),words.map(w=>w[0].toUpperCase()+w.slice(1)).join(''),words.join('-'),'is_'+words.join('_'), 'is'+words.map(w=>w[0].toUpperCase()+w.slice(1)).join('')])].sort();
  };
  const fields=[...origins].map(([name,locations])=>({name,variants:variants(name),origins:[...locations].sort()})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const name of ['stage','arm','multi_hop','expiry_mode'])assert.ok(fields.some(f=>f.name===name));
  const sources=Object.fromEntries(['evaluation/hr3/harness/private-field-inventory.mjs','evaluation/hr3/harness/name-registry-a6.mjs','evaluation/hr3/harness/public-paths-a4.mjs','evaluation/hr3/harness/preflight-a6-schema.mjs','evaluation/hr3/scorer/schema.mjs','evaluation/hr3/scorer/support.mjs','evaluation/hr3/harness/run-configuration.mjs','evaluation/hr3/harness/cap-stress-fixtures.mjs','evaluation/hr3/generator/freeze.json','evaluation/hr3/harness/trivia-authority-a6.mjs','evaluation/hr3/generator/generate.mjs','evaluation/hr3/generator/bank.mjs','evaluation/hr3/generator/inventory.mjs',supportPath].map(p=>[p,hash(readFileSync(p))]));sources[path]=hash(bytes);for(const [p,fields]of Object.entries(PRODUCT_SCHEMA_BINDINGS)){const source=readFileSync(p,'utf8');for(const key of fields)assert.ok(source.includes("'"+key+"'"),'Public schema field not found: '+p+':'+key);sources[p]=hash(readFileSync(p));}
  return {version:'hr3-private-field-inventory-a6-v2',templatePlaceholderMap:{path:'private_generator_support.optional_trivia.emission_inputs[].variables',declaredKeys:templatePlaceholders(),source:'evaluation/hr3/generator/bank.mjs',grammar:'/\\{(\\w+)\\}/g',policy:'Only declared placeholder keys are excluded at this exact private-map path; values are still recursively scanned. Undeclared keys fail closed.'},publicContractBoundary:{path:'public_contract',policy:'Only exact deterministic re-projections of generator/public-contract.json; private keys remain forbidden everywhere else.'},derivation:'Recursive leaf/container decisions against explicit public paths, closed model schema keys and listed public product-operation fields. Every AST event, control action, checkpoint and expected-state object is visited. Schema-colliding key names are documented separately; no authoring subtree is exempt; declared placeholder map identifiers are not field names and their values remain private. Reserved private identifiers remain covered.',productSchemaBindings:PRODUCT_SCHEMA_BINDINGS,publicSemanticPaths:PUBLIC_AUTHOR_PATHS,publicSchemaKeys:[...publicNames].sort(),pathDecisions:[...new Map(decisions.map(x=>[x.path,x])).values()].sort((a,b)=>a.path.localeCompare(b.path)),fields,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const report=derivePrivateFieldInventory();writeFileSync('evaluation/hr3/harness/reports/private-field-inventory-a6.json',JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({fields:report.fields.length,variants:new Set(report.fields.flatMap(f=>f.variants)).size})+'\n');
}

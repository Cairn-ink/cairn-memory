#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventory} from '../generator/inventory.mjs';
import {engineeringStressFixtures} from './cap-stress-fixtures.mjs';
import {STAGE_CONFIGURATION,ARM_CONFIGURATION} from './run-configuration.mjs';
import {PUBLIC_AUTHOR_PATHS,PRODUCT_SCHEMA_BINDINGS,publicVocabulary} from './public-paths-a4.mjs';
import {hash} from './common.mjs';

// Visit every object, including all AST events and control/expected subtrees.
export function derivePrivateFieldInventory() {
  const path='evaluation/hr3/generator/artifacts/pilot/families.jsonl';
  const bytes=readFileSync(path),families=bytes.toString().trim().split('\n').map(JSON.parse);
  const origins=new Map(),publicNames=publicVocabulary(),publicPaths=new Set(PUBLIC_AUTHOR_PATHS),decisions=[];
  const add=(name,origin)=>{if(!origins.has(name))origins.set(name,new Set());origins.get(name).add(origin);};
  const keys=(value,origin)=>{if(Array.isArray(value))for(const v of value)keys(v,origin+'[]');else if(value&&typeof value==='object')for(const [key,v]of Object.entries(value)){if(!publicNames.has(key))add(key,origin+'.'+key);keys(v,origin+'.'+key);}};
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
  // Allocation metadata is inspected without rendering held-out sources.
  for(const lineage of inventory().lineages) {
    for(const [key,value] of Object.entries(lineage))if(!['bank','type','members'].includes(key)){add(key,'allocation.lineage.'+key);keys(value,'allocation.lineage.'+key);}
    for(const member of lineage.members)for(const key of Object.keys(member))if(key!=='language')add(key,'allocation.lineage.members[].'+key);
  }
  for(const config of [...STAGE_CONFIGURATION,...ARM_CONFIGURATION])keys(config,'run_configuration');
  // Previously supported private identifiers stay covered even when absent in
  // this allocation; their origin is explicit rather than an implicit regex.
  for(const name of ['fixture_id','bank_id','world_id','allocation_id','condition_id','change_type_id','case_id','private_label','private_labels','authored_change_type'])add(name,'reserved_private_identifier');
  const variants=name=>{
    const words=name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().split(/[_ -]+/);
    return [...new Set([words.join('_'),words[0]+words.slice(1).map(w=>w[0].toUpperCase()+w.slice(1)).join(''),words.map(w=>w[0].toUpperCase()+w.slice(1)).join(''),words.join('-'),'is_'+words.join('_'), 'is'+words.map(w=>w[0].toUpperCase()+w.slice(1)).join('')])].sort();
  };
  const fields=[...origins].map(([name,locations])=>({name,variants:variants(name),origins:[...locations].sort()})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const name of ['stage','arm','multi_hop','expiry_mode'])assert.ok(fields.some(f=>f.name===name));
  const sources=Object.fromEntries(['evaluation/hr3/harness/private-field-inventory.mjs','evaluation/hr3/harness/public-paths-a4.mjs','evaluation/hr3/harness/preflight-a4-schema.mjs','evaluation/hr3/scorer/schema.mjs','evaluation/hr3/harness/run-configuration.mjs','evaluation/hr3/harness/cap-stress-fixtures.mjs','evaluation/hr3/generator/generate.mjs','evaluation/hr3/generator/inventory.mjs'].map(p=>[p,hash(readFileSync(p))]));sources[path]=hash(bytes);for(const [p,fields]of Object.entries(PRODUCT_SCHEMA_BINDINGS)){const source=readFileSync(p,'utf8');for(const key of fields)assert.ok(source.includes("'"+key+"'"),'Public schema field not found: '+p+':'+key);sources[p]=hash(readFileSync(p));}
  return {version:'hr3-private-field-inventory-a4-audit-v2',publicContractBoundary:{path:'public_contract',policy:'Only exact deterministic re-projections of generator/public-contract.json; private keys remain forbidden everywhere else.'},derivation:'Recursive leaf/container decisions against explicit public paths, closed model schema keys and listed public product-operation fields. Every AST event, control action, checkpoint and expected-state object is visited. Schema-colliding key names are documented separately; no authoring subtree is exempt. Reserved private identifiers remain covered.',productSchemaBindings:PRODUCT_SCHEMA_BINDINGS,publicSemanticPaths:PUBLIC_AUTHOR_PATHS,publicSchemaKeys:[...publicNames].sort(),pathDecisions:[...new Map(decisions.map(x=>[x.path,x])).values()].sort((a,b)=>a.path.localeCompare(b.path)),fields,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const report=derivePrivateFieldInventory();writeFileSync('evaluation/hr3/harness/reports/private-field-inventory-a4.json',JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({fields:report.fields.length,variants:new Set(report.fields.flatMap(f=>f.variants)).size})+'\n');
}

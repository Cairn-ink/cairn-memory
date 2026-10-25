#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventory} from '../generator/inventory.mjs';
import {engineeringStressFixtures} from './cap-stress-fixtures.mjs';
import {STAGE_CONFIGURATION,ARM_CONFIGURATION} from './run-configuration.mjs';
import {hash} from './common.mjs';

// Public source/semantic containers have their own frozen schemas. A new
// top-level authoring field is private by default, not silently ignored.
const publicFields=['language','change_type','namespace','header','query_scope','batches','checkpoints','controls','ast'];
export function derivePrivateFieldInventory() {
  const path='evaluation/hr3/generator/artifacts/pilot/families.jsonl';
  const bytes=readFileSync(path),families=bytes.toString().trim().split('\n').map(JSON.parse);
  const origins=new Map();
  const add=(name,origin)=>{if(!origins.has(name))origins.set(name,new Set());origins.get(name).add(origin);};
  const keys=(value,origin)=>{if(Array.isArray(value)){for(const v of value)keys(v,origin+'[]');}else if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){add(key,origin+'.'+key);keys(v,origin+'.'+key);}};
  for(const [cohort,rows] of [['pilot',families],['engineering',engineeringStressFixtures().map(b=>b.family)]])for(const f of rows) {
    for(const key of Object.keys(f))if(!publicFields.includes(key)) {
      add(key,cohort+'.family.'+key);
      // Batch and status are public schema fields; private membership retains
      // its distinct multiHop and minimumEdges keys.
      if(key==='reason_strata')for(const row of f[key])for(const name of Object.keys(row))if(!['batch','status'].includes(name))add(name,cohort+'.family.reason_strata[].'+name);
    }
    for(const [key,value] of Object.entries(f.ast??{}))if(key!=='events'){add(key,cohort+'.family.ast.'+key);keys(value,cohort+'.family.ast.'+key);}
    // Control actions/expected states use public operation schemas. The
    // surrounding branch/authoring/scoring selectors are private metadata.
    const publicControl=['kind','actions','checkpoints','expected','namespace','foreignNamespace','readSet','targetRecord'];
    for(const control of f.controls??[])for(const [key,value] of Object.entries(control))if(!publicControl.includes(key)){add(key,cohort+'.family.controls[].'+key);keys(value,cohort+'.family.controls[].'+key);}
  }
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
  const sources=Object.fromEntries(['evaluation/hr3/harness/private-field-inventory.mjs','evaluation/hr3/harness/run-configuration.mjs','evaluation/hr3/harness/cap-stress-fixtures.mjs','evaluation/hr3/generator/generate.mjs','evaluation/hr3/generator/inventory.mjs'].map(p=>[p,hash(readFileSync(p))]));sources[path]=hash(bytes);
  return {version:'hr3-private-field-inventory-a4-v1',publicContractBoundary:{path:'public_contract',policy:'Only exact deterministic re-projections of generator/public-contract.json; private keys remain forbidden everywhere else.'},derivation:'All nonpublic top-level fixture and allocation authoring keys, reason membership keys, AST variant flags, and executable run routing keys; plus previously supported reserved private identifiers. Naming variants normalized across snake/camel/Pascal/kebab and is-prefixed membership flags.',publicSemanticFields:publicFields,fields,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const report=derivePrivateFieldInventory();writeFileSync('evaluation/hr3/harness/reports/private-field-inventory-a4.json',JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({fields:report.fields.length,variants:new Set(report.fields.flatMap(f=>f.variants)).size})+'\n');
}

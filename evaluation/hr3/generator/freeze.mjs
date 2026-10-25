#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assert, canonical, sha256, VERSION, DEFAULT_SEED, ALLOCATION_SEED } from './common.mjs';
import { inventory } from './inventory.mjs';
import { generateFamily } from './generate.mjs';
import { SOURCE_NAMES } from './deliver.mjs';
import { TRIVIA_RULES_SHA256, TRIVIA_VERSION, TRIVIA_AUTH_VERSION, createFamilyTriviaHandle, verifyFamilyTrivia } from './trivia.mjs';
import { inspectedRegistry } from './exclusions.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
async function walk(dir='') {
  const found=[];
  for(const ent of await readdir(path.join(root,dir),{withFileTypes:true})) {
    const name=path.posix.join(dir,ent.name);
    if(ent.isDirectory()) found.push(...await walk(name));
    else if(ent.isFile()) found.push(name);
  }
  return found;
}
const one=(await walk()).sort();
const two=(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>path.relative(root,path.join(e.parentPath,e.name)).split(path.sep).join('/')).sort();
assert(canonical(one)===canonical(two),'freeze_enumeration');
assert(SOURCE_NAMES.every(n=>one.includes(n)),'freeze_sources');
const names=one.includes('freeze.json')?one:[...one,'freeze.json'].sort();
const hashes=Object.fromEntries(await Promise.all(names.filter(n=>n!=='freeze.json').map(async name=>{const bytes=await readFile(path.join(root,name));return [name,{sha256:sha256(bytes),bytes:bytes.length}];})));
const registry=inspectedRegistry();
const pilot=JSON.parse(await readFile(path.join(root,'artifacts/pilot/manifest.json'),'utf8'));
assert(pilot.seed===DEFAULT_SEED && pilot.counts.families===60 && pilot.counts.rejected===0,'freeze_pilot');
for(const [name,entry]of Object.entries(pilot.hashes))assert(hashes[`artifacts/pilot/${name}`].sha256===entry.sha256,'freeze_pilot_hash');
const families=(await readFile(path.join(root,'artifacts/pilot/families.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const supports=(await readFile(path.join(root,'artifacts/pilot/support.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
assert(pilot.optional_trivia.authentication_version===TRIVIA_AUTH_VERSION,'freeze_trivia_authentication');
const authored=inventory(DEFAULT_SEED).lineages.filter(l=>l.split==='pilot');
const expectedIds=authored.flatMap(l=>l.members.map(m=>m.family_id)).sort();
assert(canonical(Object.keys(pilot.optional_trivia.family_handles).sort())===canonical(expectedIds)&&canonical(families.map(f=>f.family_id).sort())===canonical(expectedIds),'freeze_trivia_family_set');
for(let i=0;i<families.length;i++) {
  assert(families[i].family_id===supports[i].family_id,'freeze_trivia_family');
  const lineage=authored.find(l=>l.members.some(m=>m.family_id===families[i].family_id));
  const member=lineage.members.find(m=>m.family_id===families[i].family_id);
  const trusted=generateFamily(lineage,member,DEFAULT_SEED);
  const handle=createFamilyTriviaHandle(trusted.family,trusted.support.optional_trivia,trusted.support.optional_trivia.emission_inputs);
  assert(canonical(pilot.optional_trivia.family_handles[families[i].family_id])===canonical(handle),'freeze_trivia_authoring');
  verifyFamilyTrivia({family:families[i],registry:supports[i].optional_trivia},handle);
}
const report={version:VERSION,revision:'A-6',seed:DEFAULT_SEED,allocation_seed:ALLOCATION_SEED,api_calls:0,credentials_read:false,committed:false,
  protocol:'protocol-v0.3.4 + errata A-6',protocol_sha256:sha256(await readFile(new URL('../protocol/protocol-v0.3.4.md',import.meta.url))),errata_sha256:sha256(await readFile(new URL('../protocol/errata.md',import.meta.url))),
  public_contract:{path:'public-contract.json',sha256:hashes['public-contract.json'].sha256,schema:'public-contract.schema.json'},
  optional_trivia:{version:TRIVIA_VERSION,rules:'trivia-rules.json',rules_sha256:TRIVIA_RULES_SHA256,private:true,authentication_version:TRIVIA_AUTH_VERSION,family_handles:pilot.optional_trivia.family_handles,family_handles_sha256:sha256(canonical(pilot.optional_trivia.family_handles)),independent_review:'pending; offline pilot is provisional, not execution-authorized'},
  inspected_registry:{path:registry.path,sha256:registry.sha256,counts:registry.registry.counts,exclusions:'calibration/tuning: family, lineage, ancestry closure, both serialization hashes'},
  file_inventory:names,file_count:names.length,file_cross_check:{routes:['recursive explicit directory walk','recursive readdir Dirent enumeration'],count:names.length},hashes,
  pilot:{counts:pilot.counts,leakage:pilot.leakage,manifest_sha256:hashes['artifacts/pilot/manifest.json'].sha256,ancestry:'Same engineering/pilot roots; A-4 bank ancestry retained; A-6 provenance/seed revisions do not create independent roots.'},
  heldout:{rendered:false,development:'blocked',test:'blocked',known_inspected_lineages:66,fresh_r3_replacements:{development:8,test:30},all_heldout_rendering:'Blocked at generateSplit and generateFamily pending reviewed fresh banks and calibration.'},
  gates:{generator_conformance:'pass',non_author_review:'pending',trivia_licenses_independent_review:'pending',caps_requests_embeddings_budget:'pending A-6 harness recertification',paid_execution_authorized:false},
  self_hash:'freeze.json is enumerated but not self-hashed'};
await writeFile(path.join(root,'freeze.json'),canonical(report)+'\n');
console.log(JSON.stringify({files:names.length,crossCheck:'pass',pilotFamilies:pilot.counts.families,heldoutRendered:false}));

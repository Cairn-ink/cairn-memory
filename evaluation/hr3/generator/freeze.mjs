#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assert, canonical, sha256, VERSION, DEFAULT_SEED, ALLOCATION_SEED } from './common.mjs';
import { SOURCE_NAMES } from './deliver.mjs';
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
const report={version:VERSION,revision:'A-4',seed:DEFAULT_SEED,allocation_seed:ALLOCATION_SEED,api_calls:0,credentials_read:false,committed:false,
  protocol:'protocol-v0.3.4 + errata A-4',protocol_sha256:sha256(await readFile(new URL('../protocol/protocol-v0.3.4.md',import.meta.url))),errata_sha256:sha256(await readFile(new URL('../protocol/errata.md',import.meta.url))),
  public_contract:{path:'public-contract.json',sha256:hashes['public-contract.json'].sha256,schema:'public-contract.schema.json'},
  inspected_registry:{path:registry.path,sha256:registry.sha256,counts:registry.registry.counts,exclusions:'calibration/tuning: family, lineage, ancestry closure, both serialization hashes'},
  file_inventory:names,file_count:names.length,file_cross_check:{routes:['recursive explicit directory walk','recursive readdir Dirent enumeration'],count:names.length},hashes,
  pilot:{counts:pilot.counts,leakage:pilot.leakage,manifest_sha256:hashes['artifacts/pilot/manifest.json'].sha256,ancestry:'Same engineering/pilot roots; A-4 fixture revision and fresh seed do not create independent roots.'},
  heldout:{rendered:false,development:'blocked',test:'blocked',known_inspected_lineages:66,fresh_r3_replacements:{development:8,test:30},all_heldout_rendering:'Blocked at generateSplit and generateFamily pending reviewed fresh banks and calibration.'},
  gates:{generator_conformance:'pass',non_author_review:'pending',caps_requests_embeddings_budget:'pending harness recertification',paid_execution_authorized:false},
  self_hash:'freeze.json is enumerated but not self-hashed'};
await writeFile(path.join(root,'freeze.json'),canonical(report)+'\n');
console.log(JSON.stringify({files:names.length,crossCheck:'pass',pilotFamilies:pilot.counts.families,heldoutRendered:false}));

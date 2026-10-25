import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonical, jsonl, sha256, DEFAULT_SEED, VERSION, assert } from './common.mjs';
import { inventory, SPLITS, GRAMMAR } from './inventory.mjs';
import { SENTENCES } from './bank.mjs';
import { generateFamily } from './generate.mjs';
import { validateInventory, validateFamily } from './validate.mjs';
import { UNIT_DICTIONARY } from './canonicalize.mjs';
import { validatePublicContract, publicContract } from './contract.mjs';
import { inspectedRegistry, assertUninspected } from './exclusions.mjs';
import { TRIVIA_RULES_SHA256, TRIVIA_VERSION, TRIVIA_AUTH_VERSION, createFamilyTriviaHandle } from './trivia.mjs';
import { leakageReport } from './leakage.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
export const SOURCE_NAMES=['bank.mjs','canonicalize.mjs','cli.mjs','common.mjs','controls.mjs','deliver.mjs','generate.mjs','inventory.mjs','reason-strata.mjs','validate.mjs','answer.schema.json','README.md','test/generator.test.mjs','contract.mjs','slots.mjs','exclusions.mjs','leakage.mjs','public-contract.json','public-contract.schema.json','freeze.mjs','trivia.mjs','trivia-rules.json','examples.mjs'];
export async function sourceHashes() {
  return Object.fromEntries(await Promise.all(SOURCE_NAMES.map(async name=>[name,sha256(await readFile(path.join(root,name)))])));
}
export function generateSplit(split, seed=DEFAULT_SEED, candidate=generateFamily) {
  assert(Object.hasOwn(SPLITS,split),'unknown_split',split);
  assert(['engineering','pilot'].includes(split),'heldout_freshness_gate');
  const inv=inventory(seed); validateInventory(inv); validatePublicContract();
  const inspected=inspectedRegistry().registry;
  const bundles=[],rejections=[],audit=[];
  for (const lineage of inv.lineages.filter(l=>l.split===split)) for (const member of lineage.members) {
    let bundle;
    try {
      bundle=candidate(lineage,member,seed);
      assertUninspected(bundle.family,inv,inspected);
      audit.push(validateFamily(bundle,lineage));
      bundles.push(bundle);
    } catch(error) {
      rejections.push({candidate_id:member.family_id,lineage_id:lineage.lineage_id,seed,attempt:0,code:error.code??'generation_error',message:error.message,candidate_sha256:bundle?sha256(canonical(bundle)):null});
    }
  }
  return {inventory:inv,bundles,rejections,audit};
}
export async function emit({split,out,seed=DEFAULT_SEED}) {
  assert(Object.hasOwn(SPLITS,split),'unknown_split',split);
  await mkdir(out,{recursive:true});
  // Never silently overwrite a frozen or failed generation directory.
  assert((await readdir(out)).length===0,'output_not_empty',out);
  assert(['engineering','pilot'].includes(split),'heldout_freshness_gate');
  const inv=inventory(seed); validateInventory(inv); validatePublicContract();
  // Publish allocation and ancestry before rendering even the engineering candidates.
  const files={
    'lineage-inventory.json':canonical(inv)+'\n',
    'grammar-and-sentence-bank.json':canonical({grammar:GRAMMAR,sentences:SENTENCES,public_contract:publicContract(),canonicalization:{unicode:'NFKC',whitespace:'collapse and trim',timeZone:'Asia/Taipei',scopeDomain:{country:['TW','JP','US'],plan:['free','pro'],channel:['web','app']},values:'Type tags identify closed Value variants; exact decimals are rational, never floating-point comparisons.',unknownEquivalence:'refer; do not infer aliases',units:UNIT_DICTIONARY,dictionaries:inv.lineages.map(l=>({bank_id:l.ancestry.bank_id,subject:{canonical:l.bank.subjectEn,aliases:[l.bank.subjectZh,l.bank.subjectEn]},predicate:{canonical:l.bank.predicateEn,aliases:[l.bank.predicateZh,l.bank.predicateEn]},reasons:l.bank.reasons.map(r=>({canonical:r.en,aliases:[r.zh,r.en]}))}))}})+'\n',
  };
  for (const [name,body] of Object.entries(files)) await writeFile(path.join(out,name),body,{flag:'wx'});
  const result=generateSplit(split,seed);
  Object.assign(files,{
    'families.jsonl':jsonl(result.bundles.map(x=>x.family)),
    'gold.jsonl':jsonl(result.bundles.map(x=>x.gold)),
    'support.jsonl':jsonl(result.bundles.map(x=>x.support)),
    'rejected-candidates.jsonl':jsonl(result.rejections),
    'validation-audit.jsonl':jsonl(result.audit),
  });
  for (const [name,body] of Object.entries(files).slice(2)) await writeFile(path.join(out,name),body,{flag:'wx'});
  const source_hashes=await sourceHashes();
  const protocol_hash=sha256(await readFile(new URL('../protocol/protocol-v0.3.4.md',import.meta.url)));
  const specs=inv.lineages.filter(l=>l.split===split);
  const manifest={version:VERSION,revision:'A-6-names-and-trivia-v1',protocol:'protocol-v0.3.4',protocol_sha256:protocol_hash,seed,split,
    source_hashes,optional_trivia:{version:TRIVIA_VERSION,rules_sha256:TRIVIA_RULES_SHA256,private:true,authentication_version:TRIVIA_AUTH_VERSION,family_handles:Object.fromEntries(result.bundles.map(({family,support})=>[family.family_id,createFamilyTriviaHandle(family,support.optional_trivia,support.optional_trivia.emission_inputs)])),independent_review:'pending before paid execution'},public_contract_sha256:sha256(await readFile(new URL('./public-contract.json',import.meta.url))),inspected_registry:{...inspectedRegistry(),registry:undefined},leakage:leakageReport(result.bundles),allocation_sha256:sha256(files['lineage-inventory.json']),
    counts:{lineages:specs.length,families:result.bundles.length,expectedFamilies:specs.reduce((sum,l)=>sum+l.multiplicity,0),rejected:result.rejections.length,
      languages:Object.fromEntries(GRAMMAR.languages.map(language=>[language,result.bundles.filter(x=>x.family.language===language).length])),
      cardFamilies:result.bundles.filter(x=>x.family.controls.some(c=>c.kind==='card')).length,
      safetyFamilies:result.bundles.filter(x=>x.family.controls.some(c=>c.kind==='named_forget_replay_foreign')).length,
      multiHopFamilies:result.bundles.filter(x=>x.family.reason_strata.every(s=>s.multiHop)).length,
      unstatedFamilies:result.bundles.filter(x=>x.family.reason_strata.every(s=>s.status==='not_stated')).length,
      cardAuthoringPaths:Object.fromEntries(['confirm_with_dependencies','declare_separately'].map(p=>[p,result.bundles.flatMap(b=>b.family.controls).filter(c=>c.kind==='card' && c.authoring_path===p).length]))},
    hashes:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,{sha256:sha256(body),bytes:Buffer.byteLength(body),rows:name.endsWith('.jsonl')?(body.match(/\n/g)??[]).length:1}])),
    gates:{complete:result.rejections.length===0,nonAuthorSemanticAudit:'pending',serializerTokenCap:'pending',goldFreezeApproval:'pending',errata:['E-1 revised 2026-10-25','E-2','A-1','A-2','A-3','A-4','A-5','A-6'],unresolvedProtocolAmbiguities:[],preDevelopment:inv.preDevelopmentGates,paidStageAuthorized:false},
  };
  // Second route: hash bytes read back from disk and compare to the pre-write manifest.
  for (const [name,entry] of Object.entries(manifest.hashes)) assert(sha256(await readFile(path.join(out,name)))===entry.sha256,'disk_hash_mismatch',name);
  const diskFiles=(await readdir(out)).sort(), planned=Object.keys(files).sort();
  assert(canonical(diskFiles)===canonical(planned),'artifact_enumeration');
  manifest.crossCheck={routes:['planned file map','filesystem readdir + readback SHA-256'],count:diskFiles.length};
  await writeFile(path.join(out,'manifest.json'),canonical(manifest)+'\n',{flag:'wx'});
  return manifest;
}

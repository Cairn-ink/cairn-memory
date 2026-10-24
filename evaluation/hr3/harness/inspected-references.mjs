import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { hash } from './common.mjs';
const historicalURL=new URL('./reports/cap-certification.json',import.meta.url);
export function inspectedReferenceManifest() {
  const bytes=readFileSync(historicalURL);
  assert.equal(hash(bytes),'fabb8dcb33a6935e64c98d7106c195e962a18fbc2b10cd99761d2951203234b9');
  const historical=JSON.parse(bytes),cases=historical.structures.filter(s=>['development','test'].includes(s.worst.split)).map(s=>{
    const r=s.worst;assert.equal(hash(r.serialization),r.sha256);
    return {id:s.structure,status:'inspected',excludeFrom:['calibration','tuning'],split:r.split,familyId:r.familyId,lineageId:r.familyId.replace(/-W\d+$/,''),batch:r.batch,operation:r.operation,variant:r.variant,serializationSHA256:r.sha256,referenceRowSHA256:hash(r),tokens:r.tokens};
  });
  const lineages=[...new Set(cases.map(c=>c.lineageId))].sort();
  assert.equal(cases.length,504);
  for(const split of ['development','test'])assert.equal(lineages.filter(l=>l.startsWith(split+'-')).length,33);
  return {version:'hr3-inspected-heldout-references-v1',errataSHA256:hash(readFileSync(new URL('../protocol/errata.md',import.meta.url))),
    sourceReport:{commit:'aa3b0a14732776ae1ea472b73de4ed0e7f0cbc11',path:'evaluation/hr3/harness/reports/cap-certification.json',sha256:hash(bytes)},
    scope:'Published reference cases retained in the aa3b0a14 report. That run also rendered all 1800 held-out worlds; this manifest does not assert that unretained worlds are uninspected or fresh.',
    exclusionPolicy:'Reject calibration/tuning candidates matching any case serialization hash, family, lineage, or declared lineage ancestor. Freshness and allocation gates remain binding for later development/test generation.',
    counts:{cases:cases.length,families:new Set(cases.map(c=>c.familyId)).size,lineages:lineages.length,developmentLineages:33,testLineages:33},
    previousWorstTokens:Object.fromEntries(['reader','extraction'].map(op=>[op,Math.max(...cases.filter(c=>c.operation===op).map(c=>c.tokens))])),
    lineages:lineages.map(id=>({id,status:'inspected',excludeFrom:['calibration','tuning'],provisionalR3:id.endsWith('-R3'),caseSetSHA256:hash(cases.filter(c=>c.lineageId===id))})),cases};
}
export function isInspectedReference(candidate,manifest) {
  const ids=new Set([candidate.lineageId,...(candidate.ancestorLineageIds??[])]);
  return manifest.lineages.some(l=>ids.has(l.id))||manifest.cases.some(c=>c.familyId===candidate.familyId||c.serializationSHA256===candidate.serializationSHA256);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv.length,2);const manifest=inspectedReferenceManifest();
  writeFileSync(new URL('./reports/inspected-heldout-references.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
  process.stdout.write(JSON.stringify(manifest.counts)+'\n');
}

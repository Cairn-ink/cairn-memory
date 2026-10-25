import { readFileSync } from 'node:fs';
import { assert, canonical, sha256 } from './common.mjs';

export const INSPECTED_REGISTRY_PATH='evaluation/hr3/harness/reports/inspected-heldout-references.json';
export function inspectedRegistry() {
  const bytes=readFileSync(new URL('../harness/reports/inspected-heldout-references.json',import.meta.url));
  const registry=JSON.parse(bytes);
  assert(registry.cases.length===registry.counts.cases && new Set(registry.cases.map(c=>c.id)).size===registry.cases.length,'inspected_registry_count');
  for(const split of ['development','test'])assert(registry.lineages.filter(l=>l.id.startsWith(split+'-')).length===registry.counts[split+'Lineages'],'inspected_registry_count');
  const families=new Set(registry.cases.map(c=>c.familyId)),lineages=new Set(registry.cases.map(c=>c.lineageId));
  assert(families.size===registry.counts.families && lineages.size===registry.counts.lineages,'inspected_registry_count');
  assert(canonical([...lineages].sort())===canonical(registry.lineages.map(l=>l.id).sort()),'inspected_registry_lineages');
  for(const l of registry.lineages) {
    const cases=registry.cases.filter(c=>c.lineageId===l.id);
    assert(sha256(canonical(cases))===l.caseSetSHA256,'inspected_registry_hash');
  }
  for(const c of [...registry.cases,...registry.lineages]) assert(c.status==='inspected' && ['calibration','tuning'].every(p=>c.excludeFrom.includes(p)),'inspected_registry_policy');
  return {registry,sha256:sha256(bytes),path:INSPECTED_REGISTRY_PATH};
}
// Ancestry closure is checked as well as exact IDs and either retained hash form.
export function assertUninspected(candidate,inventory,registry=inspectedRegistry().registry) {
  const lineages=new Set(registry.lineages.map(l=>l.id));
  const families=new Set(registry.cases.map(c=>c.familyId));
  const hashes=new Set(registry.cases.flatMap(c=>[c.serializationSHA256,c.referenceRowSHA256]));
  const rows=new Map([...inventory.lineages,...inventory.retired_lineages].map(l=>[l.lineage_id,l]));
  const todo=[candidate.lineage_id??candidate.lineageId,...(candidate.ancestors??[]),...(candidate.ancestorLineageIds??[]),candidate.ancestry?.parent].filter(Boolean),seen=new Set();
  while(todo.length) {
    const id=todo.pop(); if(seen.has(id))continue;seen.add(id);
    assert(!lineages.has(id),'inspected_reference_exclusion',id);
    const parent=rows.get(id)?.ancestry.parent;if(parent)todo.push(parent);
  }
  assert(!families.has(candidate.family_id??candidate.familyId),'inspected_reference_exclusion');
  for(const hash of [candidate.serializationSHA256,candidate.referenceRowSHA256,candidate.sha256,candidate.serialization===undefined?undefined:sha256(candidate.serialization),candidate.referenceRow===undefined?undefined:sha256(canonical(candidate.referenceRow))].filter(Boolean)) assert(!hashes.has(hash),'inspected_reference_exclusion');
  return true;
}

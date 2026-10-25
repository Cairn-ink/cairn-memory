// Prospective A-4 request projection. This module does not enable dispatch.
import {readFileSync} from 'node:fs';
import {canonical, normalize} from './common.mjs';

export const PROJECTION_VERSION='hr3-contract-projection-a4-v2';
export const PUBLIC_CONTRACT=JSON.parse(readFileSync(new URL('../generator/public-contract.json',import.meta.url),'utf8'));
const names=row=>[row.canonical,...row['zh-Hant'],...row.en,...row.mixed];
const aliases=row=>({canonical:row.canonical,aliases:[...new Set(names(row))].filter(x=>x!==row.canonical)});

// Relevance depends exclusively on the public request, never AST, allocation,
// gold, event IDs, causal class, or the case's correct historical status.
// All declared spellings of every relevant name remain available. Folding the
// language columns and duplicate canonical spellings loses no correspondence.
export function projectContract(operation,input) {
  if(!['extraction','reader'].includes(operation))throw Error('projection_operation');
  // Reader callers must supply a shared public family/question context before
  // arm fan-out, never arm-specific retrieval contents.
  if(operation==='reader'&&Object.hasOwn(input,'delivered'))throw Error('reader_projection_requires_shared_public_context');
  const c=structuredClone(PUBLIC_CONTRACT),publicText=normalize(canonical(input));
  const relevant=row=>names(row).some(name=>publicText.includes(normalize(name)));
  c.aliases={subjects:c.aliases.subjects.filter(relevant).map(aliases),
    predicates:c.aliases.predicates.filter(relevant).map(aliases),routes:c.aliases.routes};
  // Fold the field alias table into the slots; preserve mixed-language aliases
  // missing from slots[].aliases, and all three required slots in every case.
  for(const slot of c.slots)slot.aliases=[...new Set([...slot.aliases,...names(PUBLIC_CONTRACT.aliases.fields.find(f=>f.canonical===slot.name))])];
  if(operation==='extraction') {
    delete c.answer;
    delete c.historical_labels;
    delete c.values.slot_states;
    delete c.values.slot_state_rule;
    // Delivered-item addressing is exclusively a reader task. Extraction has
    // its own exact source-turn anchor rule. Keep all independent bilingual
    // examples: adoption, partial/complete, scope/expiry, commitments, exact
    // occurrences, aliases/normalization. No example or rule is paraphrased.
    c.citations={extraction_anchor:c.citations.extraction_anchor};
  } else {
    // Reader requests have no extraction wire payload or legacy field masks.
    // Keep all reader meanings, aliases, labels and independent examples.
    delete c.citations.extraction_anchor;delete c.values.supplied_null;
    for(const slot of c.slots)delete slot.legacy_field;
  }
  return c;
}

export function isContractProjection(value) {
  if(!value||typeof value!=='object')return false;
  if(canonical(value)===canonical(PUBLIC_CONTRACT))return true;
  if(!Array.isArray(value.aliases?.subjects)||!Array.isArray(value.aliases?.predicates))return false;
  const names=[...value.aliases.subjects,...value.aliases.predicates].map(x=>x.canonical);
  return ['extraction','reader'].some(operation=>canonical(projectContract(operation,{names}))===canonical(value));
}
export function familyContractContext(family,question='') {
  return {public_header:family.header,turns:family.batches.flatMap(b=>b.turns),question};
}

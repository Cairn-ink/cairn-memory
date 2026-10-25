import { readFileSync } from 'node:fs';
import { assert, canonical, sha256 } from './common.mjs';
import { SENTENCES, renderSentence } from './bank.mjs';

const bytes=readFileSync(new URL('./trivia-rules.json',import.meta.url));
export const TRIVIA_RULES=JSON.parse(bytes);
export const TRIVIA_RULES_SHA256=sha256(bytes);
export const TRIVIA_VERSION='hr3-optional-trivia-a6-v2';
function literals(production,language) {return SENTENCES[production][language].split(/\{\w+\}/g);}
export function validateTriviaRules() {
  const seen=new Set();
  for(const r of TRIVIA_RULES.rules) {
    const key=canonical([r.production,r.language,r.literal_index,r.literal_offset]);assert(!seen.has(key),'trivia_duplicate_rule');seen.add(key);
    const chunks=literals(r.production,r.language),chunk=chunks[r.literal_index];
    assert(chunk?.[r.literal_offset]===r.character && ('.,;:，。；：、'.includes(r.character)||/^\s$/u.test(r.character)),'trivia_rule_character');
    // Independently bounded license roles, rather than a punctuation whitelist.
    assert(r.role==='sentence-final separator'?r.literal_index===chunks.length-1 && r.literal_offset===chunk.length-1 && ['.','。'].includes(r.character):r.role==='between source productions'&&r.production==='source_join'&&chunk===' '&&r.literal_offset===0,'trivia_rule_role');
  }
  return true;
}
validateTriviaRules();
export function appendSource(turn,origin,production,language,vars={}) {
  const rendered=renderSentence(production,language,vars),start=turn.text.length;
  turn.text+=rendered.text;
  origin.segments.push({production,language:rendered.language,start,end:turn.text.length,parts:rendered.parts.map(p=>({...p,start:p.start+start,end:p.end+start}))});
  for(const rule of TRIVIA_RULES.rules.filter(r=>r.production===production&&r.language===rendered.language)) {
    const part=rendered.parts.find(p=>p.kind==='literal'&&p.literal_index===rule.literal_index);
    const position=start+part.start+rule.literal_offset;
    assert(turn.text[position]===rule.character,'trivia_emission');origin.positions.push(position);
  }
}
// Called by world authoring before appendSource. Never derive these inputs
// from rendered text, registry parts or optional positions.
export function captureEmission(turn_id,production,language,variables={}) {
  const lang=language==='zh-Hant'?'zh':'en';
  const template=SENTENCES[production]?.[lang];
  assert(typeof template==='string','trivia_template');
  return structuredClone({turn_id,production,language:lang,template,variables});
}
export function triviaRegistry(origins,emission_inputs) {
  assert(Array.isArray(emission_inputs),'trivia_trusted_emissions_required');
  return {version:TRIVIA_VERSION,rules_sha256:TRIVIA_RULES_SHA256,offset_unit:'utf16',emission_inputs:structuredClone(emission_inputs),origins:[...origins.values()]};
}
export const TEMPLATE_BANK_SHA256=sha256(canonical(SENTENCES));
export const TRIVIA_AUTH_VERSION='hr3-trivia-auth-a6-v1';
function replayEmissions(inputs) {
  assert(Array.isArray(inputs)&&inputs.length>0,'trivia_trusted_emissions_required');
  assert(sha256(canonical(SENTENCES))===TEMPLATE_BANK_SHA256,'trivia_template_bank');
  const origins=new Map(),turns=new Map();
  for(const input of inputs) {
    assert(input&&canonical(Object.keys(input).sort())===canonical(['turn_id','production','language','template','variables'].sort()),'trivia_emission_input');
    assert(typeof input.turn_id==='string'&&input.turn_id.length>0&&['en','zh'].includes(input.language),'trivia_emission_input');
    assert(input.variables&&typeof input.variables==='object'&&!Array.isArray(input.variables),'trivia_emission_input');
    assert(typeof input.template==='string'&&input.template===SENTENCES[input.production]?.[input.language],'trivia_template');
    if(!turns.has(input.turn_id)) {
      turns.set(input.turn_id,{turn_id:input.turn_id,text:''});
      origins.set(input.turn_id,{turn_id:input.turn_id,positions:[],segments:[]});
    }
    appendSource(turns.get(input.turn_id),origins.get(input.turn_id),input.production,input.language==='zh'?'zh-Hant':'en',input.variables);
  }
  return {registry:triviaRegistry(origins,inputs),turns};
}
// Third argument is mandatory and MUST come from trusted world/bank authoring,
// independently of the registry being checked. This verifies the one actual
// emission, rather than searching for any parse of the rendered characters.
export function validateTriviaRegistry(registry,turns,trustedEmissionInputs) {
  const expected=replayEmissions(trustedEmissionInputs);
  assert(registry?.version===TRIVIA_VERSION&&registry.rules_sha256===TRIVIA_RULES_SHA256&&registry.offset_unit==='utf16','trivia_version');
  assert(canonical(registry.emission_inputs)===canonical(trustedEmissionInputs),'trivia_emission_inputs');
  assert(turns instanceof Map&&turns.size===expected.turns.size,'trivia_origins');
  for(const [id,reemitted]of expected.turns) {
    const source=turns.get(id),text=typeof source==='string'?source:source?.text;
    assert(text===reemitted.text&&Buffer.from(text).equals(Buffer.from(reemitted.text)),'trivia_source_correspondence');
  }
  assert(Array.isArray(registry.origins)&&registry.origins.length===expected.registry.origins.length,'trivia_origins');
  for(let i=0;i<expected.registry.origins.length;i++) {
    const actual=registry.origins[i],origin=expected.registry.origins[i];
    assert(actual?.turn_id===origin.turn_id,'trivia_origin');
    assert(canonical(actual.segments)===canonical(origin.segments),'trivia_emission_parts');
    assert(canonical(actual.positions)===canonical(origin.positions),'trivia_positions');
  }
  assert(canonical(registry)===canonical(expected.registry),'trivia_registry_emission');
  return true;
}
function sourceTurns(family) {return family.batches.flatMap(batch=>batch.turns).map(({turn_id,text})=>({turn_id,text}));}
function handleFor(family,registry) {
  return {version:TRIVIA_AUTH_VERSION,family_id:family.family_id,lineage_id:family.lineage_id,seed:family.seed,
    namespace_sha256:sha256(canonical(family.namespace)),source_turns_sha256:sha256(canonical(sourceTurns(family))),
    registry_sha256:sha256(canonical(registry)),emission_inputs_sha256:sha256(canonical(registry.emission_inputs)),
    rules_sha256:TRIVIA_RULES_SHA256,template_bank_sha256:TEMPLATE_BANK_SHA256};
}
export function createFamilyTriviaHandle(family,registry,trustedEmissionInputs) {
  validateTriviaRegistry(registry,new Map(sourceTurns(family).map(t=>[t.turn_id,t])),trustedEmissionInputs);
  return handleFor(family,registry);
}
function immutable(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value;
}
// trustedHandle MUST be selected from a trusted, hash-pinned freeze/manifest,
// never accepted from the submission alongside the registry. Pinned emission
// input bytes can then serve as replay authority after their digest is checked.
// Return a frozen copy so the consumer cannot compile a mutated candidate later.
export function verifyFamilyTrivia({family,registry},trustedHandle) {
  assert(trustedHandle?.version===TRIVIA_AUTH_VERSION,'trivia_trusted_handle_required');
  assert(canonical(handleFor(family,registry))===canonical(trustedHandle),'trivia_authentication');
  validateTriviaRegistry(registry,new Map(sourceTurns(family).map(t=>[t.turn_id,t])),registry.emission_inputs);
  return immutable(structuredClone(registry));
}

import {isContractProjection} from './contract-projection-a4.mjs';
import {canonical,hash,fail} from './common.mjs';

import {readFileSync} from 'node:fs';

// One registry per family, populated before arm fan-out in first-appearance
// order. Keys are used only for equality, never parsed, hashed or sorted.
export function sourceOrderAliases(events=[]) {
  const records=new Map(),nodes=new Map();
  const assign=(map,key,prefix)=>{if(!map.has(key))map.set(key,prefix+(map.size+1));return map.get(key);};
  const id=key=>{if(!records.has(key))fail('unregistered_reader_identity');return records.get(key);};
  const node=(record,key)=>{id(record);const map=nodes.get(record);if(!map?.has(key))fail('unregistered_reader_node');return map.get(key);};
  const register=incoming=>{for(const e of incoming) {
    assign(records,e.event_id,'r');if(!nodes.has(e.event_id))nodes.set(e.event_id,new Map());
    for(const n of e.reason_nodes??[])assign(nodes.get(e.event_id),n.id,'n');
    for(const edge of e.reason_edges??[])for(const key of [edge.from,edge.to])assign(nodes.get(e.event_id),key,'n');
  }};
  register(events);
  return {register,id,node,diagnostics:()=>[...records].map(([internal_key,reader_id])=>({internal_key,reader_id,nodes:[...nodes.get(internal_key)].map(([private_id,reader_id])=>({private_id,reader_id}))}))};
}

export const PRIVATE_FIELD_INVENTORY=JSON.parse(readFileSync(new URL('./reports/private-field-inventory-a6.json',import.meta.url)));
const privateFieldNames=new Set(PRIVATE_FIELD_INVENTORY.fields.flatMap(f=>f.variants).map(name=>name.replace(/[^a-z0-9]/gi,'').toLowerCase()));
const privateField=key=>privateFieldNames.has(key.replace(/[^a-z0-9]/gi,'').toLowerCase());
const identifierPatterns=[
  ['split_identifier',/\b(?:pilot|engineering|development|test)(?:[-_:/][a-z0-9_.:/-]+)\b/i],
  ['condition_identifier',/\b(?:correction|reversal|refinement|scope_change|expiry|unchanged)[-_](?:L\d|W\d|R\d)[a-z0-9_.:/-]*\b/i],
  ['lineage_identifier',/\bL\d{2}(?:-R\d+)?-W\d+\b/i],
  ['private_condition_code',/\b(?:two_edge_serial|three_edge_serial|conjunctive_mediated|alternative_mediated|authored_rationale_topology|reason_strata)\b/i],
];

export function privateLabels(family={}) {
  return [...new Set([family.family_id,family.lineage_id,family.seed,family.schema_version,
    family.namespace?.ownerId,family.namespace?.projectId,...(family.private_labels??[]),
    ...Object.entries(family).filter(([key,value])=>typeof value==='string'&&/(?:_id|Id|_label)$/.test(key)).map(([,value])=>value)].filter(x=>typeof x==='string'&&x))];
}

// Inspect the complete serialized body and decoded nested JSON strings. This
// does not rewrite inputs, redact evidence, or whitelist particular records.
// Public semantic terms (e.g. extracted change_type: correction, or "Expiry"
// in the frozen system prompt) are not private author-assigned identifiers.
export function findPrivateLabels(value,labels=[]) {
  const hits=[],seen=new Set();
  function inspect(text,path) {
    text=text.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\"/g,'"');
    for(const label of labels)if(text.toLowerCase().includes(label.toLowerCase()))add('private_identifier',label,path);
    for(const match of text.matchAll(/["']([^"']+)["']\s*:/g))if(privateField(match[1]))add('private_metadata_key',match[1],path);
    for(const [kind,pattern] of identifierPatterns){const match=text.match(pattern);if(match)add(kind,match[0],path);}
  }
  function add(kind,label,path){const key=canonical([kind,label,path]);if(!seen.has(key)){seen.add(key);hits.push({kind,label,path});}}
  // A-4 contract metadata is public only at this explicit boundary and only
  // after exact deterministic re-projection. No global key exemption is added.
  function publicView(v,depth=0) {
    if(depth>20)fail('private_label_scan_depth');
    if(typeof v==='string'&&v.includes('\nCURRENT\n')){const at=v.indexOf('\nCURRENT\n');try{return JSON.stringify(publicView(JSON.parse(v.slice(0,at)),depth+1))+v.slice(at);}catch(error){if(error.code)throw error;}}
    if(typeof v==='string'&&/^[\s]*[\[{]/.test(v)){try{return JSON.stringify(publicView(JSON.parse(v),depth+1));}catch(error){if(error.code)throw error;}}
    if(Array.isArray(v))return v.map(x=>publicView(x,depth+1));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='public_contract'&&isContractProjection(x)?{}:publicView(x,depth+1)]));
    return v;
  }
  value=publicView(value);
  inspect(typeof value==='string'?value:JSON.stringify(value),'$wire');
  function visit(v,path,depth=0) {
    if(depth>20)fail('private_label_scan_depth');
    if(typeof v==='string') {
      inspect(v,path);
      if(/^[\s]*[\[{]/.test(v)){let parsed;try{parsed=JSON.parse(v);}catch{return;}visit(parsed,path+'#json',depth+1);}
    } else if(Array.isArray(v))v.forEach((x,i)=>visit(x,path+'/'+i,depth+1));
    else if(v&&typeof v==='object')for(const [key,child] of Object.entries(v)){if(privateField(key))add('private_metadata_key',key,path);visit(child,path+'/'+key,depth+1);}
  }
  visit(value,'$');return hits;
}

export class PrivacyGuard {
  constructor(family={}){this.labels=privateLabels(family);this.scans=[];}
  check(kind,value,metadata={}) {
    const hits=findPrivateLabels(value,this.labels);
    this.scans.push({kind,...metadata,sha256:hash(value),hits});
    if(hits.length)fail('private_label_leak:'+kind);
    return value;
  }
  report(){return {version:'hr3-private-label-scan-a4-v1',inventorySHA256:hash(PRIVATE_FIELD_INVENTORY),scans:this.scans.length,hits:this.scans.reduce((n,r)=>n+r.hits.length,0),records:this.scans};}
}

// These are authored control assertions, not redactions of P's returned text.
// The same neutral assertion is used for initial admission and named replay;
// edits, dependency changes, forgetting and foreign isolation keep their roles.
export function neutralControl(control) {
  const out=structuredClone(control);
  if(out.kind==='card') {
    const title='Independent invoice procedure';
    const body='Independent invoice control: invoice seal Q is required. This assertion concerns invoices only.';
    const newer=body.replace('is required','must be blue');
    for(const [i,action] of out.actions.entries()) {
      const p=action.payload;
      action.actionId=`invoice-action-${i+1}`;
      if(p.actionId)p.actionId=action.actionId;
      if(Object.hasOwn(p,'title'))p.title=title;
      if(action.call==='createCardDraft')p.input={...p.input,title,body,authoredInput:{...p.input.authoredInput,text:body}};
      if(action.call==='editKnowledgeCard')p.body=newer;
    }
    for(const cp of out.checkpoints??[])if(cp.body)cp.body=cp.overwrittenBodyRecoverable===false?newer:body;
  } else if(out.kind==='named_forget_replay_foreign') {
    const content='Synthetic independent seal record Q; never a focal decision.';
    for(const [i,action] of out.actions.entries()) {
      action.actionId=`seal-action-${i+1}`;
      if(action.call==='admit')action.content=action.returns?.includes('foreignRecord')?'Foreign-only seal Q':action.returns?.includes('independentCopy')?'Independent copy: '+content:content;
    }
  } else fail('unknown_control_authoring');
  return out;
}

export function namespaceAliases(own) {
  const aliases=new Map(),publicValues=new Set();
  function namespace(ns) {
    const key=canonical(ns);if(publicValues.has(key))return ns;
    if(!aliases.has(key)) {
      const n=aliases.size+1,alias={ownerId:`owner-${n}`,scope:ns.scope,projectId:ns.projectId===null?null:`project-${n}`};
      aliases.set(key,alias);publicValues.add(canonical(alias));
    }
    return structuredClone(aliases.get(key));
  }
  const publicOwn=namespace(own);
  function payload(v) {
    if(Array.isArray(v))return v.map(payload);
    if(v&&typeof v==='object') {
      if(typeof v.ownerId==='string'&&Object.hasOwn(v,'scope')&&Object.hasOwn(v,'projectId'))return namespace(v);
      return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,payload(x)]));
    }
    return v;
  }
  return {own:publicOwn,payload,diagnostics:()=>[...aliases].map(([privateNamespace,publicNamespace])=>({privateNamespace:JSON.parse(privateNamespace),publicNamespace}))};
}

import {canonical,hash,fail} from './common.mjs';

// Private global keys are never emitted. The same opaque alias is used for a
// record and all references to it; graph node aliases are local to that record.
export const readerId=key=>'r'+hash(String(key)).slice(0,32);
export const readerNodeId=(record,node)=>'n'+hash([record,node]).slice(0,32);

const identifierPatterns=[
  ['split_identifier',/\b(?:pilot|engineering|development|test)(?:[-_:/][a-z0-9_.:/-]+)?\b/i],
  ['condition_identifier',/\b(?:correction|reversal|refinement|scope_change|expiry|unchanged)[-_](?:L\d|W\d|R\d)[a-z0-9_.:/-]*\b/i],
  ['lineage_identifier',/\bL\d{2}(?:-R\d+)?-W\d+\b/i],
  ['private_condition_code',/\b(?:two_edge_serial|three_edge_serial|conjunctive_mediated|alternative_mediated|authored_rationale_topology|reason_strata)\b/i],
  ['private_metadata_key',/["'](?:family_id|lineage_id|familyId|lineageId|causal_class|split|schema_version|seed|fixture_id|bank_id|world_id|allocation_id|condition_id|change_type_id|case_id|private_label|authored_change_type)["']\s*:/i],
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
    for(const [kind,pattern] of identifierPatterns){const match=text.match(pattern);if(match)add(kind,match[0],path);}
  }
  function add(kind,label,path){const key=canonical([kind,label,path]);if(!seen.has(key)){seen.add(key);hits.push({kind,label,path});}}
  inspect(typeof value==='string'?value:JSON.stringify(value),'$wire');
  function visit(v,path,depth=0) {
    if(depth>20)fail('private_label_scan_depth');
    if(typeof v==='string') {
      inspect(v,path);
      if(/^[\s]*[\[{]/.test(v)){let parsed;try{parsed=JSON.parse(v);}catch{return;}visit(parsed,path+'#json',depth+1);}
    } else if(Array.isArray(v))v.forEach((x,i)=>visit(x,path+'/'+i,depth+1));
    else if(v&&typeof v==='object')for(const [key,child] of Object.entries(v))visit(child,path+'/'+key,depth+1);
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
  report(){return {version:'hr3-private-label-scan-v1',scans:this.scans.length,hits:this.scans.reduce((n,r)=>n+r.hits.length,0),records:this.scans};}
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

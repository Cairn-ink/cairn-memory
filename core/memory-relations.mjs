import { unionMemoryRelationCandidates } from './memory-relations-vectors.mjs';
import { readFileSync } from 'node:fs';
import { modelPortValue } from './model-budget.mjs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fittingCap, prefixUnits, requestFits } from './model-packing.mjs';
import { tokenizeT1 } from './context-read-tokenize.mjs';

const system=readFileSync(new URL('./prompts/relate-memories.md',import.meta.url),'utf8');
const relations=new Set(['supersedes','contradicts','refines','causes']);
const marker=/\b(?:stopped|no longer|not anymore|never|quit|switched to|instead of|do not|don't|doesn't|not)\b|不再|不吃了|改成|換成|停止|不喜歡|不需要|不喝了/iu;
const stop=new Set(['i','my','me','the','a','an','am','is','are','was','to','of','and','now','like','likes','eat','eating','drink','drinking','我','了']);
export function relationJaccard(left,right){
 const tokens=text=>new Set(tokenizeT1(text.replace(marker,' ')).filter(t=>!stop.has(t)));
 const a=tokens(left),b=tokens(right),union=new Set([...a,...b]);
 return union.size?[...a].filter(t=>b.has(t)).length/union.size:0;
}
export function ruleRelation(fact,candidates){
 const candidate=candidates[0];
 return candidate&&marker.test(fact.content)&&relationJaccard(fact.content,candidate.content)>=0.5
  ?[{candidateId:candidate.id,relation:'contradicts',confidence:0.3}]:[];
}
const instant=value=>{
 if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 const normalized=new Date(value).toISOString();
 return normalized.slice(0,19)===value.slice(0,19)?normalized:null;
};
export async function relateCapturedMemories({model,items,operations,deadline,validateFresh}){
 if(!items.length)return [];
 try{
  const lexical=operations.relationCandidates(items);
  const candidates=await unionMemoryRelationCandidates(operations.relationNamespace,items,lexical,operations.resolveRelationCandidates,operations.relationIdentity,deadline,validateFresh);
  const assertFresh=()=>{
   validateFresh?.();
   if(typeof operations.resolveRelationCandidates!=='function')return;
   const expected=new Map(candidates.flat().map(candidate=>[candidate.id,candidate]));
   if(!expected.size)return;
   const current=operations.resolveRelationCandidates([...expected.values()]);
   if(current.length!==expected.size||current.some(candidate=>JSON.stringify(candidate)!==JSON.stringify(expected.get(candidate.id))))throw Error('stale_memory_relations');
  };
  assertFresh();
  const facts=items.map((item,factIndex)=>({factIndex,content:item.content,
   eventTime:item.receiptTimes?.filter(Boolean).sort().at(-1)??null}));
  const keyed=typeof modelPortValue(model,'relateMemories','model_not_configured')==='function';
  let request={facts,candidates};
  // Retain admission time even when relation discovery times out. The parent
  // capture deadline still owns the transaction and all source fences.
  const remaining=deadline?.remainingMs()??30000;
  if(keyed&&remaining<250)return [];
  const reserve=Math.min(1000,Math.max(100,remaining*.25));
  const end=performance.now()+Math.min(5000,remaining-reserve);
  const relationDeadline={remainingMs:()=>Math.max(0,end-performance.now()),expired:()=>performance.now()>=end};
  if(keyed){
   const measure=requestFits(model,'relateMemories',deadline);
   const fits=(prompt,input)=>{assertFresh();const value=measure(prompt,input);assertFresh();return value;};
   if(!fits(system,request)){
    const view=cap=>({facts,candidates:candidates.map(rows=>rows.map(row=>({...row,content:prefixUnits(row.content,cap)})))});
    const longest=Math.max(120,...candidates.flatMap(rows=>rows.map(row=>row.content.length)));
    const cap=fittingCap(longest,units=>fits(system,view(units)));
    if(cap!==null)request=view(cap);
    else{
     request=view(120);
     while(!fits(system,request)&&request.candidates.some(rows=>rows.length)){
      const longest=request.candidates.reduce((best,rows,index)=>rows.length>request.candidates[best].length?index:best,0);
      request.candidates[longest].pop();
     }
     if(!fits(system,request))throw new Error('relation_budget');
    }
   }
  }
  const output=keyed?await callModel(model,'relateMemories',system,request,
   {failureCode:'invalid_model_output',deadline:relationDeadline,validateFresh:assertFresh}):{facts:facts.map(fact=>({factIndex:fact.factIndex,eventTime:null,edges:ruleRelation(fact,candidates[fact.factIndex])}))};
  if(!output||!Array.isArray(output.facts)||output.facts.length>items.length)throw new Error('invalid_relation_output');
  const result=[],seenFacts=new Set();
  for(const fact of output.facts){
   if(!Number.isSafeInteger(fact?.factIndex)||!facts[fact.factIndex]||seenFacts.has(fact.factIndex)||!Array.isArray(fact.edges)||fact.edges.length>8)continue;
   seenFacts.add(fact.factIndex);
   if(fact.eventTime!=null&&!instant(fact.eventTime))continue;
   const time=instant(fact.eventTime)??instant(facts[fact.factIndex].eventTime)??new Date().toISOString();
   result.push({factIndex:fact.factIndex,eventTime:time,timingOnly:true});
   const seen=new Set();let count=0;
   for(const edge of fact.edges){
    const candidate=(keyed?request.candidates:candidates)[fact.factIndex].find(c=>c.id===edge?.candidateId);
    if(!candidate||seen.has(candidate.id)||!relations.has(edge.relation)||typeof edge.confidence!=='number'||!Number.isFinite(edge.confidence)||edge.confidence<0||edge.confidence>1)continue;
    seen.add(candidate.id);
    if(count++>=5)break;
    let relation=edge.relation;
    if(relation==='supersedes'&&(edge.confidence<0.6||time<candidate.eventTime))relation='contradicts';
    result.push({factIndex:fact.factIndex,candidateId:candidate.id,candidateRevision:candidate.revision,
     relation,confidence:edge.confidence,decidedBy:keyed?'llm':'rule',eventTime:time});
   }
  }
  return result;
 }catch(error){
  emitDiagnostic(model,'relateMemories','core_validation','invalid_memory_relations');
  return [];
 }
}

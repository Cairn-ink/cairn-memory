import { unionMemoryRelationCandidates } from './memory-relations-vectors.mjs';
import { readFileSync } from 'node:fs';
import { modelPortValue } from './model-budget.mjs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fittingCap, prefixUnits, requestFits } from './model-packing.mjs';
import { tokenizeT1 } from './context-read-tokenize.mjs';

const system=readFileSync(new URL('./prompts/relate-memories.md',import.meta.url),'utf8');
const relations=new Set(['supersedes','contradicts','refines','causes']);
// Neutral topic matching only. No polarity or replacement claim is made here.
export const SAME_THREAD_THRESHOLD = 0.8;
const noise = /\b(?:i|my|me|the|a|an|am|is|are|was|were|to|of|and|now|still|no|longer|not|never|do|does|dont|like|likes|love|loves|enjoy|enjoys|prefer|prefers|eat|eats|eating|drink|drinks|drinking|stopped)\b|不再|不|每天|喜歡|喜爱|愛吃|愛|吃|喝|我|了/giu;
function topic(text) {
 const value=text.normalize('NFKC').toLowerCase().replace(/[’']/g,'')
  .replace(/^(?:the user|user)\b/u,'i').replace(/^(?:使用者|用戶)/u,'我');
 const relative=value.match(/\bmy\s+(brother|sister|mother|father|friend|partner|wife|husband)\b|我(?:的)?(哥哥|弟弟|姊姊|姐姐|妹妹|媽媽|爸爸|朋友|伴侶)/u);
 const possessive=value.match(/^my\s+(.+?)\s+(?:likes|loves|enjoys|prefers|eats|drinks|does)\b/u)?.[1]
  ??value.match(/^我(?:的)?(?!因為|由於|不|現在|以前|每天)(.{1,8}?)(?:喜歡|愛吃|偏好)/u)?.[1];
 // A complete named property retains its subject even when its value changes.
 const owned=value.match(/^my\s+(.+?)\s+(?:is|was|has changed to|changed to)\b/u)?.[1]
   ??value.match(/^我的(.+?)(?:是|改成|換成)/u)?.[1];
 const named=owned?null:value.match(/^(?!(?:i|it|this|that|he|she|they)\b)(.{2,80}?)\s+(?:is|was|are|were|changed to)\b/u)?.[1]
   ??value.match(/^([^。！？.!?]{2,80}?)(?:是|改成|換成)/u)?.[1];
 const property=owned??named?.replace(/^the\s+/u,'');
 const subject=/\b(?:think|believe|said|says)\b|認為|覺得/u.test(value)?null:named?'topic':possessive?'relative:'+possessive:relative?'relative:'+(relative[1]??relative[2]):/^(?:i\b|my\b|me\b|我)/u.test(value)?'self':null;
 const tail=value.split(/\bbecause\b|\bdue to\b|因為|由於/u)[0];
 const object=value.match(/(?:喜歡|愛吃|偏好|改吃)(.+)/u)?.[1];
 const tokens=new Set(tokenizeT1((object??tail).replace(noise,' ')).filter(token=>token.length>1));
 return {subject,property,tokens};
}
export function relationJaccard(left,right){
 const a=topic(left).tokens,b=topic(right).tokens,union=new Set([...a,...b]);
 return union.size?[...a].filter(token=>b.has(token)).length/union.size:0;
}
export function sameThreadScore(left,right){
 const a=topic(left),b=topic(right);
 if(!a.subject||a.subject!==b.subject)return 0;
 if(a.property&&b.property)return a.property===b.property?1:0;
 const common=[...a.tokens].filter(token=>b.tokens.has(token));
 // Require a specific anchor, not just a shared generic noun or a pronoun.
 if(common.length<2&&!common.some(token=>/\p{Script=Han}{2}/u.test(token)))return 0;
 return common.length/Math.max(1,Math.max(a.tokens.size,b.tokens.size));
}
export function ruleRelation(fact,candidates){
 return candidates.map(candidate=>({candidateId:candidate.id,relation:'same_thread',
  confidence:sameThreadScore(fact.content,candidate.content)}))
  .filter(edge=>edge.confidence>=SAME_THREAD_THRESHOLD).slice(0,5);
}
const instant=value=>{
 if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 const normalized=new Date(value).toISOString();
 return normalized.slice(0,19)===value.slice(0,19)?normalized:null;
};
export async function relateCapturedMemories({model,items,operations,deadline,validateFresh}){
 if(!items.length)return [];
 const facts=items.map((item,factIndex)=>({factIndex,content:item.content,
  eventTime:instant(item.receiptTimes?.filter(Boolean).sort().at(-1))??new Date().toISOString()}));
 let candidates=items.map(()=>[]);
 const fallback=()=>facts.flatMap(fact=>[{factIndex:fact.factIndex,eventTime:fact.eventTime,timingOnly:true},
  ...ruleRelation(fact,candidates[fact.factIndex]).map(edge=>({...edge,factIndex:fact.factIndex,
   candidateRevision:candidates[fact.factIndex].find(row=>row.id===edge.candidateId).revision,decidedBy:'rule',eventTime:fact.eventTime}))]);
 try{
  const lexical=operations.relationCandidates(items);
  const otherFacts=(rows,index)=>rows.filter(candidate=>candidate.content!==items[index].content).slice(0,8);
  candidates=lexical.map(otherFacts);
  candidates=await unionMemoryRelationCandidates(operations.relationNamespace,items,lexical,operations.resolveRelationCandidates,operations.relationIdentity,deadline,validateFresh);
  candidates=candidates.map(otherFacts);
  const assertFresh=()=>{
   validateFresh?.();
   if(typeof operations.resolveRelationCandidates!=='function')return;
   const expected=new Map(candidates.flat().map(candidate=>[candidate.id,candidate]));
   if(!expected.size)return;
   const current=operations.resolveRelationCandidates([...expected.values()]);
   if(current.length!==expected.size||current.some(candidate=>JSON.stringify(candidate)!==JSON.stringify(expected.get(candidate.id))))throw Error('stale_memory_relations');
  };
  assertFresh();
  const keyed=typeof modelPortValue(model,'relateMemories','model_not_configured')==='function';
  let request={facts,candidates};
  // Retain admission time even when relation discovery times out. The parent
  // capture deadline still owns the transaction and all source fences.
  const remaining=deadline?.remainingMs()??30000;
  if(keyed&&remaining<250)return fallback();
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
  if(!keyed)return fallback();
  const output=await callModel(model,'relateMemories',system,request,
   {failureCode:'invalid_model_output',deadline:relationDeadline,validateFresh:assertFresh});
  if(!output||!Array.isArray(output.facts)||output.facts.length>items.length)throw new Error('invalid_relation_output');
  const result=facts.map(fact=>({factIndex:fact.factIndex,eventTime:fact.eventTime,timingOnly:true})),seenFacts=new Set();
  for(const fact of output.facts){
   if(!Number.isSafeInteger(fact?.factIndex)||!facts[fact.factIndex]||seenFacts.has(fact.factIndex)||!Array.isArray(fact.edges)||fact.edges.length>8)throw new Error('invalid_relation_output');
   seenFacts.add(fact.factIndex);
   const time=facts[fact.factIndex].eventTime;
   const seen=new Set();let count=0;
   for(const edge of fact.edges){
    const candidate=(keyed?request.candidates:candidates)[fact.factIndex].find(c=>c.id===edge?.candidateId);
    if(!candidate||seen.has(candidate.id)||!relations.has(edge.relation)||typeof edge.confidence!=='number'||!Number.isFinite(edge.confidence)||edge.confidence<0||edge.confidence>1)continue;
    seen.add(candidate.id);
    if(count++>=5)break;
    const relation=edge.relation;
    if(relation==='supersedes'&&edge.confidence<0.6)continue;
    result.push({factIndex:fact.factIndex,candidateId:candidate.id,candidateRevision:candidate.revision,
     relation,confidence:edge.confidence,decidedBy:'llm',eventTime:time,
     reason:typeof edge.reason==='string'&&edge.reason.isWellFormed()?Array.from(edge.reason.replace(/\0/g,'')).slice(0,600).join(''):null});
   }
  }
  return result;
 }catch(error){
  emitDiagnostic(model,'relateMemories','core_validation','invalid_memory_relations');
  return fallback();
 }
}

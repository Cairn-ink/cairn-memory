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
const noise = /\b(?:i|my|me|the|a|an|am|is|are|was|were|to|of|and|now|still|no|longer|not|never|do|does|dont|like|likes|love|loves|enjoy|enjoys|prefer|prefers|eat|eats|eating|drink|drinks|drinking|stopped|avoid|avoids|avoiding|usually|often)\b|現在|目前|已經|以前|戒掉|避免|停止|不再|不|每天|喜歡|喜爱|愛吃|愛|吃|喝|我|了/giu;
function topic(text) {
 let value=text.normalize('NFKC').toLowerCase().replace(/[’']/g,'')
  .replace(/^(?:the user|user)\b/u,'i').replace(/^(?:使用者|用戶)/u,'我');
 // Temporal/frequency modifiers belong to the self assertion, not to a named
 // relative (for example, 我最近喜歡 vs 我妹妹喜歡).
 value=value.replace(/^我(?:(?:現在|目前|最近|以前|已經|還是|仍然|每天|常常|通常|一直|偶爾|週末|每週[一二三四五六日]|早上|晚上|午餐|早餐|暫時|完全|後來|不再|不|很|都|也|會))+/u,'我');
 // Ignore an explanatory tail, but keep a leading reason before the predicate.
 const beforeReason=value.split(/\bbecause\b|\bdue to\b|因為|由於/u)[0];
 if(tokenizeT1(beforeReason.replace(noise,' ')).some(token=>token.length>1))value=beforeReason;
 const relative=value.match(/\bmy\s+(brother|sister|mother|father|friend|partner|wife|husband)\b|我(?:的)?(哥哥|弟弟|姊姊|姐姐|妹妹|媽媽|爸爸|朋友|伴侶)/u);
 const possessive=value.match(/^my\s+(.+?)\s+(?:likes|loves|enjoys|prefers|eats|drinks|does)\b/u)?.[1]
  ??value.match(/^我(?:的)?(?!因為|由於|不|現在|以前|每天)(.{1,8}?)(?:喜歡|愛吃|偏好)/u)?.[1];
 // A complete named property retains its subject even when its value changes.
 const owned=value.match(/^my\s+(.+?)\s+(?:is|was|has changed to|changed to)\b/u)?.[1]
   ??value.match(/^我的(.+?)(?:是|改成|換成)/u)?.[1];
 const named=owned?null:value.match(/^(?!(?:i|it|this|that|he|she|they)\b)(.{2,80}?)\s+(?:is|was|are|were|changed to)\b/u)?.[1]
   ??value.match(/^([^。！？.!?]{2,80}?)(?:是|改成|換成)/u)?.[1];
 const ownedProperty=owned&&(owned.includes('的')||/^my\s+.+?(?:['’]s|s['’])\s+\S/iu.test(text.normalize('NFKC')));
 const ownedEntity=owned&&!ownedProperty&&/^(?:brother|sister|mother|father|friend|partner|wife|husband|cat|dog|manager|colleague|boss|哥哥|弟弟|姊姊|姐姐|妹妹|媽媽|爸爸|朋友|伴侶|同事|主管|貓|狗)(?:\s.*|\p{Script=Han}{1,4})?$/u.test(owned);
 const predicate=value.replace(/^.*?(?:\bis\b|\bwas\b|是)/u,'').trim();
 const slot=/\b(?:manager|colleague|coworker|boss)\b|同事|主管/u.test(predicate)?'work-role':
  /\ballergic\b|過敏/u.test(predicate)?'allergy':/\b(?:vegetarian|vegan)\b|素食/u.test(predicate)?'diet':null;
 const property=owned&&!ownedEntity?owned:(named||ownedEntity)&&slot?slot:null;
 const subject=/\b(?:think|believe|said|says)\b|認為|覺得/u.test(value)?null:named||ownedEntity?'entity:'+(named??'my '+owned).replace(/^the\s+/u,''):possessive?'relative:'+possessive:relative?'relative:'+(relative[1]??relative[2]):/^(?:i\b|my\b|me\b|我)/u.test(value)?'self':null;
 const tail=value;
 const object=tail.match(/(?:喜歡|愛吃|偏好|改吃)(.+)/u)?.[1];
 const tokens=new Set(tokenizeT1((object??tail).replace(noise,' ')).filter(token=>token.length>1&&!/^(?:food|things?|stuff|something|anything|everything|people|life|time|work|good|bad|daily|東西|事情|食物|生活)$/u.test(token))
  // Local inflection normalization; the frozen retrieval tokenizer is unchanged.
  .map(token=>/^[a-z]{5,}$/u.test(token)?token.replace(/(?:ing|ed)$/u,'').replace(/e$/u,''):token));
 // A preference about buying/price/preparation is not the consumption claim.
 const focus=value.match(/\b(buying|buy|price|cost|cooking)\b|價格|價錢|買|煎/u)?.[0]??null;
 const destination=value.match(/\bto\s+([a-z]+)\b|去(\p{Script=Han}{2})(?=[。！？了，,]|$)/u)?.[0]??null;
 const preference=/^(?:i\b|我)/u.test(value)&&/\b(?:like|love|enjoy|prefer|eat|drink|stopped|avoid)\b|喜歡|愛吃|吃|喝|戒掉/u.test(value);
 const englishObject=value.match(/\b(?:like|love|enjoy|prefer|eat|drink|stopped|avoid)\s+(?:(?:eating|drinking)\s+)?(.+)/u)?.[1];
 const singleEnglishObject=/^[a-z]+[\s.!?]*$/u.test((englishObject??'').replace(/^(?:a|an|the)\s+/u,'').trim());
 return {subject,property,tokens,focus,destination,preference,singleEnglishObject};
}
export function relationJaccard(left,right){
 const a=topic(left).tokens,b=topic(right).tokens,union=new Set([...a,...b]);
 return union.size?[...a].filter(token=>b.has(token)).length/union.size:0;
}
export function sameThreadScore(left,right){
 const a=topic(left),b=topic(right);
 if(!a.subject||a.subject!==b.subject||a.focus!==b.focus)return 0;
 if(a.destination&&b.destination&&a.destination!==b.destination)return 0;
 if(a.property||b.property)return a.property===b.property?1:0;
 if(a.subject.startsWith('entity:'))return 0;
 const common=[...a.tokens].filter(token=>b.tokens.has(token));
 // Require a specific anchor, not just a shared generic noun or a pronoun.
 if(common.length<2&&!common.some(token=>/\p{Script=Han}{2}/u.test(token))
  &&!(a.preference&&b.preference&&a.singleEnglishObject&&b.singleEnglishObject
   &&common.some(token=>/^[a-z]{3,}$/u.test(token))))return 0;
 return common.length/Math.max(1,Math.min(a.tokens.size,b.tokens.size));
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
export async function relateCapturedMemories(input){
 if(!input.items.length)return [];
 // Keep admission's complete batch for suppression accounting. Relation work
 // sees only admissible facts; compact port indices map back to that batch.
 const indices=input.operations.filterRelationFacts?.(input.items)??input.items.map((_,index)=>index);
 const items=indices.map(index=>input.items[index]);
 if(!items.length)return Object.defineProperty([],'decisionComplete',{value:true});
 const validateFresh=()=>{
  input.validateFresh?.();
  const current=input.operations.filterRelationFacts?.(items);
  if(current&&current.length!==items.length)throw Error('stale_memory_relations');
 };
 const result=await relateEligibleMemories({...input,items,validateFresh});
 const mapped=result.map(edge=>({...edge,factIndex:indices[edge.factIndex]}));
 return result.decisionComplete?Object.defineProperty(mapped,'decisionComplete',{value:true}):mapped;
}
async function relateEligibleMemories({model,items,operations,deadline,validateFresh}){
 if(!items.length)return [];
 const facts=items.map((item,factIndex)=>({factIndex,content:item.content,
  eventTime:instant(item.receiptTimes?.filter(Boolean).sort().at(-1))??new Date().toISOString()}));
 let candidates=items.map(()=>[]),interpreted=false;
 const fallback=()=>{const result=facts.flatMap(fact=>[{factIndex:fact.factIndex,eventTime:fact.eventTime,timingOnly:true},
  ...ruleRelation(fact,candidates[fact.factIndex]).map(edge=>({...edge,factIndex:fact.factIndex,
   candidateRevision:candidates[fact.factIndex].find(row=>row.id===edge.candidateId).revision,decidedBy:'rule',eventTime:fact.eventTime}))]);
  return interpreted?Object.defineProperty(result,'decisionComplete',{value:true}):result;
 };
 try{
  const keyed=typeof modelPortValue(model,'relateMemories','model_not_configured')==='function';
  // A neutral edge requires a recognized subject on both ends. When no fact
  // has one, discovery cannot produce an edge and must not add read statements.
  if(!keyed&&facts.every(fact=>!topic(fact.content).subject))return fallback();
  const lexical=operations.relationCandidates(items);
  const otherFacts=(rows,index)=>rows.filter(candidate=>candidate.content!==items[index].content).slice(0,8);
  candidates=lexical.map(otherFacts);
  candidates=await unionMemoryRelationCandidates(operations.relationNamespace,items,lexical,operations.resolveRelationCandidates,operations.relationIdentity,deadline,validateFresh);
  candidates=candidates.map(otherFacts);
  // Optional relation interpretation must not fall back to predecessor retirement
  // after a candidate changes while the provider is running. Admission still
  // validates source, lease and stream high-water; insertion rechecks endpoints.
  const assertFresh=()=>{
   validateFresh?.();
   if(typeof operations.resolveRelationCandidates!=='function')return;
   const expected=new Map(candidates.flat().map(candidate=>[candidate.id,candidate]));
   if(!expected.size)return;
   const current=operations.resolveRelationCandidates([...expected.values()]);
   if(current.length!==expected.size||current.some(candidate=>JSON.stringify(candidate)!==JSON.stringify(expected.get(candidate.id)))){
    interpreted=keyed;
    throw Error('stale_memory_relations');
   }
  };
  assertFresh();
  // There is nothing to label without an existing eligible endpoint. Preserve
  // the ordinary capture's model request count and retain only its clock hint.
  if(candidates.every(rows=>!rows.length))return fallback();
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
     // A retained reason may depend only on this edge's two endpoints.
     // Batch decisions remain useful, but their untracked prose is discarded.
     reason:request.facts.length===1&&request.candidates.length===1&&request.candidates[0].length===1&&typeof edge.reason==='string'&&edge.reason.isWellFormed()?Array.from(edge.reason.replace(/\0/g,'')).slice(0,600).join(''):null});
   }
  }
  // An explicit unrelated decision still completes relation interpretation.
  // Keep this orchestration marker out of the persisted edge proposals.
  return Object.defineProperty(result,'decisionComplete',{value:true});
 }catch(error){
  emitDiagnostic(model,'relateMemories','core_validation','invalid_memory_relations');
  return fallback();
 }
}

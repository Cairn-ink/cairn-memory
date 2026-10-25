import { assert, canonical, sha256 } from './common.mjs';
import { sentence } from './bank.mjs';
import { publicContract, HISTORICAL_LABELS } from './contract.mjs';
import { namingPool } from './inventory.mjs';

// Independently authored engineering counterfactuals. No pilot text, routes,
// quantities, source spans, answers or mappings are imported into these worlds.
export function matchedWorlds() {
  return ['en','zh-Hant','mixed'].flatMap(language=>['route','approval','cap','history','reason','replacement'].map(axis=> {
    const question=sentence('question',language==='mixed'?'zh-Hant':language,{batch:2,at:'2033-06-01T02:00:00.000Z',subject:'engineering example',predicate:'dispatch configuration',scope:'all 12 cells',turn:'turn-y',predecessors:'turn-x (record mona)',labels:HISTORICAL_LABELS.join(' | ')});
    const base={route:'qeta',approval:true,cap:{decimal:'72',unit:'requests/day'},history:'previously_adopted',reason:'stated'};
    const a={...base},b=structuredClone(base);
    if(axis==='route') b.route='voxi';
    if(axis==='approval') b.approval=false;
    if(axis==='cap') b.cap.decimal='96';
    if(axis==='history') b.history='erroneous';
    if(axis==='reason') b.reason='not_stated';
    if(axis==='replacement') b.cap=null;
    const source=answer=>language==='en' ? `Adopt route ${answer.route}; approval ${answer.approval}; cap ${answer.cap?answer.cap.decimal+' requests/day':'not specified'}. Predecessor is ${answer.history==='erroneous'?'erroneous, never adopted':'previously adopted'}. ${answer.reason==='stated'?'Cable damage caused this switch.':'No reason was stated.'}` : `${language==='mixed'?'Adopt record nura. ':''}採用路線 ${answer.route}；需經核准 ${answer.approval?'是':'否'}；每日上限 ${answer.cap?answer.cap.decimal:'未指定'}。前身${answer.history==='erroneous'?'有誤，從未採用':'曾採用'}。${answer.reason==='stated'?'電纜損壞造成這次切換。':'沒有說明原因。'}`;
    const row=value=>({scope:{any:[{all:[]}]},valid:{from:'2033-05-31T16:00:00.000Z',to:null},route:{state:'value',value:value.route},approval:{state:'value',value:value.approval},cap:{state:value.cap===null?'not_specified':'value',value:value.cap},citations:[]});
    const wire=value=>({current:{status:'active',rows:[row(value)]},old:{status:'available',records:[{predecessor_turn:'turn-x',status:value.history,rows:[row(base)]}]},reason:{status:value.reason,support:value.reason==='stated'?[{intent:'current',item:0,unit:'body',source:null,quote:language==='en'?'Cable damage caused this switch.':'電纜損壞造成這次切換。',occurrence:1}]:[]}});
    return {language,axis,question,contract:publicContract(),worlds:[a,b].map(value=>({source:source(value)+(language==='en'?' Original record mona claimed route qeta, approval true, cap 72 requests/day. Both records cover all 12 cells with valid interval [2033-05-31T16:00:00.000Z, unbounded). The adopted replacement is complete.':' 原紀錄 mona 記載路線 qeta、需經核准、上限每日 72。兩筆紀錄皆涵蓋全部 12 格，valid 區間為 [2033-05-31T16:00:00.000Z, 無上限)。採用的替代為完整替換。'),answer:wire(value)}))};
  }));
}
export function leakageReport(bundles) {
  const pairs=matchedWorlds();
  for(const pair of pairs) {
    const observations=pair.worlds.map(()=>canonical({question:pair.question,contract:pair.contract}));
    assert(observations[0]===observations[1] && canonical(pair.worlds[0].answer)!==canonical(pair.worlds[1].answer),'matched_world_leakage');
    assert(pair.worlds[0].source!==pair.worlds[1].source,'matched_world_evidence');
    for(const label of HISTORICAL_LABELS)assert(pair.question.includes(label),'question_label_vocabulary');
  }
  const counts={},recordCounts={};
  for(const bundle of bundles) {
    const f=bundle.family,pool=namingPool(f.split),events=f.ast.events.filter(e=>!e.distractor);
    for(const event of events) {
      const key=`${f.change_type}/${event.source_turns[0]}`;recordCounts[key]??={};recordCounts[key][event.record_name]=(recordCounts[key][event.record_name]??0)+1;
    }
    const ids=pool.routes;
    const byVersion=events.filter(e=>e.claims.some(c=>c.field==='value'));
    // Refinement has one supplied route and expiry two independent adoptions.
    for(const [version,event] of byVersion.entries()) {
      const route=event.claims.find(c=>c.field==='value').value.text;
      assert(ids.includes(route),'literal_route');
      const key=`${f.change_type}/${version}`;
      counts[key]??=Object.fromEntries(ids.map(id=>[id,0]));counts[key][route]++;
    }
    for(const cp of f.checkpoints)for(const label of HISTORICAL_LABELS)assert(cp.question.includes(label),'question_label_vocabulary');
  }
  for(const [key,values]of Object.entries(counts))assert(new Set(Object.values(values)).size===1,'route_counterbalance',key);
  for(const [key,values]of Object.entries(recordCounts))assert(Object.keys(values).length===4&&Math.max(...Object.values(values))-Math.min(...Object.values(values))<=1,'record_counterbalance',key);
  const subjectCounts={};
  for(const {family:f} of bundles) {
    const canonicalName=publicContract().aliases.subjects.find(s=>[s.canonical,...s.en,...s['zh-Hant'],...s.mixed].includes(f.header.subject))?.canonical;
    assert(canonicalName,'public_subject_alias');
    subjectCounts[f.change_type]??={};subjectCounts[f.change_type][canonicalName]=(subjectCounts[f.change_type][canonicalName]??0)+1;
  }
  for(const counts of Object.values(subjectCounts))assert(Object.keys(counts).length===6&&new Set(Object.values(counts)).size===1,'subject_counterbalance');
  return {version:'hr3-a4-leakage-v1',matchedPairs:pairs.length,languages:['en','zh-Hant','mixed'],axes:['route','approval','cap','history','reason','replacement'],matchedQuestionsAndContracts:'identical',differentGold:'all pairs',questionContractOnlyDeterministicPairAccuracyUpperBound:0.5,fixtures_sha256:sha256(canonical(pairs)),routeVersionCounts:counts,recordVersionCounts:recordCounts,subjectCounts,scope:'Finite matched-world non-identifiability and identifier balance; not an empirical model-accuracy claim.'};
}

import { isDeepStrictEqual as equal } from 'node:util';
import {goldRanking} from './gold-rank.mjs';
import labels from './labels.json' with {type:'json'};
import { queries,refKey,compareRefs } from './corpus.mjs';
import { candidates,assembly,statusSchema,exactSchema,errorSchema,union } from './schemas.mjs';
import { closedShape,configure,drain } from '../../tools/testing/fixtures/context-product/engine.mjs';
function rowRef(r,type='memory') {return {type,namespace:{ownerId:r.owner_id,scope:r.scope,projectId:r.scope==='personal'?null:r.project_id},[type==='memory'?'memoryId':'cardId']:r.id,revision:r.revision,...(type==='card'?{bodyRevision:r.body_revision}:{})};}
const eligible=(ref,config)=>config.readSet.some(n=>equal(n,ref.namespace));
function probeRefs(targets) {return targets.map(t=>({type:t.type,namespace:t.namespace,[t.type==='memory'?'memoryId':'cardId']:t.id,revision:t.revision,...(t.type==='card'?{bodyRevision:t.bodyRevision}:{})}));}
export async function prepare({cell,config,ledger}) {
  const base={readSet:config.readSet,deadlineMs:config.deadlines.readMs};
  const method=config.method??cell.method??'findCandidates',intent=cell.intent??'current';
  const fixture=labels.fixtures.find(f=>f.count===cell.count&&f.schema===cell.schema);
  const largeAssembly=method==='contextRead'&&ledger.memory.some(r=>r.content.length===4000);
  const definition=queries.find(q=>q.id===(cell.queryId??(largeAssembly?'assembly-'+cell.language:cell.language)))??queries.find(q=>q.id==='mixed');
  const label=fixture?.queries.find(q=>q.id===definition.id);
  let relevant=label?.relevant??[],order=label?.ranking??[],query=definition.query;
  if(!fixture&&!cell.probeBatch&&!config.injectionProbe) {
    // Tiny rehearsals retain the identical authoring order across namespaces.
    const catalog=[...ledger.memory.map(m=>({ref:rowRef(m),text:m.content})),...ledger.cards.filter(c=>c.state==='confirmed').map(c=>({ref:rowRef(c,'card'),text:c.title+'\n'+c.body}))].filter(x=>eligible(x.ref,config));
    order=goldRanking(catalog,definition.query);relevant=definition.knownMiss?ledger.memory.filter(m=>m.content==='中文').map(m=>rowRef(m)):order;
  }
  relevant=relevant.filter(r=>eligible(r,config));order=order.filter(r=>eligible(r,config));
  if(cell.probeBatch){query=cell.probeBatch.query;relevant=probeRefs(cell.probeTargets);order=[];}
  if(config.injectionProbe||cell.injectionProbe){query=config.injectionProbe??cell.injectionProbe;relevant=config.postCatchupIdentity?[rowRef(config.postCatchupIdentity)]:[];order=relevant;}
  const oracleData={relevant,knownMisses:label?.knownMisses??[],order,queryId:definition.id,recallAt5:label?.recallAt5??null,recallAt12:label?.recallAt12??null,probe:!!cell.probeBatch};
  const schemas={findCandidates:candidates(24),contextRead:assembly(24)};
  if(method==='getContextIndexStatus')return {input:{...base,types:config.types,intent},responseSchema:statusSchema,schemas,oracleData};
  if(method==='fetchCandidateEvidence') {
    const refs=selectEvidenceRefs(cell,config,ledger);
    const independent=refs.map(ref=>{const item=ledger.evidence?.find(item=>equal(item.ref,ref));if(!item)throw Error('independent_evidence_missing');return item;});
    const c=await configure(config);let h,expected;
    try {h=await c.open();expected=await h.fetchCandidateEvidence({...base,intent,refs},c.token);if(!expected.ok)throw Error('evidence_preparation:'+expected.error.code);}
    finally{await h?.close();await c.supervisor.close();await drain(c.supervisor);}
    if(!equal(expected.value.items,independent))throw Object.assign(Error('evidence_preparation_mismatch'),{difference:firstDifference(expected.value.items,independent)});
    oracleData.evidence=independent;oracleData.snapshot=expected.value.snapshot;
    const fences=JSON.parse(Buffer.from(expected.value.snapshot.split('.')[0],'base64url')).fences.map(f=>f.slice(0,8));
    const schema=exactSchema({ok:true,value:{items:independent,snapshot:''}});schema.properties.value.properties.snapshot={type:'string',max:16384};
    return {input:cell.adapter==='snapshot'?{...base,snapshot:expected.value.snapshot}:{...base,intent,refs,...(cell.adapter==='compact'?{fences}:{})},responseSchema:union(schema,errorSchema),schemas,oracleData};
  }
  const input={...base,types:config.types,intent,query,semantic:false,...(method==='contextRead'?{budget:{maxTokens:cell.maxTokens??1500,maxItems:cell.limit??12}}:{limit:cell.limit??12})};
  return {input,responseSchema:method==='contextRead'?assembly(cell.limit??12):candidates(cell.limit??12),schemas,oracleData};
}
export function validate(result,config) {
  if(!closedShape(result,config.responseSchema))return false;
  if(!result.ok)return ['index_unavailable','storage_busy'].includes(result.error.code);
  const data=config.oracleData;
  if(config.method==='getContextIndexStatus')return true;
  if(config.method==='fetchCandidateEvidence')return equal(result.value.items,data.evidence)&&result.value.snapshot===data.snapshot;
  const cov=result.value.coverage??result.value.diagnostics?.candidates.coverage;
  if(cov.status!==(config.cell.scope==='overflow'?'partial':'complete')||cov.freshness!=='current'||!equal(cov.namespaces,config.ownerCoverage))return false;
  if(data.probe)return validateProbe(result,{targets:config.cell.probeTargets,config});
  const items=result.value.items??result.value.diagnostics.items;
  const refs=items.map(i=>i.ref),expected=data.order.slice(0,config.method==='contextRead'?config.input.budget.maxItems:config.input.limit);
  if(!equal(refs,expected))return false;
  if(config.method==='contextRead') {
    for(const [i,item] of result.value.metered.items.entries()) {
      const ref=refs[i];if(item.ref.id!==(ref.memoryId??ref.cardId)||item.ref.rev!==ref.revision||item.ref.ns!==config.readSet.findIndex(n=>equal(n,ref.namespace))||item.rank!==i+1)return false;
      if(item.body!==labelsBody(ref,config))return false;
    }
  }
  return true;
}
function labelsBody(ref,config) {const row=config.ledger?.memory.find(m=>m.id===ref.memoryId),card=config.ledger?.cards.find(c=>c.id===ref.cardId);return row?.content??(card?card.title+'\n'+card.body:undefined)??labels.fixtures.flatMap(f=>f.catalog).find(x=>refKey(x.ref)===refKey(ref))?.text;}
export function validateProbe(result,{targets,config}) {
  if(!result?.ok||!closedShape(result,config.responseSchema))return false;
  const allowed=probeRefs(targets);
  const refs=result.value.items.map(i=>i.ref);
  return new Set(refs.map(refKey)).size===refs.length&&refs.every(r=>allowed.some(a=>equal(a,r)))&&refs.every(r=>eligible(r,config));
}

function firstDifference(a,b,path='items') {if(equal(a,b))return null;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)])){const diff=firstDifference(a[key],b[key],path+'.'+key);if(diff)return diff;}}return {path,actual:typeof a==='string'?{length:a.length,prefix:a.slice(0,80)}:a,expected:typeof b==='string'?{length:b.length,prefix:b.slice(0,80)}:b};}

export function selectEvidenceRefs(cell,config,ledger) {
    const languageOrdinal=['zh','ja','mixed'].indexOf(cell.language),offset=Math.max(0,languageOrdinal);
    const matches=r=>r.content.startsWith(['海港','桜庭','cobaltledger'][offset]);
    const rows=ledger.memory.filter(r=>eligible(rowRef(r),config));
    const large=rows.filter(r=>r.content.length===4000&&r.content.startsWith(['海港','桜庭','cobaltledger'][offset])).map(r=>rowRef(r));
    const preferred=rows.filter(r=>matches(r)||Number(/^entry(\d+)/.exec(r.content)?.[1])%3===offset);
    const memoryById=new Map(rows.map(r=>[r.id,r])),cardById=new Map(ledger.cards.map(r=>[r.id,r]));
    const preferredIds=new Set(preferred.map(r=>r.id));
    const memory=[...preferred.sort((a,b)=>Number(matches(b))-Number(matches(a))||compareRefs(rowRef(a),rowRef(b))),...rows.filter(r=>!preferredIds.has(r.id)).sort((a,b)=>compareRefs(rowRef(a),rowRef(b)))].map(r=>rowRef(r));
    const cards=ledger.cards.filter(r=>r.state==='confirmed').map(r=>rowRef(r,'card')).filter(r=>eligible(r,config)).sort(compareRefs);
    if(cards.length)cards.push(...cards.splice(0,offset%cards.length));
    const bigCards=cards.filter(ref=>cardById.get(ref.cardId)?.title.startsWith('Large '+['zh','ja','mixed'][offset]+' '));
    const largeRefs=cell.refs===1&&cell.adapter==='compact'&&bigCards.length?bigCards:[...large,...bigCards];
    const smallMemory=memory.filter(ref=>!large.some(r=>r.memoryId===ref.memoryId)&&memoryById.get(ref.memoryId).content.length<4000);
    const smallCards=cards.filter(ref=>!cardById.get(ref.cardId).title.startsWith('Large ')).slice(0,2);
    let refs=config.postCatchupIdentity?[rowRef(config.postCatchupIdentity),...memory.filter(r=>r.memoryId!==config.postCatchupIdentity.id)]:memory;
    if(!config.postCatchupIdentity){const fill=smallMemory.flatMap((r,i)=>i<smallCards.length?[r,smallCards[i]]:[r]);refs=[...largeRefs,...fill];}
    refs=refs.slice(0,cell.refs??24);if(refs.length!==(cell.refs??24))throw Error('insufficient_evidence_refs');
  return refs;
}

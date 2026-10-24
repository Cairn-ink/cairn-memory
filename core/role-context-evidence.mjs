import { createHmac, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openContextReadSidecar } from './context-read-sidecar.mjs';
import { fuseCandidates } from './context-read-fusion.mjs';
import { createPrivateCardStorage } from './private-card-storage.mjs';
import { createPrivateEvidenceStorage } from './private-evidence-storage.mjs';
import { createCardReceiptSources } from './card-receipt-sources.mjs';
import { validateSourceReceipt } from './source-evidence.mjs';
import { assembleContext } from './context-read-assembly.mjs';
import { keyed } from './private-card-input.mjs';
import { fail } from './validation.mjs';

// Reuses U5b's candidate index, canonical readers, full fence, v2 projection
// and deduplication. Only admission/metering belongs to the enclosing role call.
export function roleEvidence(storage,config) {
  const {db,identity,ready}=storage;
  const cards=createPrivateCardStorage({db,identity,ready,rawSources:true});
  const receipts=createCardReceiptSources(db,(purpose,value)=>keyed(identity.cursorSecret,purpose,[identity.storeId,value]));
  const evidence=createPrivateEvidenceStorage({db,identity,cardDetailInside:cards.cardDetailInside,receiptRefInside:receipts.refInside});
  const fence=item=>createHmac('sha256',identity.cursorSecret).update(JSON.stringify(['context-read-v1','snapshot-item',identity.storeId,item])).digest('base64url');
  function item(ref,readSet,rank,intent='current') {
    const canonical=evidence.itemsInside(ref.namespace,[ref],intent,readSet)[0],{type,state,origin}=canonical;
    const sources=type==='memory'&&canonical.provenance.sourceAccess==='available'?
      db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 16').all(ref.memoryId).map((row,index)=>{
        const {role,excerpt}=validateSourceReceipt(ref.memoryId,row,source=>createHash('sha256').update(JSON.stringify(source)).digest('hex'));
        return {index,role,excerpt,ref:canonical.provenance.sources[index]};
      }):[];
    return {type,ref,ns:readSet.findIndex(ns=>JSON.stringify(ns)===JSON.stringify(ref.namespace)),rank,
      metadata:type==='memory'?{state,reviewState:canonical.reviewState,filing:canonical.filing,kind:canonical.kind,origin,confidence:canonical.confidence}:{state,support:canonical.support,origin},
      text:type==='memory'?canonical.content:canonical.title+'\n'+canonical.body,sources,
      sourceAccess:type==='memory'?canonical.provenance.sourceAccess:'unsupported',canonicalSourceCount:sources.length,
      canonicalSourcesComplete:type==='memory'&&canonical.provenance.coverage.status==='complete',fence:fence(canonical)};
  }
  function search(input,access,deadlineAt) {
    const projection={readSet:input.readSet,types:['memory','card'],intent:'current',accessGenerations:access.access.map(g=>g.accessGeneration)};
    const side=openContextReadSidecar({path:config.path,db,readOnly:config.readOnly,authorizedProjection:projection});
    try {
      if(!config.readOnly)side.reconcile({...projection,budget:{maxItems:1024,maxMs:Math.max(1,Math.floor(deadlineAt-performance.now()))}},{isCurrent:access.check});
      access.check();const state=side.state(projection);if(!state.ready)fail('index_unavailable');
      const lexical=side.lexicalPage(projection,input.task,24,{deadlineAt});
      const fused=fuseCandidates(lexical.rows,[],{preset:'rrf-k60-d12',semanticState:'disabled',coverageComplete:false});
      side.assertState(projection,state);
      return {refs:fused.rows.map((row,i)=>({ref:row.ref,rank:i+1})),diagnostics:{count:fused.rows.length,channels:{lexical:{state:'ready',causes:[]},semantic:{state:'disabled',causes:['disabled']}},coverage:{status:'complete',byType:Object.fromEntries(projection.types.map(type=>[type,{...state.byType[type],embedded:null,scanned:0,embeddedFraction:null,scannedFraction:null}])),freshness:'current',maintenance:{available:!config.readOnly,state:'ready',buildState:'ready',reason:null,progress:state.progress},depths:{lexical:24,semantic:0},omitted:{lexical:Math.max(0,lexical.matched-24),semantic:null,horizon:Math.max(0,fused.unionSize-24)},stops:{deadline:performance.now()>=deadlineAt,budget:false}},trace:{requested:'lexical',effective:'lexical',family:'local',preset:'rrf-k60-d12',embedder:null,tokenizer:'hr1-t1-v1',representation:'candidate-text-v1',timings:{maintenanceMs:0,lexicalMs:0,semanticPreflightMs:0,embeddingMs:0,fusionMs:0}}}};
    }finally{side.close();}
  }
  function assembled(items,tokenCounts=new Map()) {
    const prepared=items.map(item=>({...item,sourcesComplete:item.canonicalSourcesComplete&&item.sources.length===item.canonicalSourceCount}));
    return assembleContext({prepared,counter:{id:'internal-projection',countTokens:text=>tokenCounts.get(text)??0},policy:{id:'rank-first-whole-v1'},
      budget:{maxTokens:Number.MAX_SAFE_INTEGER,maxItems:24},deadlineAt:Infinity,snapshotOf:()=>null});
  }
  return {item,search,project:items=>assembled(items).metered.items,details:(items,tokens)=>assembled(items,tokens).diagnostics.items};
}

import { hash, canonical, fail } from './common.mjs';
import { EMBEDDING, embeddingRequest, validateRequest } from './requests.mjs';
/** Transport.send({id,operation,body},{signal}) -> {requestId,model,status,outputText?,vectors?,usage:{inputTokens,outputTokens}}.
 * Only a thrown TransportError is retryable (once). Unknown charges remain reserved.
 * A returned malformed/refused/truncated reply is a completed attempt, never retried.
 */
export class TransportError extends Error {constructor(message='transport_failure'){super(message);this.name='TransportError';}}
export class GuardedTransport {
  constructor(transport,ledger,{now=()=>Date.now(),stallMs=300000,timeoutMs=60000}={}) {
    this.transport=transport;this.ledger=ledger;this.now=now;this.lastProgress=now();this.stallMs=stallMs;this.timeoutMs=timeoutMs;
  }
  checkProgress({authoritative=false}={}) {
    if(this.supervisionError)throw this.supervisionError;
    let state;try{state=authoritative?this.ledger.transaction(events=>this.ledger.snapshot(events)):this.ledger.snapshot();}catch(error){
      if(error.code==='ledger_locked'){
        if(this.now()-this.lastProgress>=this.stallMs)fail('five_minutes_without_progress');
        throw error;
      }
      try{fail('accounting_mismatch:'+error.message);}catch(mismatch){this.supervisionError=mismatch;throw mismatch;}
    }
    if(state.stopped)fail('stopped:'+state.stopped);
    if(this.now()-this.lastProgress>=this.stallMs){this.ledger.stop('five_minutes_without_progress');fail('five_minutes_without_progress');}
    return state;
  }
  startSupervision(progress=()=>{}) {
    if(this.supervisor)fail('supervision_already_started');
    // Mechanical checks supplement, never attest, the primary's attendance.
    this.supervisor=setInterval(()=>{try{const ledger=this.checkProgress();progress({kind:'supervision',ledger});}catch(error){if(error.code==='ledger_locked'){progress({kind:'supervision',ledgerBusy:true});return;}this.supervisionError=error;this.activeController?.abort();this.rejectActive?.(error);}},60000);
  }
  stopSupervision(){clearInterval(this.supervisor);this.supervisor=null;}
  async send(request,{signal}={}) {
    for(let attempt=0;attempt<2;attempt++) {
      this.checkProgress({authoritative:true});
      const call={...request,logicalId:request.id,id:request.id+`/attempt-${attempt}`};validateRequest(call);this.ledger.reserve(call);this.checkProgress({authoritative:true});
      let reply;
      const controller=new AbortController();this.activeController=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      let timer;
      try {
        if(signal?.aborted)throw new TransportError('aborted');
        reply=await Promise.race([new Promise((_,reject)=>{this.rejectActive=reject;}),this.transport.send(call,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new TransportError('dispatch_timeout'));},this.timeoutMs);})]);
      } catch(error) {
        if(this.supervisionError)throw this.supervisionError;
        if(!(error instanceof TransportError)){this.ledger.stop('transport_contract_error');throw error;}
        this.ledger.failure(call.id);if(attempt===1)return {status:'transport_exhausted',outputText:null};continue;
      } finally {clearTimeout(timer);this.activeController=null;this.rejectActive=null;signal?.removeEventListener('abort',abort);}
      this.checkProgress({authoritative:true});
      if(reply.model!==request.body.model){this.ledger.stop('model_mismatch');fail('model_mismatch');}
      this.ledger.settle(call.id,reply);this.lastProgress=this.now();return reply;
    }
  }
}
export function createEmbedder(guarded,{channel='research',prefix='embedding'}={}) {
  let sequence=0;
  return {id:EMBEDDING,revision:'hr3-1536-v1',dimensions:1536,normalization:'l2',async embed(texts,{signal}={}) {
    // No splitting or truncation here: product refusals are preserved.
    const response=await guarded.send({id:`${prefix}/${++sequence}`,operation:`${channel}-embedding`,body:embeddingRequest(texts)},{signal});
    if(response.status!=='completed'||!Array.isArray(response.vectors)||response.vectors.length!==texts.length||response.vectors.some(v=>!Array.isArray(v)||v.length!==1536||v.some(x=>!Number.isFinite(x))||Math.hypot(...v)<.9||Math.hypot(...v)>1.1)){guarded.ledger.stop('embedding_response_mismatch');fail('embedding_response_mismatch');}
    return response.vectors.map(v=>{const norm=Math.hypot(...v);return v.map(x=>x/norm);});
  }};
}
export const emptyAnswer=()=>({current:{status:'unresolved',rows:[]},old:{status:'unavailable',records:[]},reason:{status:'unavailable',support:[]}});
export class FakeTransport {
  constructor({modes=[],replies={}}={}){this.modes=[...modes];this.replies=replies;this.calls=[];}
  async send(request) {
    validateRequest(request);this.calls.push(structuredClone(request));const mode=this.modes.shift()??'valid';
    if(mode==='failure')throw new TransportError();
    const input=request.operation==='extraction'?JSON.parse(request.body.input[1].content):null;
    let output=this.replies[hash(request.body)]??(request.operation==='extraction'?fakeExtract(input):emptyAnswer());
    const vectors=request.operation.endsWith('embedding')?request.body.input.map(fakeVector):undefined;
    return {requestId:'fake-'+hash(request.id),model:mode==='model-mismatch'?'wrong':request.body.model,status:mode==='truncated'?'incomplete':'completed',
      ...(vectors?{vectors}:{outputText:mode==='malformed'?'{':canonical(output)}),usage:{inputTokens:vectors?request.body.input.reduce((n,t)=>n+Math.ceil(Buffer.byteLength(t)/4),0):Math.min(validateRequest(request).input,Math.ceil(Buffer.byteLength(canonical(request.body))/4)),outputTokens:vectors?0:Math.min(request.body.max_output_tokens,Math.ceil(Buffer.byteLength(canonical(output))/4))}};
  }
}
function fakeVector(text) {
  const vector=Array(1536).fill(0);for(const term of text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??['empty']){const digest=hash(term);vector[parseInt(digest.slice(0,8),16)%1536]+=1;}
  if(!vector.some(Boolean))vector[0]=1;const norm=Math.hypot(...vector);return vector.map(x=>x/norm);
}
// Deliberately weak source-only fake. It makes no semantic-quality claim and never reads AST/gold.
function fakeExtract(input) {
  const turn=input.turns.find(t=>/^b\d-focal$/.test(t.turn_id));if(!turn)return {events:[]};
  const text=turn.text,content=text.slice(0,100);
  const kind=/^Correct record|^更正紀錄/u.test(text)?'correction':/^We withdraw|^我們完整撤回/u.test(text)?'reversal':/^For records|^針對紀錄/u.test(text)?'refinement':/^Adopt record|^採用紀錄/u.test(text)?'scope_change':/reaches its explicit deadline|已到明確期限/u.test(text)?'expiry':'initial';
  const names=(kind==='correction'?text.match(/^(?:Correct record|更正紀錄) ([A-D, ]+)/u):kind==='reversal'?text.match(/^(?:We withdraw records|我們完整撤回紀錄) ([A-D, ]+)/u):kind==='refinement'?text.match(/^(?:For records|針對紀錄) ([A-D, ]+)/u):kind==='scope_change'?text.match(/(?:of records|只把紀錄) ([A-D, ]+)/u):kind==='expiry'?text.match(/(?:Record|紀錄) ([A-D, ]+)/u):null)?.[1]?.match(/[A-D]/g)??[];
  const range=text.match(/(?:Effective interval|生效區間) \[([^,]+), ([^)]*)/u),deadline=text.match(/(?:deadline |明確期限 )(\d{4}-[^ .]+(?:\.\d{3}Z)?)/u)?.[1];
  const route=text.match(/(?:route|路線) = ([A-Za-z0-9-]+)/u)?.[1],cap=text.match(/(?:daily request cap|每日請求上限) = (\d+) ([A-Za-z0-9]+)/u);
  const claims=[...(route?[{field:'value',value:{type:'Text',text:route}}]:[]),...(/(?:approval required|需經核准) = /u.test(text)?[{field:'approval',value:{type:'Boolean',value:true}}]:[]),...(cap?[{field:'cap',value:{type:'Quantity',decimal:cap[1],unit:cap[2]}}]:[])];
  const countries=text.match(/country = ([A-Z/]+)/u)?.[1]?.split('/');
  return {events:[{event_id:turn.turn_id,source_turns:[turn.turn_id],observed_at:input.observed_at,kind:'decision',commitment:'adopted',change_type:kind,subject:input.public_header.subject,predicate:input.public_header.predicate,
    payload:{type:'slots',route:null,approval:null,cap:null,...Object.fromEntries(claims.map(c=>[c.field==='value'?'route':c.field,{value:c.value,anchors:[{turn_id:turn.turn_id,quote:content,occurrence:1}]}]))},scope:{any:[{all:countries?[{field:'country',values:countries}]:[]}]},effective_interval:{from:range?.[1]??deadline??input.observed_at,to:range&&/^\d{4}-/.test(range[2])?range[2]:null},predecessor_anchors:names.map(name=>({source_turn:`b${name.charCodeAt(0)-64}-focal`,record_name:name,subject:input.public_header.subject,predicate:input.public_header.predicate})),replacement_extent:['refinement','scope_change'].includes(kind)?'partial':'entire_predecessor',reason_quotes:[],source_quotes:[{turn_id:turn.turn_id,quote:content,occurrence:1}]}]};
}

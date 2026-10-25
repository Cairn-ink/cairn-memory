import { hash, canonical, fail, atomicJSON } from './common.mjs';
import {mkdirSync,existsSync,unlinkSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,relative} from 'node:path';
import { EMBEDDING, embeddingRequest, validateRequest } from './requests.mjs';
/** Transport.send({id,operation,body},{signal}) -> {requestId,model,status,outputText?,vectors?,usage:{inputTokens,outputTokens}}.
 * Only a thrown TransportError is retryable (once). Unknown charges remain reserved.
 * A returned malformed/refused/truncated reply is a completed attempt, never retried.
 */
export class TransportError extends Error {constructor(message='transport_failure'){super(message);this.name='TransportError';}}
export class GuardedTransport {
  constructor(transport,ledger,{now=()=>Date.now(),stallMs=300000,timeoutMs=60000,accountingTimeoutMs=15000,accountingBackoffMs=5}={}) {
    if(!Number.isFinite(accountingTimeoutMs)||accountingTimeoutMs<1||accountingTimeoutMs>30000||!Number.isFinite(accountingBackoffMs)||accountingBackoffMs<1||accountingBackoffMs>100)fail('invalid_accounting_contention_bound');
    this.transport=transport;this.ledger=ledger;this.now=now;this.lastProgress=now();this.stallMs=stallMs;this.timeoutMs=timeoutMs;
    this.accountingTimeoutMs=accountingTimeoutMs;this.accountingBackoffMs=accountingBackoffMs;
    this.accountingArtifacts=new Set();this.lastAccountingSnapshot=null;
  }
  accounting(operation,fn,{call=null,responsePath=null}={}) {
    // The uncontended path stays synchronous. A lock conflict retries only this
    // synchronous accounting operation, never any provider invocation.
    const release=this.ledger.writerPriority(),started=performance.now();
    try{fn();release();return;}catch(error){if(error.code!=='ledger_locked'){release();throw error;}}
    return (async()=>{
      let delay=this.accountingBackoffMs;
      try {
        for(;;){
          const remaining=this.accountingTimeoutMs-(performance.now()-started);
          if(remaining<=0){
            const path=this.ledger.path+'.accounting-stop.json';
            // Independent of the contended journal: no checkpoint replacement,
            // no charge release, and no automatic reconciliation or redispatch.
            const responseReference=responsePath?relative(dirname(this.ledger.path),responsePath):null;
            if(!existsSync(path))atomicJSON(path,{version:'hr3-accounting-stop-v1',reason:'accounting_contention_exhausted',operation,id:call?.id??null,responsePath:responseReference,timeoutMs:this.accountingTimeoutMs});
            this.accountingArtifacts.add(path);
            const error=Object.assign(new Error('accounting_contention_exhausted'),{code:'accounting_contention_exhausted',operation,responsePath:responseReference});
            this.supervisionError=error;throw error;
          }
          await new Promise(resolve=>setTimeout(resolve,Math.min(delay,remaining)));
          // Writer intent stays registered across the yield. Observers must not
          // reacquire the lock ahead of this accounting operation.
          if(performance.now()-started>=this.accountingTimeoutMs)continue;
          try{fn();return;}catch(error){if(error.code!=='ledger_locked')throw error;}
          delay=Math.min(delay*2,100);
        }
      } finally {release();}
    })();
  }
  async snapshot({forReport=false}={}) {
    // Failure reporting must not mask the original error or attempt a second
    // contention wait. Mark cached state explicitly rather than claim freshness.
    if(forReport&&this.supervisionError?.code==='accounting_contention_exhausted')return {...this.lastAccountingSnapshot,stopped:'accounting_contention_exhausted',observation:'last coherent snapshot; reconciliation required',responseArtifacts:[...this.accountingArtifacts].map(path=>relative(dirname(this.ledger.path),path))};
    let state;const pending=this.accounting('snapshot',()=>{state=this.ledger.transaction(events=>this.ledger.snapshot(events));this.lastAccountingSnapshot=state;});if(pending)await pending;
    return state;
  }
  stop(reason) {return this.accounting('stop',()=>this.ledger.stop(reason));}
  preserveResponse(call,reply) {
    const directory=this.ledger.path+'.responses';mkdirSync(directory,{recursive:true,mode:0o700});
    const parent=openSync(dirname(directory),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
    const path=directory+'/'+hash(call.id)+'.json';
    atomicJSON(path,{version:'hr3-accounting-response-v1',id:call.id,logicalId:call.logicalId,operation:call.operation,bodySHA256:hash(call.body),response:reply??null});
    this.accountingArtifacts.add(path);return path;
  }
  releaseResponse(path){unlinkSync(path);const fd=openSync(dirname(path),'r');try{fsyncSync(fd);}finally{closeSync(fd);}this.accountingArtifacts.delete(path);}
  checkProgress({authoritative=false}={}) {
    if(this.supervisionError)throw this.supervisionError;
    let state;try{state=authoritative?this.ledger.transaction(events=>this.ledger.snapshot(events)):this.ledger.snapshot();}catch(error){
      if(error.code==='ledger_locked'){
        if(this.now()-this.lastProgress>=this.stallMs)fail('five_minutes_without_progress');
        throw error;
      }
      try{fail('accounting_mismatch:'+error.message);}catch(mismatch){this.supervisionError=mismatch;throw mismatch;}
    }
    this.lastAccountingSnapshot=state;
    if(state.stopped)fail('stopped:'+state.stopped);
    if(this.now()-this.lastProgress>=this.stallMs){if(authoritative)this.ledger.stop('five_minutes_without_progress');fail('five_minutes_without_progress');}
    return state;
  }
  startSupervision(progress=()=>{}) {
    if(this.supervisor)fail('supervision_already_started');
    // Watchdog observations yield without retrying reads or extending the stall
    // deadline. Explicit stop recording below is tracked and drained on exit.
    this.supervisor=setInterval(()=>{
      try{const ledger=this.checkProgress();progress({kind:'supervision',ledger});}
      catch(error){
        if(error.code==='ledger_locked'){progress({kind:'supervision',ledgerBusy:true});return;}
        this.supervisionError=error;
        if(error.code==='five_minutes_without_progress'){
          try{const pending=this.stop(error.code);if(pending)this.supervisionAccounting=pending.catch(stoppingError=>{this.supervisionError=stoppingError;});}
          catch(stoppingError){this.supervisionError=stoppingError;}
        }
        this.activeController?.abort();this.rejectActive?.(this.supervisionError);
      }
    },60000);
  }
  stopSupervision(){clearInterval(this.supervisor);this.supervisor=null;return this.supervisionAccounting;}
  async send(request,{signal}={}) {
    for(let attempt=0;attempt<2;attempt++) {
      const call={...request,logicalId:request.id,id:request.id+`/attempt-${attempt}`};validateRequest(call);
      let pending=this.accounting('pre-dispatch-check',()=>this.checkProgress({authoritative:true}),{call});if(pending)await pending;
      pending=this.accounting('reserve',()=>this.ledger.reserve(call),{call});if(pending)await pending;
      pending=this.accounting('reserved-check',()=>this.checkProgress({authoritative:true}),{call});if(pending)await pending;
      let reply;
      const controller=new AbortController();this.activeController=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      let timer;
      try {
        if(signal?.aborted)throw new TransportError('aborted');
        reply=await Promise.race([new Promise((_,reject)=>{this.rejectActive=reject;}),this.transport.send(call,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new TransportError('dispatch_timeout'));},this.timeoutMs);})]);
      } catch(error) {
        if(this.supervisionError)throw this.supervisionError;
        if(!(error instanceof TransportError)){pending=this.stop('transport_contract_error');if(pending)await pending;throw error;}
        pending=this.accounting('failure',()=>this.ledger.failure(call.id),{call});if(pending)await pending;
        if(attempt===1)return {status:'transport_exhausted',outputText:null};continue;
      } finally {clearTimeout(timer);this.activeController=null;this.rejectActive=null;signal?.removeEventListener('abort',abort);}
      // Fsync the exact JSON reply before any accounting check can fail, including
      // model/usage/stall rejection. Keep it on every failed accounting path.
      const responsePath=this.preserveResponse(call,reply);
      pending=this.accounting('post-reply-check',()=>this.checkProgress({authoritative:true}),{call,responsePath});if(pending)await pending;
      if(reply?.model!==request.body.model){pending=this.accounting('model-stop',()=>this.ledger.stop('model_mismatch'),{call,responsePath});if(pending)await pending;fail('model_mismatch');}
      pending=this.accounting('settle',()=>{
        if(this.supervisionError)throw this.supervisionError;
        if(this.now()-this.lastProgress>=this.stallMs){this.ledger.stop('five_minutes_without_progress');fail('five_minutes_without_progress');}
        this.ledger.settle(call.id,reply);
      },{call,responsePath});if(pending)await pending;
      this.releaseResponse(responsePath);this.lastProgress=this.now();return reply;
    }
  }
}
export function createEmbedder(guarded,{channel='research',prefix='embedding'}={}) {
  let sequence=0;
  return {id:EMBEDDING,revision:'hr3-1536-v1',dimensions:1536,normalization:'l2',async embed(texts,{signal}={}) {
    // No splitting or truncation here: product refusals are preserved.
    const response=await guarded.send({id:`${prefix}/${++sequence}`,operation:`${channel}-embedding`,body:embeddingRequest(texts)},{signal});
    if(response.status!=='completed'||!Array.isArray(response.vectors)||response.vectors.length!==texts.length||response.vectors.some(v=>!Array.isArray(v)||v.length!==1536||v.some(x=>!Number.isFinite(x))||Math.hypot(...v)<.9||Math.hypot(...v)>1.1)){await guarded.stop('embedding_response_mismatch');fail('embedding_response_mismatch');}
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

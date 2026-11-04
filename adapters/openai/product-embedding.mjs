import { performance } from 'node:perf_hooks';
import { validateVector } from '../../core/context-read-embedder.mjs';
import { ENDPOINT, HOSTED_ID, MODEL, hostedSelection } from '../../core/context-semantic-input.mjs';

const failed=code=>Object.assign(Error(code),{code});
export function hostedInputBound(texts,maximum=64) {
  if(!Array.isArray(texts)||texts.length<1||texts.length>maximum)throw failed('invalid_input');
  let bound=0;
  for(const text of texts) {
    if(typeof text!=='string'||!text.trim()||!text.isWellFormed()||text.includes('\0'))throw failed('invalid_input');
    const n=Buffer.byteLength(text)+16;
    if(n>8192)throw failed('context_item_too_large');bound+=n;
  }
  if(bound>300000)throw failed('context_item_too_large');
  return bound;
}
// This versioned transport has no endpoint override, price fallback or retry.
// Credentials remain in its runtime closure in the semantic service Worker.
export function createProductOpenAIEmbedder({selection,apiKey,fetchImpl=globalThis.fetch,...unknown}) {
  const p=hostedSelection(selection);
  if(Object.keys(unknown).length||typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192||/[\r\n\0]/.test(apiKey)||typeof fetchImpl!=='function')throw failed('invalid_input');
  const identity={id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2'};
  return Object.freeze({...identity,async embed(texts,{signal,deadlineAt,beforeDispatch,settleInputTokens}={}) {
    const bound=hostedInputBound(texts,p.maxBatchDocuments);
    if(typeof beforeDispatch!=='function'||typeof settleInputTokens!=='function'||!Number.isFinite(deadlineAt))throw failed('budget_denied');
    const body=JSON.stringify({model:MODEL,dimensions:1536,encoding_format:'float',input:texts});
    if(Buffer.byteLength(body)>2097152)throw failed('context_item_too_large');
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const cutoff=Math.min(deadlineAt,performance.now()+p.requestTimeoutMs),timer=setTimeout(abort,Math.max(0,cutoff-performance.now()));
    const check=()=>{if(controller.signal.aborted||performance.now()>=cutoff)throw failed('timeout');};
    let reader,bodyStream,complete=false;
    try {
      check();beforeDispatch();check();
      const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body,signal:controller.signal,redirect:'error'});
      bodyStream=response.body;
      check();
      if(response.redirected||response.url&&response.url!==ENDPOINT)throw failed('provider_error');
      if(response.status===429)throw failed('rate_limited');
      if(!response.ok||!response.body)throw failed('provider_error');
      const maximum=Math.min(67108864,texts.length*1536*32+65536),length=response.headers.get('content-length');
      if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>maximum))throw failed('provider_error');
      reader=response.body.getReader();const chunks=[];let size=0;
      for(;;) {
        const {value,done}=await reader.read();check();
        if(done){complete=true;break;}
        size+=value.byteLength;if(size>maximum)throw failed('provider_error');chunks.push(value);
      }
      let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{throw failed('provider_error');}
      if(json?.object!=='list'||json.model!==MODEL)throw failed('provider_error');
      if(json.usage!==undefined) {
        const u=json.usage;
        if(Number.isSafeInteger(u?.prompt_tokens)&&u.prompt_tokens>bound)throw Object.assign(failed('provider_error'),{usageBoundExceeded:true});
        if(!Number.isSafeInteger(u?.prompt_tokens)||u.prompt_tokens<0||u.total_tokens!==u.prompt_tokens)throw failed('provider_error');
        settleInputTokens(u.prompt_tokens);
      }
      if(!Array.isArray(json.data)||json.data.length!==texts.length)throw failed('provider_error');
      const vectors=new Array(texts.length);
      for(const row of json.data) {
        if(!Number.isInteger(row?.index)||row.index<0||row.index>=texts.length||vectors[row.index])throw failed('provider_error');
        if(!Array.isArray(row.embedding)||row.embedding.length!==1536)throw failed('dimension_mismatch');
        let norm=0;for(const n of row.embedding){if(typeof n!=='number'||!Number.isFinite(n))throw failed('provider_error');norm+=n*n;}
        norm=Math.sqrt(norm);if(norm<.9||norm>1.1)throw failed('provider_error');
        vectors[row.index]=validateVector(Float32Array.from(row.embedding,n=>n/norm),identity);
      }
      check();return vectors;
    } catch(error) {
      if(controller.signal.aborted||error?.name==='AbortError'||error?.code==='timeout')throw failed('timeout');
      const result=failed(['rate_limited','dimension_mismatch','budget_denied','scope_changed','store_closed','index_unavailable','price_unavailable'].includes(error?.code)?error.code:'provider_error');
      if(error?.usageBoundExceeded===true)result.usageBoundExceeded=true;throw result;
    } finally {
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(!complete)abort();
      if(reader){if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}else if(bodyStream&&!complete)await bodyStream.cancel().catch(()=>{});
    }
  }});
}

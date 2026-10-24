import http from 'node:http';
import { brotliCompressSync } from 'node:zlib';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';

/** Actual local HTTP only. Never reads credentials or contacts a provider. */
export async function embeddingServer(t) {
  const state={mode:'ready',encoding:'brotli',norms:[1.000225,.99981],requests:[],responses:[],timers:new Set()};
  const server=http.createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString()); state.requests.push({path:req.url,body});
      if(req.url!=='/v1/embeddings'){res.writeHead(404).end();return;}
      if(state.mode==='rate_limited'){res.writeHead(429).end('{}');return;}
      if(state.mode==='provider_error'){res.writeHead(500).end('{}');return;}
      if(state.mode==='redirect'){res.writeHead(302,{location:'https://forbidden.invalid/'}).end();return;}
      if(state.mode==='oversized-header'){res.writeHead(200,{'content-length':1000000000}).end('x');return;}
      if(state.mode==='oversized-stream'){res.writeHead(200);res.end('x'.repeat(100000));return;}
      const fake=createFakeEmbedder({dimensions:body.dimensions??1536,aliases:{automobile:'car',vehicle:'car'}});
      const vectors=await fake.embed(body.input);
      const data=vectors.map((vector,index)=>{
        const norm=Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0)),target=state.norms[index%state.norms.length];
        return {object:'embedding',index,embedding:Array.from(vector,value=>value/norm*target)};
      });
      const json={object:'list',model:body.model,data,usage:{prompt_tokens:body.input.length,total_tokens:body.input.length}};
      if(state.mode==='unknown-usage')delete json.usage;
      if(state.mode==='bad-usage')json.usage.prompt_tokens=-1;
      if(state.mode==='wrong-model')json.model='foreign-model';
      if(state.mode==='dimension_mismatch')json.data[0].embedding=[1];
      if(state.mode==='float-overflow')json.data[0].embedding[0]=Number.MAX_VALUE;
      if(state.mode==='float-underflow')json.data[0].embedding.fill(1e-50);
      if(state.mode==='norm-too-small')json.data[0].embedding=json.data[0].embedding.map(value=>value*.89/state.norms[0]);
      if(state.mode==='norm-too-large')json.data[0].embedding=json.data[0].embedding.map(value=>value*1.11/state.norms[0]);
      if(state.mode==='zero-norm')json.data[0].embedding.fill(0);
      if(state.mode==='nonfinite-component')json.data[0].embedding[0]=Infinity;
      if(state.mode==='duplicate-index'&&json.data.length>1)json.data[1].index=0;
      if(state.mode==='reverse')json.data.reverse();
      const payload=state.mode==='malformed-json'?'not json':JSON.stringify(json);
      const send=()=>{
        const bytes=state.encoding==='brotli'?brotliCompressSync(Buffer.from(payload)):Buffer.from(payload);
        res.writeHead(200,{'content-type':'application/json','transfer-encoding':'chunked',
          ...(state.encoding==='brotli'?{'content-encoding':'br'}:{})});
        state.responses.push({encoding:state.encoding,contentLength:res.getHeader('content-length')??null,
          norms:json.data.map(item=>Math.sqrt(item.embedding.reduce((sum,value)=>sum+value*value,0)))});
        const middle=Math.ceil(bytes.length/2);res.write(bytes.subarray(0,middle));res.end(bytes.subarray(middle));
      };
      if(state.mode==='slow'){
        const timer=setTimeout(()=>{state.timers.delete(timer);send();},250);state.timers.add(timer);
        res.once('close',()=>{clearTimeout(timer);state.timers.delete(timer);});
      }else send();
    } catch { if(!res.destroyed)res.writeHead(500).end('{}'); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{for(const timer of state.timers)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const endpoint=`http://127.0.0.1:${server.address().port}/v1/embeddings`;
  return {state,endpoint,server,preload:'data:text/javascript,'+encodeURIComponent(`const original=globalThis.fetch;globalThis.fetch=(url,options)=>{
    if(String(url)!=='https://api.openai.com/v1/embeddings')throw Error('unexpected_external_request');return original(${JSON.stringify(endpoint)},options);};`)};
}

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJSON, hash, fail, canonical } from './common.mjs';
import { responseRequest } from './requests.mjs';
import { validateExtraction } from './schema.mjs';
export function extractionInput(family,batch) {const b=family.batches.find(x=>x.ordinal===batch);return structuredClone({observed_at:b.observed_at,public_header:family.header,turns:b.turns});}
export async function extract({family,batch,transport,cache,alternative=false}) {
  const input=extractionInput(family,batch), body=responseRequest('extraction',input,{alternative}),key=hash(body),path=join(cache,key+'.json');mkdirSync(cache,{recursive:true,mode:0o700});
  if(existsSync(path)){const result=JSON.parse(readFileSync(path,'utf8'));const {digest,...record}=result;if(result.key!==key||hash(result.body)!==key||hash(result.reply)!==result.replyHash||hash(record)!==digest)fail('cache_corrupt');if(result.value)validateExtraction(result.value,input);return result;}
  const reply=await transport.send({id:`${family.family_id}/extract/${batch}`,operation:'extraction',body});
  let value=null,error=null;
  try {if(reply.status!=='completed')fail(reply.status);value=validateExtraction(JSON.parse(reply.outputText),input);}catch(e){error=e.code??'malformed_extraction';}
  const record={key,body,reply,replyHash:hash(reply),value,error},result={...record,digest:hash(record)};atomicJSON(path,result);return result;
}

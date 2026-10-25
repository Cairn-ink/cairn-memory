import { extractionSchema, answerSchema, providerSchema } from './schema.mjs';
import { canonical, bytes, fail } from './common.mjs';
export const INPUT_CAPS=Object.freeze({reader:40960,extraction:20480});
export const READER_INPUT_CAPS=Object.freeze({U:40960,T:40960,O:32768,P:40960});
export function inputLimit(operation,id='') {
  const arm=operation==='reader'?id.match(/\/reader\/([UTOP])\/[24](?:\/attempt-[01])?$/)?.[1]:null;
  return arm?READER_INPUT_CAPS[arm]:INPUT_CAPS[operation];
}
export const OUTPUT_CAPS=Object.freeze({reader:2176,extraction:4352});
export const PRIMARY='gpt-4.1-mini-2025-04-14', ALTERNATIVE='gpt-5.4-mini-2026-03-17', EMBEDDING='text-embedding-3-small';
import {EXTRACTION_PROMPT,READER_PROMPT} from './prompts-a4.mjs';
import {projectContract,isContractProjection} from './contract-projection-a4.mjs';
export {EXTRACTION_PROMPT,READER_PROMPT};
export const REQUEST_VERSION='hr3-requests-a4.2-v1';
export function readerContent(input) {const {delivered,...metadata}=input;return canonical(metadata)+'\nCURRENT\n'+(delivered?.current??'')+'\nHISTORY\n'+(delivered?.history??'');}
function parseReaderContent(content) {const at=content.indexOf('\nCURRENT\n'),end=content.lastIndexOf('\nHISTORY\n');if(at<0||end<at)fail('request_shape');return {...JSON.parse(content.slice(0,at)),delivered:{current:content.slice(at+9,end),history:content.slice(end+9)}};}
export function responseRequest(operation,input,{alternative=false}={}) {
  if(!['extraction','reader'].includes(operation)||operation==='reader'&&alternative)fail('unlisted_operation');
  input={...input,public_contract:input.public_contract??projectContract(operation,operation==='reader'?{question:input.question??''}:input)};
  if(!isContractProjection(input.public_contract)||operation==='reader'&&!input.public_contract.answer||operation==='extraction'&&input.public_contract.answer)fail('public_contract_projection');
  return {model:alternative?ALTERNATIVE:PRIMARY,store:false,...(alternative?{reasoning:{effort:'none'}}:{temperature:0}),max_output_tokens:OUTPUT_CAPS[operation],
    input:[{role:'system',content:operation==='extraction'?EXTRACTION_PROMPT:READER_PROMPT},{role:'user',content:operation==='reader'?readerContent(input):canonical(input)}],
    text:{format:{type:'json_schema',name:operation==='extraction'?'hr3_extraction_a4':'hr3_answer_a4',strict:true,schema:providerSchema(operation==='extraction'?extractionSchema:answerSchema)}}};
}
export function embeddingRequest(input) {return {model:EMBEDDING,input,dimensions:1536,encoding_format:'float'};}
export function validateRequest(request) {
  const {operation,body}=request;
  if(!body||!['extraction','reader','research-embedding','product-embedding'].includes(operation))fail('unlisted_operation');
  if(operation.endsWith('embedding')) {
    if(canonical(Object.keys(body).sort())!==canonical(['dimensions','encoding_format','input','model'])||body.model!==EMBEDDING||body.dimensions!==1536||body.encoding_format!=='float'||!Array.isArray(body.input)||body.input.length<1||body.input.length>64||body.input.some(s=>typeof s!=='string'||!s.trim()||!s.isWellFormed()||s.includes('\0')||bytes(s)+16>8192)||body.input.reduce((n,s)=>n+bytes(s)+16,0)>300000||bytes(body)>2*1024*1024)fail('embedding_bound');
    return {input:body.input.reduce((n,s)=>n+bytes(s)+16,0),output:0,inputRate:20,outputRate:0};
  }
  const alternative=body.model===ALTERNATIVE;
  if(![PRIMARY,ALTERNATIVE].includes(body.model)||alternative&&operation!=='extraction')fail('model_mismatch');
  let parsed;try {parsed=operation==='reader'?parseReaderContent(body.input[1].content):JSON.parse(body.input[1].content);}catch {fail('request_shape');}
  if(canonical(body)!==canonical(responseRequest(operation,parsed,{alternative})))fail('request_shape');
  const bound=bytes(body)+4096;
  if(bound>inputLimit(operation,request.id))fail('request_byte_bound');
  return {input:bound,output:body.max_output_tokens,inputRate:alternative?750:400,outputRate:alternative?4500:1600};
}

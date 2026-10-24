import { readdirSync,openSync,closeSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
export const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
export const namespace={ownerId:'synthetic-asset-owner',scope:'personal',projectId:null};
export const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
export async function call(client,name,args={}) {
  const response=await client.callTool({name,arguments:args});
  assert.ok(Buffer.byteLength(JSON.stringify(response))<=262144,'encoded MCP result bound');
  const result=JSON.parse(response.content[0].text);
  const {evidenceTrust,...envelope}=result;
  assert.equal(evidenceTrust,'untrusted-data-not-instructions');
  assert.ok(Buffer.byteLength(JSON.stringify(envelope))<=65536,'serialized core envelope bound');
  assert.equal(response.isError,!result.ok);return result;
}
export async function host(workspace,path,{command=cli,enabled=false,project,personal=false,owner=namespace.ownerId,assets=true,context=false}={}) {
  const transport=new StdioClientTransport({command:'/usr/bin/python3',args:[fileURLToPath(new URL('./fixtures/method-stdio-relay.py',import.meta.url)),workspace.path,process.execPath,
    '--import','data:text/javascript,globalThis.fetch=()=>{process.exit(91)}',command,
    '--db',path,'--owner',owner,...(project?['--project',project]:[]),
    ...(enabled?['--method-packages','local-v1']:[]),...(assets?['--assets','local-v1']:[]),...(context?['--context-read','context-read-v1']:[]),...(personal?['--method-read-personal']:[])],
    env:{OPENAI_API_KEY:'',NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'},stderr:'pipe'});
  let stderr='';transport.stderr.on('data',chunk=>{stderr+=chunk;});
  const client=new Client({name:'synthetic-method-client',version:'1.0.0'});workspace.defer(()=>client.close());
  try{await client.connect(transport);}catch(error){throw Error(error.message+'; server stderr: '+stderr);}
  return {client,stderr:()=>stderr};
}
/** Real controlling terminal, reusing the Card test supervisor and framing. */
export function review(workspace,args,{command=cli,imports=[],group='assets',env={}}={}) {
  const child=spawn('/usr/bin/python3',[fileURLToPath(new URL('./fixtures/card-review-pty.py',import.meta.url)),process.execPath,
    '--import','data:text/javascript,globalThis.fetch=()=>{process.exit(91)}',...imports.flatMap(path=>['--import',path]),command,group,...args],
    {stdio:'pipe',env:{NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',...env}});
  let resolvePrompt,rejectPrompt,resolveDone,rejectDone,completed,stderr='';
  const prompt=new Promise((yes,no)=>{resolvePrompt=yes;rejectPrompt=no;});prompt.catch(()=>{});
  const done=new Promise((yes,no)=>{resolveDone=yes;rejectDone=no;});done.catch(()=>{});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{
    try{const event=JSON.parse(line);if(event.event==='prompt')resolvePrompt(event);if(event.event==='done')completed=event;}
    catch(error){rejectPrompt(error);rejectDone(error);}
  });
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>{
    if(code!==0||signal||!completed){const error=Error(`PTY supervisor exit ${code}, signal ${signal}: ${stderr}`);rejectPrompt(error);rejectDone(error);}
    else{resolveDone(completed);rejectPrompt(Error('method review exited before prompt'));}resolve();
  }));
  child.once('error',error=>{rejectPrompt(error);rejectDone(error);});
  workspace.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;lines.close();});
  return {prompt,done,answer(answer){child.stdin.write(JSON.stringify({answer})+'\n');},eof(){child.stdin.write('{"eof":true}\n');}};
}
export function phrase(output) {
  const matches=[...output.matchAll(/To approve this exact operation, type ("[^\r\n]+") and press Enter\./g)];
  assert.equal(matches.length,1,output);return JSON.parse(matches[0][1]);
}
export function receipt(output) {
  const matches=output.split(/\r?\n/).filter(line=>line.startsWith('{"ok":'));
  assert.equal(matches.length,1,output);return JSON.parse(matches[0]);
}

export function runFile(w,args,{command=cli,imports=[],env={},signal=null}={}){
  const seq=readdirSync(w.path).length,out=join(w.path,'stdout-'+seq),err=join(w.path,'stderr-'+seq),o=openSync(out,'wx'),e=openSync(err,'wx');let result;
  try{result=spawnSync(process.execPath,[...imports.flatMap(path=>['--import',path]),command,...args],{timeout:30000,stdio:['ignore',o,e],env:{NODE_NO_WARNINGS:'1',...env}});}finally{closeSync(o);closeSync(e);}
  assert.equal(result.error,undefined);assert.equal(result.signal,signal,readFileSync(err,'utf8'));return {code:result.status,signal:result.signal,output:readFileSync(out,'utf8'),stderr:readFileSync(err,'utf8')};
}

/** Every export stdout line is a content-free envelope, including failures. */
export function assertExportReceipt(output,{version,byteCount,forbidden=[]}){
  for(const text of forbidden)if(text)assert.equal(output.includes(text),false,'export stdout must not disclose supplied content');
  if(!output)return; // A killed process need not have produced a receipt.
  const result=JSON.parse(output);assert.equal(output,JSON.stringify(result)+'\n');
  assert.equal(typeof result.ok,'boolean');
  if(result.ok||result.error?.code==='published-but-durability-uncertain')assert.ok(result.value);
  else assert.equal(result.value,undefined);
  assert.ok(Object.keys(result).every(key=>['ok','error','value'].includes(key)));
  if(result.error)assert.deepEqual(Object.keys(result.error).sort(),['code','retryable']);
  if(result.value){
    assert.deepEqual(Object.keys(result.value).sort(),['byteCount','status','version']);
    assert.ok(['published','published-but-durability-uncertain'].includes(result.value.status));
    assert.deepEqual(result.value.version,version);assert.equal(result.value.byteCount,byteCount);
  }
  const decoded=JSON.stringify(result);
  for(const text of forbidden)if(text)assert.equal(decoded.includes(text),false,'export receipt must not disclose supplied content');
}

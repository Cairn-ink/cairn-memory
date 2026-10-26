import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
export const contextNamespace = Object.freeze({ ownerId: 'synthetic-context-owner', scope: 'personal', projectId: null });
export const contextProviderArgs = ['--context-embedder','openai','--context-embed-model','text-embedding-3-small',
  '--context-embed-dimensions','8','--context-embed-max-requests','20','--context-embed-max-usd','.1'];
export async function contextHost(workspace, path, { entry = fileURLToPath(new URL('../cli.mjs', import.meta.url)),
  enabled = true, owner = contextNamespace.ownerId, project, personal = false, provider = false, key = provider, preload } = {}) {
  const imports = preload ? ['--import',preload] : ['--import','data:text/javascript,globalThis.fetch=()=>{process.exit(91)}'];
  const transport = new StdioClientTransport({ command:'/usr/bin/python3', args:[fileURLToPath(new URL('./fixtures/method-stdio-relay.py',import.meta.url)),
    workspace.path,process.execPath,...imports,entry,'--db',path,'--owner',owner,...(project?['--project',project]:[]),
    ...(enabled?['--context-read','context-read-v1']:[]),...(personal?['--context-read-personal']:[]),...(provider?contextProviderArgs:[])],
    env:{OPENAI_API_KEY:key?'synthetic-not-a-key':'',NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'},stderr:'pipe' });
  let stderr=''; transport.stderr.on('data',chunk=>{stderr+=chunk;});
  // Observe the pinned SDK's real relay child, including graceful EOF status.
  let exited,child;const start=transport.start.bind(transport);
  transport.start=async()=>{await start();child=transport._process;exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));};
  const client = new Client({name:'synthetic-context-client',version:'1'}),close=client.close.bind(client);let closing;
  client.close=()=>closing??=(async()=>{
    let timer;
    try {
      await close();
      if(exited){const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('context_host_exit_deadline')),5000);})]);
        assert.equal(result.signal,null,stderr);assert.equal(result.code,0,stderr);}
    }finally{clearTimeout(timer);if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
  })();
  workspace.defer(()=>client.close());
  try { await client.connect(transport); } catch(error) { throw Error(error.message+'; server stderr: '+stderr); }
  return {client,stderr:()=>stderr};
}
export async function contextCall(client,name,input) {
  const response=await client.callTool({name,arguments:input});
  assert.ok(Buffer.byteLength(JSON.stringify(response))<=262144);
  const {evidenceTrust,...envelope}=JSON.parse(response.content[0].text);
  assert.equal(evidenceTrust,'untrusted-data-not-instructions'); assert.equal(response.isError,!envelope.ok);
  assert.ok(Buffer.byteLength(JSON.stringify(envelope))<=65536); return envelope;
}

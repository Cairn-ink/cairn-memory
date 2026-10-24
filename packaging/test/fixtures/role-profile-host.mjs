import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '../../../adapters/mcp/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { StdioClientTransport } from '../../../adapters/mcp/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

export async function roleHost(workspace, entry, path, {project,personal=false,enabled=true,assets=false,owner='owner',onExit=()=>{}}={}) {
  const relay=fileURLToPath(new URL('../../../adapters/mcp/test/fixtures/method-stdio-relay.py',import.meta.url));
  const transport=new StdioClientTransport({command:'/usr/bin/python3',args:[relay,workspace.path,process.execPath,
    '--import','data:text/javascript,globalThis.fetch=()=>{process.exit(91)}',entry,'--db',path,'--owner',owner,
    ...(project?['--project',project]:[]),...(enabled?['--method-packages','local-v1','--context-read','context-read-v1','--role-profiles','local-v1']:[]),
    ...(personal?['--method-read-personal','--context-read-personal']:[]),...(assets?['--assets','local-v1']:[])],
    env:{NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'},stderr:'pipe'});
  let stderr='',child,exited;transport.stderr.on('data',chunk=>stderr+=chunk);
  const start=transport.start.bind(transport);transport.start=async()=>{await start();child=transport._process;exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));};
  const client=new Client({name:'installed-role-client',version:'1'}),close=client.close.bind(client);let closing;
  client.close=()=>closing??=(async()=>{let timer;try{await close();if(exited){const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('role_host_exit_deadline')),5000);})]);
    onExit(result);assert.equal(result.signal,null,stderr);assert.equal(result.code,0,stderr);}}finally{clearTimeout(timer);if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}})();
  workspace.defer(()=>client.close());try{await client.connect(transport);}catch(e){await client.close();throw Error(e.message+'; server stderr: '+stderr);}return client;
}
export const roleCall=async(client,name,args)=>{
  const response=await client.callTool({name,arguments:args});assert.equal(response.content.length,1);
  const parsed=JSON.parse(response.content[0].text);assert.equal(parsed.evidenceTrust,'untrusted-data-not-instructions');
  assert.equal(response.isError,!parsed.ok);return {response,envelope:parsed};
};

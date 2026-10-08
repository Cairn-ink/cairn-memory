// Offline reproduction of embedded hook schemas and generated app-server types.
// This tool never discovers or reads sessions. Supply the installed native ELF.
import { spawn } from 'node:child_process';
import { readFile,mkdir,lstat,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,join } from 'node:path';

const [binaryArg,outArg]=process.argv.slice(2);
if (!binaryArg || !outArg || process.argv.length!==4) throw new Error('usage: node scripts/qualify-codex.mjs <native-binary> <new-private-directory>');
const binary=resolve(binaryArg),out=resolve(outArg);
await mkdir(out,{mode:0o700}); // refuse reuse, symlinks and accidental adoption
const info=await lstat(out);
if (!info.isDirectory() || (info.mode&0o777)!==0o700 || info.uid!==process.getuid()) throw new Error('unsafe_output');
const home=join(out,'home');await mkdir(home,{mode:0o700});
const env={HOME:home,CODEX_HOME:home,PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
async function run(args) {
  return new Promise((resolveResult,reject)=>{
    const child=spawn(binary,args,{cwd:home,env,stdio:['ignore','pipe','ignore']});
    let text='';const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
    child.stdout.on('data',chunk=>{text+=chunk;if(text.length>65536)child.kill('SIGKILL');});
    child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolveResult({code,text});});
  });
}
const version=await run(['--version']);
if(version.code!==0 || version.text.trim()!=='codex-cli 0.160.1')throw new Error('unqualified_host');
const schemaDir=join(out,'schema');await mkdir(schemaDir,{mode:0o700});
const generated=await run(['app-server','generate-json-schema','--out',schemaDir]);
if(generated.code!==0)throw new Error('schema_generation_failed');
const schemaBytes=await readFile(join(schemaDir,'codex_app_server_protocol.schemas.json'));
const schema=JSON.parse(schemaBytes).definitions.v2;
const selected={};
for(const name of ['HookEventName','HookMetadata','HookTrustStatus','HooksListParams','ThreadHistoryMode','ThreadItem','UserInput','AgentMessageInputContent']) {
  if(!schema[name])throw new Error('schema_missing');selected[name]=schema[name];
}
await save('app-server-selected.json',selected);
const bytes=await readFile(binary);
const markers={};
for(const marker of ['internally tagged enum AgentMessageContent',
  'struct variant ThreadItem::AgentMessage with 6 elements','struct variant ThreadItem::UserMessage with 3 elements',
  'HookStartedhook_startedHookCompletedhook_completed','RolloutItemWiremessagereplacement_history',
  'struct variant AgentMessageContent::Text','struct variant AgentMessageContent::Text with 1 element']) {
  const offset=bytes.indexOf(Buffer.from(marker));
  if(offset<0)throw new Error('serde_marker_missing');
  markers[marker]={offset,excerpt:bytes.subarray(Math.max(0,offset-100),offset+500).toString('utf8')};
}
await save('serde-markers.json',markers);
const wanted=new Set(['session-start','user-prompt-submit','stop','pre-compact'].flatMap(event=>
  ['input','output'].map(direction=>event+'.command.'+direction)));
const schemas={};let offset=0;
const start=Buffer.from('{\n  "$schema"');
while((offset=bytes.indexOf(start,offset))!==-1) {
  const begin=offset;let depth=0,string=false,escaped=false;
  for(;offset<Math.min(bytes.length,begin+262144);offset++) {
    const char=bytes[offset];
    if(string){if(escaped)escaped=false;else if(char===92)escaped=true;else if(char===34)string=false;continue;}
    if(char===34)string=true;else if(char===123)depth++;else if(char===125 && --depth===0)break;
  }
  let value;try{value=JSON.parse(bytes.subarray(begin,offset+1));}catch{/* unrelated binary string */}
  offset++;
  if(wanted.has(value?.title))schemas[value.title]=value;
}
if(Object.keys(schemas).length!==wanted.size)throw new Error('embedded_schema_missing');
for(const [title,value]of Object.entries(schemas))await save(title+'.json',value);
await save('qualification.json',{version:'0.160.1',binarySha256:sha(bytes),generatedSchemaSha256:sha(schemaBytes),
  schemaExitCode:generated.code,embeddedHooks:Object.keys(schemas).sort(),network:false,
  note:'Type/schema evidence only; transcript serialization and native context placement need separate synthetic host evidence.'});
console.log('Offline Codex 0.160.1 schema evidence: 8 hook schemas; exit code 0.');

// Test harness only. Generated hooks receive unchanged arguments after this
// explicit preload. Production modules never read an environment host binding.
import { register } from 'node:module';
import { realpathSync } from 'node:fs';
import { relative,isAbsolute } from 'node:path';
const root=realpathSync(process.env.CAIRN_SYNTHETIC_FIXTURE_ROOT);
const binary=realpathSync(process.env.CAIRN_SYNTHETIC_CODEX),tail=relative(root,binary);
if(!process.env.NODE_TEST_CONTEXT || !tail || tail==='..' || tail.startsWith('../') || isAbsolute(tail))
  throw Error('synthetic_preload_outside_fixture');
register('data:text/javascript,'+encodeURIComponent(`
let binary;
export function initialize(value){binary=value;}
export async function load(url,context,next){
  const result=await next(url,context);
  if(!url.endsWith('/integrations/client/raw/local-codex-qualification.mjs'))return result;
  const before='export async function detectLocalCodexHost(detect) {';
  const after=before+'\\n detect ??= async()=>({binaryPath:'+JSON.stringify(binary)+',identity:await (await import("../../codex/qualification.mjs")).binaryIdentity('+JSON.stringify(binary)+'),kind:"cli"});';
  if(!String(result.source).includes(before))throw Error('synthetic_preload_seam_changed');
  return {...result,source:String(result.source).replace(before,after)};
}`),{parentURL:import.meta.url,data:binary});

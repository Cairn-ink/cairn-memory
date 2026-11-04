import { createRequire } from 'node:module';
import { dirname,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
export const defaultDependencyRoot=fileURLToPath(new URL('./counter-deps/',import.meta.url));
export function counterConfiguration(configuration={}){configuration??={};return {...configuration,dependencyRoot:configuration.dependencyRoot??process.env.QUAL_COUNTER_ROOT??defaultDependencyRoot};}
function dependencies(configuration) {
  const require=createRequire(pathToFileURL(resolve(counterConfiguration(configuration).dependencyRoot,'package.json')));
  for(const [name,version] of [['tiktoken','1.0.22'],['js-tiktoken','1.0.21']]) {
    let installed;
    try {const entry=require.resolve(name);installed=require(resolve(dirname(entry),name==='js-tiktoken'?'../package.json':'package.json')).version;}
    catch {throw Error('offline_counter_dependency_missing:'+name+'@'+version);}
    if(installed!==version)throw Error('offline_counter_dependency_version:'+name+':expected='+version+':actual='+installed);
  }
  return require;
}
export function counterAssets(configuration={}) {
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./counter-closure-child.mjs',import.meta.url)),JSON.stringify(counterConfiguration(configuration))],{encoding:'utf8',env:{},maxBuffer:1024*1024});
  if(child.status!==0||child.error)throw Error('counter_dependency_discovery_failed:'+child.status+':'+child.stderr);
  return [fileURLToPath(import.meta.url),fileURLToPath(new URL('./counter-closure-child.mjs',import.meta.url)),...JSON.parse(child.stdout)];
}
let encoder,loadedFrom;
export async function createCounter(configuration={}) {
  configuration??={};
  const require=dependencies(configuration),source=require.resolve('js-tiktoken/ranks/o200k_base');
  if(!encoder||loadedFrom!==source) {
    const {Tiktoken}=require('tiktoken/lite'),ranks=require('js-tiktoken/ranks/o200k_base');
    const next=new Tiktoken(ranks.bpe_ranks,ranks.special_tokens,ranks.pat_str);
    encoder?.free();encoder=next;loadedFrom=source;
  }
  const id=configuration.counterId??'o200k_base-v1';
  if(id!=='o200k_base-v1')throw Error('counter_identity_required:o200k_base-v1');
  return Object.freeze({id,countTokens(text){if(typeof text!=='string')throw Error('token_count_unavailable');return encoder.encode(text,[],[]).length;}});
}

import { createRequire } from 'node:module';
import { dirname,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
function dependencies(configuration) {
  const require=createRequire(configuration.dependencyRoot?pathToFileURL(resolve(configuration.dependencyRoot,'package.json')):new URL('../../adapters/openai/package.json',import.meta.url));
  for(const [name,version] of [['tiktoken','1.0.22'],['js-tiktoken','1.0.21']]) {
    let installed;
    try {const entry=require.resolve(name);installed=require(resolve(dirname(entry),name==='js-tiktoken'?'../package.json':'package.json')).version;}
    catch {throw Error('offline_counter_dependency_missing:'+name+'@'+version);}
    if(installed!==version)throw Error('offline_counter_dependency_version:'+name+':expected='+version+':actual='+installed);
  }
  return require;
}
export function counterAssets(configuration={}) {
  const require=dependencies(configuration);
  return [resolve(dirname(require.resolve('tiktoken')),'package.json'),resolve(dirname(require.resolve('js-tiktoken')),'../package.json'),...['tiktoken/lite','tiktoken/lite/tiktoken_bg.wasm','js-tiktoken/ranks/o200k_base'].map(name=>require.resolve(name))];
}
let encoder,loadedFrom;
export async function createCounter(configuration={}) {
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

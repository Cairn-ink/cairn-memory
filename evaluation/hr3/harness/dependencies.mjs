import { registerHooks } from 'node:module';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { resolve,sep } from 'node:path';
import {realpathSync} from 'node:fs';
import {fail} from './common.mjs';
export const APPROVED_DEPENDENCIES=Object.freeze({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
const repository=fileURLToPath(new URL('../../../',import.meta.url));let configured=false;
// Validate every option before installing any resolver or importing a package.
// Absolute spellings of these exact directories are accepted for local certifiers;
// alternate installations and symlink aliases are never execution configurations.
export function approvedDependencyConfiguration(options={}) {
  for(const key of Object.keys(options))if(!Object.hasOwn(APPROVED_DEPENDENCIES,key))fail('unapproved_dependency_option');
  for(const [kind,path]of Object.entries(APPROVED_DEPENDENCIES)){
    const expected=resolve(repository,path),selected=options[kind]??expected;
    if(typeof selected!=='string'||resolve(selected)!==expected)fail('unapproved_dependency_path:'+kind);
    if(realpathSync(expected)!==expected)fail('unapproved_dependency_symlink:'+kind);
  }
  return {...APPROVED_DEPENDENCIES};
}
export function useInstalledDependencies(options={}) {
  const approved=approvedDependencyConfiguration(options);
  if(configured)return approved;
  registerHooks({resolve(specifier,context,next) {
    const kind=specifier==='tiktoken'?'tokenizer':specifier==='zod/v4'||specifier.startsWith('@modelcontextprotocol/')?'mcp':null;
    const result=next(specifier,kind?{...context,parentURL:pathToFileURL(resolve(repository,approved[kind],'..','hr3-resolver.mjs')).href}:context);
    if(result.url.startsWith('file:')&&fileURLToPath(result.url).includes(sep+'node_modules'+sep)){
      const actual=realpathSync(fileURLToPath(result.url));
      if(!Object.values(approved).some(p=>actual.startsWith(resolve(repository,p)+sep)))fail('dependency_resolution_outside_closure');
    }
    return result;
  }});
  configured=true;return approved;
}
export function verifyInstalledDependencies() {
  const approved=useInstalledDependencies();
  for(const [specifier,kind]of [['tiktoken','tokenizer'],['zod/v4','mcp'],['@modelcontextprotocol/server','mcp']]){
    const url=import.meta.resolve(specifier),root=resolve(repository,approved[kind])+sep;
    if(!url.startsWith('file:')||!realpathSync(fileURLToPath(url)).startsWith(root))fail('dependency_resolution_mismatch:'+kind);
  }
  return approved;
}
export async function tokenCounter() {
  verifyInstalledDependencies();
  const {get_encoding}=await import('tiktoken');const encoder=get_encoding('o200k_base');
  return {id:'tiktoken-o200k_base',countTokens:text=>encoder.encode(text,[],[]).length,close:()=>encoder.free()};
}

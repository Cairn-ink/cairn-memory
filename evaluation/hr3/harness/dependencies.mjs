import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Optional offline resolution into existing installations, never installs packages.
export function useInstalledDependencies({mcp,tokenizer}={}) {
  registerHooks({resolve(specifier,context,next) {
    const root=(specifier==='tiktoken'?tokenizer:specifier==='zod/v4'||specifier.startsWith('@modelcontextprotocol/')?mcp:null);
    if(root)return next(specifier,{...context,parentURL:pathToFileURL(resolve(root,'..','hr3-resolver.mjs')).href});
    return next(specifier,context);
  }});
}
export async function tokenCounter() {
  const {get_encoding}=await import('tiktoken');const encoder=get_encoding('o200k_base');
  return {id:'tiktoken-o200k_base',countTokens:text=>encoder.encode(text,[],[]).length,close:()=>encoder.free()};
}

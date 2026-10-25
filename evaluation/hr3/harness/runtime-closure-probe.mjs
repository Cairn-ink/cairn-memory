// Read-only module-definition probe: no constructors, requests or paid CLI run.
import {registerHooks} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';import {pathToFileURL,fileURLToPath} from 'node:url';import {resolve,relative} from 'node:path';
import {useInstalledDependencies} from './dependencies.mjs';
const root=process.cwd(),files=new Set(),edges=[];const local=url=>url?.startsWith('file:')&&!url.includes('/node_modules/')&&fileURLToPath(url).startsWith(root+'/');
useInstalledDependencies({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
registerHooks({resolve(specifier,context,next){const r=next(specifier,context);if(local(r.url)){files.add(relative(root,fileURLToPath(r.url)));edges.push({from:context.parentURL&&local(context.parentURL)?relative(root,fileURLToPath(context.parentURL)):null,specifier,to:relative(root,fileURLToPath(r.url))});}return r;}});
const roots=JSON.parse(process.argv[2]);for(const p of roots){files.add(p);if(!p.endsWith('/cli-real.mjs'))await import(pathToFileURL(resolve(p)));}
// The paid CLI is never evaluated: its imports are already probed via explicit
// runner/transport roots. Include its entry bytes in both enumerations.
writeFileSync(process.argv[3],JSON.stringify({files:[...files].sort(),edges:edges.map(e=>({...e,specifier:e.specifier.startsWith('file:')?relative(root,fileURLToPath(e.specifier)):e.specifier}))})+'\n');

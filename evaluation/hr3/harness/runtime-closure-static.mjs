// Independent source-parser traversal, without evaluating application modules.
import {SourceTextModule} from 'node:vm';import {readFileSync,writeFileSync} from 'node:fs';import {fileURLToPath,pathToFileURL} from 'node:url';import {relative,resolve} from 'node:path';
import {useInstalledDependencies} from './dependencies.mjs';
useInstalledDependencies({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
const root=process.cwd(),seen=new Set(),edges=[],queue=JSON.parse(process.argv[2]);
while(queue.length){const p=queue.shift();if(seen.has(p))continue;seen.add(p);const url=pathToFileURL(resolve(p)).href,source=readFileSync(p,'utf8');
 const parsed=new SourceTextModule(source,{identifier:url});const specs=[...parsed.dependencySpecifiers,...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1])];
 for(const specifier of specs){const target=import.meta.resolve(specifier,url);if(!target.startsWith('file:')||target.includes('/node_modules/')||!fileURLToPath(target).startsWith(root+'/'))continue;const to=relative(root,fileURLToPath(target));edges.push({from:p,specifier,to});queue.push(to);}
}
writeFileSync(process.argv[3],JSON.stringify({files:[...seen].sort(),edges})+'\n');

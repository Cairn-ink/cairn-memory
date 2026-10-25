#!/usr/bin/env node
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync,statSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {hash} from './common.mjs';
export function runtimeClosure(){
 const h='evaluation/hr3/harness',runner='evaluation/hr3/runner';
 const roots=[h+'/runner.mjs',h+'/product.mjs',...readdirSync(runner).filter(n=>n.endsWith('.mjs')).map(n=>runner+'/'+n)];
 function probe(script,args=[]){const dir=mkdtempSync(h+'/artifacts/closure-probe-'),out=dir+'/result.json';try{const r=spawnSync(process.execPath,[...args,h+'/'+script,JSON.stringify(roots),out],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(readFileSync(out));}finally{rmSync(dir,{recursive:true,force:true});}}
 const loaded=probe('runtime-closure-probe.mjs'),parsed=probe('runtime-closure-static.mjs',['--experimental-vm-modules','--experimental-import-meta-resolve']);
 assert.deepEqual(loaded.files,parsed.files,'Runtime loader / source-parser dependency closure mismatch');
 const pin=JSON.parse(readFileSync(h+'/product-pin.json'));const names=[...new Set([...loaded.files,...Object.keys(pin.files),h+'/runtime-closure-probe.mjs',h+'/runtime-closure-static.mjs',h+'/product-pin.json','evaluation/hr3/generator/public-contract.json',h+'/reports/private-field-inventory-a4.json'])].sort();
 for(const [p,digest]of Object.entries(pin.files))assert.equal(hash(readFileSync(p)),digest,p);
 const files=Object.fromEntries(names.map(p=>[p,{sha256:hash(readFileSync(p)),bytes:readFileSync(p).length}]));
 // External package bytes are frozen explicitly as well, including lazy WASM.
 function walk(p){return readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);}
 const externalRoots=['adapters/mcp/node_modules','adapters/openai/node_modules'],externalPaths=externalRoots.flatMap(walk).sort();
 const externalIndependent=externalRoots.flatMap(root=>readdirSync(root,{recursive:true}).map(n=>root+'/'+n).filter(p=>statSync(p).isFile())).sort();assert.deepEqual(externalPaths,externalIndependent,'External dependency inventory mismatch');
 const externalFiles=Object.fromEntries(externalPaths.map(p=>[p,{sha256:hash(readFileSync(p)),bytes:readFileSync(p).length}]));
 // Certificate fingerprints must cover installed dependencies as well as the
 // repository graph; a package change before freeze requires recertification.
 Object.assign(files,externalFiles);
 return {version:'hr3-runtime-closure-a4-audit-v1',status:'PASS',roots,staticFiles:parsed.files,loaderFiles:loaded.files,staticEdges:parsed.edges,loaderEdges:loaded.edges,files,externalRoots,externalFiles,externalCrossCheck:{routes:['recursive Dirent walk','native recursive readdir plus file-stat filtering'],count:externalPaths.length},methods:['Node resolver hook while importing module definitions only (paid CLI not evaluated)','Independent SourceTextModule dependency traversal plus literal dynamic imports'],pinSuperset:Object.keys(pin.files).sort(),paidCalls:0,networkCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=runtimeClosure();writeFileSync('evaluation/hr3/harness/reports/runtime-closure-a4.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,modules:r.staticFiles.length,pinnedAndRuntimeFiles:Object.keys(r.files).length,externalFiles:Object.keys(r.externalFiles).length}));}

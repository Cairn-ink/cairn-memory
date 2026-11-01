// SQLite-free dependency discovery; observes real CJS loads and WASM reads.
import fs from 'node:fs';
import { createRequire,syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCounter } from './counter.mjs';
const configuration=JSON.parse(process.argv[2]),files=new Set(),read=fs.readFileSync;
fs.readFileSync=function(path,...args){if(typeof path==='string'||path instanceof URL)files.add(path instanceof URL?fileURLToPath(path):path);return read.call(this,path,...args);};syncBuiltinESMExports();
try {const counter=await createCounter(configuration);counter.countTokens('東京 <|endoftext|>');
  const require=createRequire(import.meta.url);
  for(const path of Object.keys(require.cache))files.add(path);
  console.log(JSON.stringify([...files].sort()));
}finally{fs.readFileSync=read;syncBuiltinESMExports();}

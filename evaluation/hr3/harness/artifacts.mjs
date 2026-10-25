import { readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJSON,canonical,hash,fail } from './common.mjs';
export function artifactManifest(root,written) {
  const disk=[];
  function visit(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const relative=prefix+e.name;if(e.isDirectory())visit(join(dir,e.name),relative+'/');else if(e.isFile())disk.push(relative);else fail('unexpected_artifact_type');}}
  visit(root);const expected=[...new Set(written)].sort();disk.sort();
  if(canonical(expected)!==canonical(disk))fail('artifact_inventory_mismatch');
  const files=Object.fromEntries(disk.map(path=>{const data=readFileSync(join(root,path));return [path,{bytes:data.length,sha256:hash(data)}];}));
  const manifest={version:'hr3-artifacts-a6-v1',count:disk.length,routes:['explicit artifact write log','recursive filesystem enumeration + byte readback'],files};atomicJSON(join(root,'manifest.json'),manifest);return manifest;
}

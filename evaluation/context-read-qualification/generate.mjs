// Controller has no SQLite imports/connections. Hashing uses the existing
// short SQLite-free IO child, after the generator has exited successfully.
import { spawnSync } from 'node:child_process';
import { mkdirSync,existsSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSpecs } from './corpus.mjs';
import { fileChild } from '../../tools/testing/fixtures/context-product/actors.mjs';
export function generateSnapshot(spec,path) {
  if(!spec.inspectOnly&&existsSync(path))throw Error('destination_exists:'+path);
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./generate-child.mjs',import.meta.url)),JSON.stringify({...spec,path})],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','inherit']});
  if(child.error||child.status!==0)throw Error(`generator_exit:${child.status}: ${child.stderr}`);
  return {...JSON.parse(child.stdout),fileHash:fileChild('hash',path).value[0].hash};
}
export function prepareSnapshots(volumeRoot) {
  const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
  const directory=join(resolve(volumeRoot),'qualification-snapshots');mkdirSync(directory,{recursive:true});
  for(const spec of fixtureSpecs) {
    const path=join(directory,spec.id+'.sqlite');
    const actual=generateSnapshot(spec,path),expected=manifest.snapshots.find(s=>s.id===spec.id);
    for(const key of ['contentHash','schemaHash'])if(actual[key]!==expected?.[key])throw Error('manifest_mismatch:'+spec.id+':'+key);
    console.log(JSON.stringify({id:spec.id,path,contentHash:actual.contentHash,schemaHash:actual.schemaHash,fileHash:actual.fileHash,verified:true}));
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv[2]!=='--volume-root'||!process.argv[3])throw Error('usage: generate.mjs --volume-root DIRECTORY');
  prepareSnapshots(process.argv[3]);
}

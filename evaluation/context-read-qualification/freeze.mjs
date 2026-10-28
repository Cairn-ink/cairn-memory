// Offline authoring controller. SQLite creation runs only in generator children.
import { mkdirSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSnapshot } from './generate.mjs';
import { fixtureSpecs,queries,seed } from './corpus.mjs';
import { goldRanking } from './gold-rank.mjs';
export function freezeInputs(directory,{write=false}={}) {
  mkdirSync(directory,{recursive:true});const snapshots=[],fixtures=[];
  for(const spec of fixtureSpecs) {
    const actual=generateSnapshot(spec,join(directory,spec.id+'.sqlite'));
    snapshots.push({id:spec.id,count:spec.count,schema:spec.schema,cards:spec.cards,contentHash:actual.contentHash,schemaHash:actual.schemaHash});
    const catalog=actual.catalog.filter(c=>c.ordinal<24);
    fixtures.push({id:spec.id,count:spec.count,schema:spec.schema,catalog,queries:queries.map(q=>{
      const relevant=q.knownMiss?catalog.filter(c=>c.ref.type==='memory'&&c.ordinal===12).map(c=>c.ref):goldRanking(actual.catalog,q.query),ranking=q.knownMiss?[]:relevant;
      return {id:q.id,relevant,ranking,knownMisses:q.knownMiss?relevant:[],recallAt5:relevant.length?ranking.slice(0,5).length/relevant.length:null,recallAt12:relevant.length?ranking.slice(0,12).length/relevant.length:null};
    })});
    console.log(JSON.stringify({id:spec.id,verified:true}));
  }
  const manifest={seed,hashAlgorithm:'sha256',contentEncoding:'sorted SQLite table name + sorted JSON rows, newline; includes all canonical tables',snapshots},labels={version:1,provenance:'Synthetic canonical relevance and independently computed BM25 ranking; exact-bound language-bearing large bodies and the single-Han miss retained.',fixtures};
  if(write){writeFileSync(new URL('./manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');writeFileSync(new URL('./labels.json',import.meta.url),JSON.stringify(labels,null,2)+'\n');writeFileSync(new URL('./queries.json',import.meta.url),JSON.stringify(queries,null,2)+'\n');}
  return {manifest,labels};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),i=args.indexOf('--volume-root');if(i<0)throw Error('volume_root_required');freezeInputs(resolve(args[i+1]),{write:args.includes('--write')});
}

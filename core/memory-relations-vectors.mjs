import { AsyncLocalStorage } from 'node:async_hooks';
import { cosine, loadVector, validateVector, reserveSharedVectors } from './context-read-embedder.mjs';
import { REPRESENTATION_VERSION } from './context-read-tokenize.mjs';

const captureVectors=new AsyncLocalStorage();
export const withMemoryRelationVectors=(config,work)=>captureVectors.run(config,work);

// Existing vectors are optional evidence for discovery, never authority. The
// writer resolves every ranked ref in its own exact namespace before dispatch.
export async function unionMemoryRelationCandidates(ns,facts,lexical,resolve,identity,deadline,validateFresh){
 const fallback=()=>lexical.map(rows=>rows.slice(0,8));
 const config=captureVectors.getStore();
 if(!config?.embedder||!config.dispatch||config.path===':memory:')return fallback();
 const path=config.path+'.context-read-v1.sqlite';
 let side,reservation,timer;
 try{
  const { assertContextReadVectorFile }=await import('./context-read-sidecar.mjs');
  assertContextReadVectorFile(path);
  const {DatabaseSync}=await import('node:sqlite');
  side=new DatabaseSync(path,{readOnly:true,timeout:0});
  side.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
  const port=config.embedder;
  const namespace=JSON.stringify({ownerId:ns.ownerId,scope:ns.scope,projectId:ns.projectId||null});
  const predicate="store_id=? AND namespace=? AND type='memory' AND representation=? AND embedder_id=? AND embedder_revision=? AND dimensions=? AND normalization=?";
  const parameters=[identity.storeId,namespace,REPRESENTATION_VERSION,port.id,port.revision,port.dimensions,port.normalization];
  // Reserve before materializing any vector bytes. Metadata comes first; BLOB
  // point reads retain only one vector per revision across cache generations.
  const keys=side.prepare(`SELECT id,revision,generation,stream FROM (SELECT id,revision,generation,stream,
   row_number() OVER(PARTITION BY id,revision ORDER BY generation,stream) choice FROM vectors WHERE ${predicate}) WHERE choice=1 LIMIT 20001`).all(...parameters);
  if(!keys.length||keys.length>20000)return fallback();
  reservation=reserveSharedVectors(keys.length,port,keys.length*1024);
  if(!reservation)return fallback();
  const remaining=deadline?.remainingMs()??4000;
  const deadlineAt=performance.now()+Math.min(3000,Math.max(0,remaining-Math.min(1000,Math.max(100,remaining*.25))));
  const load=side.prepare(`SELECT data FROM vectors WHERE ${predicate} AND generation=? AND stream=? AND id=? AND revision=? LIMIT 1`);
  const vectors=[];
  for(const key of keys){
   if(performance.now()>=deadlineAt)return fallback();
   vectors.push({...key,vector:loadVector(load.get(...parameters,key.generation,key.stream,key.id,key.revision).data,port)});
  }
  side.close();side=null;
  const allowed=new Map();
  const controller=new AbortController();
  const embedFacts=async()=>{
   const queries=[],size=Math.max(1,Math.min(facts.length,config.batchSize??facts.length));
   for(let start=0;start<facts.length;start+=size){
    const batch=await config.dispatch(port,facts.slice(start,start+size).map(fact=>fact.content),{
     signal:controller.signal,deadlineAt,guard:validateFresh??(()=>{})});
    validateFresh?.();
    if(!Array.isArray(batch)||batch.length!==Math.min(size,facts.length-start))throw Error('invalid_relation_vectors');
    queries.push(...batch);
   }
   return queries;
  };
  const queries=await Promise.race([embedFacts(),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('relation_vector_timeout'));},Math.max(0,deadlineAt-performance.now()));})]);
  validateFresh?.();
  if(!Array.isArray(queries)||queries.length!==facts.length)return fallback();
  return facts.map((fact,index)=>{
   const query=validateVector(queries[index],port);
   const ranked=vectors.map(row=>({id:row.id,revision:row.revision,score:cosine(query,row.vector)}))
    .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
   const semantic=[];
   for(let start=0;start<ranked.length&&semantic.length<10;start+=10){
    if(performance.now()>=deadlineAt)break;
    const chunk=ranked.slice(start,start+10),missing=chunk.filter(row=>!allowed.has(row.id+':'+row.revision));
    const current=new Map(resolve(missing).map(row=>[row.id+':'+row.revision,row]));
    for(const row of missing)allowed.set(row.id+':'+row.revision,current.get(row.id+':'+row.revision)??null);
    for(const row of chunk){const candidate=allowed.get(row.id+':'+row.revision);if(candidate&&semantic.length<10)semantic.push({...candidate,score:row.score});}
   }
   const union=new Map();
   for(let i=0;i<10&&union.size<8;i++)for(const row of [lexical[index][i],semantic[i]]){
    if(row&&!union.has(row.id)&&union.size<8){const {score,vector,...candidate}=row;union.set(row.id,candidate);}
   }
   return [...union.values()];
  });
 }catch{return fallback();}
 finally{clearTimeout(timer);side?.close();reservation?.release();}
}

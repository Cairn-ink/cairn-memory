import { randomUUID, createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalJson, digest } from './context-product-validation.mjs';
import { VECTOR_VERSION, signVectorRecord, verifyVectorRecord, vectorPointer, verifyVectorPointer, canonicalVectorBytes, manifestVector } from './context-vector-validation.mjs';
import { semanticCapacity, loadVector, cosine } from './context-read-embedder.mjs';
import { rankScores } from './context-read-bm25.mjs';
import { ManifestHash } from './context-product-manifest.mjs';
import { PRODUCT_PROFILE } from './context-product-control.mjs';
import { fail } from './validation.mjs';
import { compareCanonical } from './context-read-bm25.mjs';

export const VECTOR_DDL=`
CREATE TABLE semantic_vectors(owner TEXT NOT NULL,identity TEXT NOT NULL,epoch INTEGER NOT NULL,item TEXT NOT NULL,revision INTEGER NOT NULL,body_revision INTEGER NOT NULL,representation TEXT NOT NULL,vector BLOB NOT NULL,sort_key BLOB NOT NULL,PRIMARY KEY(owner,identity,epoch,item,revision,body_revision,representation)) STRICT;
CREATE TABLE vector_generations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,projection TEXT NOT NULL,identity TEXT NOT NULL,epoch INTEGER NOT NULL,lexical TEXT NOT NULL,state TEXT NOT NULL,published INTEGER NOT NULL) STRICT;
CREATE TABLE vector_rows(generation TEXT NOT NULL,item TEXT NOT NULL,revision INTEGER NOT NULL,body_revision INTEGER NOT NULL,representation TEXT NOT NULL,vector BLOB,sort_key BLOB NOT NULL,PRIMARY KEY(generation,sort_key),UNIQUE(generation,item)) STRICT;
CREATE TABLE vector_validation_records(publication TEXT PRIMARY KEY,owner TEXT NOT NULL,record TEXT NOT NULL) STRICT;
CREATE TABLE vector_publications(projection TEXT PRIMARY KEY,owner TEXT NOT NULL,pointer TEXT NOT NULL) STRICT;
CREATE TABLE vector_work(projection TEXT PRIMARY KEY,generation TEXT NOT NULL) STRICT;
CREATE TABLE vector_purge_checkpoints(owner TEXT PRIMARY KEY,epoch INTEGER NOT NULL,record TEXT NOT NULL) STRICT;
CREATE INDEX semantic_vector_owner ON semantic_vectors(owner,sort_key);
CREATE INDEX vector_generation_owner ON vector_generations(owner,id);
`;
export const vectorSchema=VECTOR_DDL.trim().split(';').filter(s=>s.trim()).map(sql=>{
  sql=sql.trim();const m=/^CREATE (TABLE|INDEX) (\w+)/.exec(sql);
  return {type:m[1].toLowerCase(),name:m[2],tbl_name:m[1]==='TABLE'?m[2]:/ ON (\w+)/.exec(sql)[1],sql};
});
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const lookup=`SELECT vector FROM semantic_vectors WHERE owner=? AND identity=? AND epoch=? AND item=? AND revision=? AND body_revision=? AND representation=?`;
const rowRef=r=>{const [ownerId,scope,projectId,type,id]=JSON.parse(r.identity??r.item);return {type,namespace:{ownerId,scope,projectId:projectId||null},[type==='memory'?'memoryId':'cardId']:id,revision:r.revision,...(type==='card'?{bodyRevision:r.body_revision}:{})};};
const sortKey=item=>Buffer.concat(JSON.parse(item).flatMap(value=>[Buffer.from(value),Buffer.from([0])]));
function orderedStreams(p) {
  let stream=0;
  return p.readSet.flatMap(ns=>['card','memory'].filter(type=>p.types.includes(type)).flatMap(type=>(type==='card'?['draft','confirmed','cancelled','deleted']:['memory']).map(()=>({stream:stream++,ref:{namespace:ns,type,memoryId:''}}))))
    .sort(compareCanonical);
}
const manifestRow=(r,identity)=>{
  const ref=rowRef(r);return {item:{...ref.namespace,type:ref.type,id:ref.memoryId??ref.cardId},revision:ref.revision,
    bodyRevision:ref.bodyRevision??null,representation:r.representation,vector:r.vector===null?null:manifestVector(r.vector,identity)};
};
export function productVectors({storage,facade}) {
  const {identity:store}=facade.port;
  function observe(p,lexical,snapshot,{load=false}={}) {
    const missing={status:'partial',reason:'missing_vectors',record:null,rows:[]};
    if(!lexical)return {...missing,status:'unavailable',reason:'index_not_ready'};
    const capacity=semanticCapacity(Object.values(lexical.counts.byType).reduce((n,c)=>n+c.eligible,0),snapshot.identity);
    if(!capacity.eligible)return {...missing,reason:'capacity_exceeded'};
    try {
      const observed=storage.vectors(db=>{
        const currentLexical=db.prepare('SELECT publication,generation FROM publications WHERE projection=?').get(lexical.projectionDigest);
        if(currentLexical?.publication!==lexical.publicationId||currentLexical.generation!==lexical.generation.id)throw Error('invalid');
        const pointer=db.prepare('SELECT substr(pointer,1,4097) AS pointer FROM vector_publications WHERE projection=? AND owner=?').get(lexical.projectionDigest,p.readSet[0].ownerId)?.pointer;
        if(!pointer)return missing;
        let decoded;try{decoded=JSON.parse(pointer);}catch{throw Error('invalid');}
        const text=db.prepare('SELECT substr(record,1,16385) AS record FROM vector_validation_records WHERE publication=? AND owner=?').get(decoded.publicationId,p.readSet[0].ownerId)?.record;
        if(!text)return missing;
        const record=verifyVectorRecord(store.cursorSecret,text,lexical,snapshot.identity,snapshot.policy.purgeEpoch);
        verifyVectorPointer(pointer,record);
        const generation=db.prepare('SELECT id,owner,projection,identity,epoch,lexical,substr(state,1,8193) AS state,published FROM vector_generations WHERE id=?').get(record.generation.id);
        if(generation?.published!==1||generation.owner!==p.readSet[0].ownerId||generation.lexical!==digest(lexical)||generation.identity!==digest(snapshot.identity)||generation.epoch!==snapshot.policy.purgeEpoch||generation.projection!==lexical.projectionDigest)throw Error('invalid');
        if(Buffer.byteLength(generation.state)>8192)throw Error('invalid');
        const sealed=JSON.parse(generation.state);
        if(canonicalJson(sealed)!==generation.state||sealed.mac!==createHmac('sha256',store.cursorSecret).update(PRODUCT_PROFILE+'/vector-progress\0'+canonicalJson(sealed.body)).digest('base64url')||
          sealed.body.phase!==2||!same({id:generation.id,sequence:sealed.body.sequence,checkpoint:sealed.body.checkpoint,incarnation:sealed.body.incarnation},record.generation))throw Error('invalid');
        const complete=Object.values(record.counts.byType).every(c=>c.eligible===c.embedded),rows=[];
        return {status:complete?'complete':'partial',reason:complete?null:'missing_vectors',record,rows};
      })??missing;
      if(load&&observed.status==='complete') {
        let after='';
        for(;;) {
          if(performance.now()>=p.deadlineAt)fail('read_timeout');
          const page=storage.vectors(db=>db.prepare(`SELECT r.item,r.revision,r.body_revision,r.representation,CASE WHEN length(r.vector)=6144 THEN hex(r.vector) ELSE '' END AS bytes,
            d.revision AS expected_revision,d.body_revision AS expected_body,d.representation AS expected_representation
            FROM vector_rows r LEFT JOIN documents d ON d.generation=? AND d.identity=r.item AND d.eligible=1
            WHERE r.generation=? AND r.item>? ORDER BY r.item LIMIT 128`).all(lexical.generation.id,observed.record.generation.id,after));
          for(const row of page) {
            const ref=rowRef(row),bytes=Buffer.from(row.bytes,'hex');
            if(row.revision!==row.expected_revision||row.body_revision!==row.expected_body||row.representation!==row.expected_representation||!p.readSet.some(ns=>same(ns,ref.namespace)))throw Error('invalid');
            manifestVector(bytes,snapshot.identity);observed.rows.push({ref,vector:loadVector(bytes,snapshot.identity)});
          }
          if(page.length<128)break;after=page.at(-1).item;
        }
        if(observed.rows.length!==observed.record.counts.vectors)throw Error('invalid');
      }
      return observed;
    } catch(error) {
      if(['read_timeout','ERR_SQLITE_ERROR'].includes(error.code))throw error;
      return {...missing,status:error.reason==='identity_changed'?'partial':'unavailable',reason:error.reason==='identity_changed'?'identity_changed':'validation_invalid'};
    }
  }
  function plan(p,lexical,snapshot,maximum) {
    return storage.vectors(db=>{
      const found=[],id=digest(snapshot.identity),epoch=snapshot.policy.purgeEpoch,owner=p.readSet[0].ownerId;
      for(const stream of orderedStreams(p)) {
        let after='';
        while(found.length<maximum) {
        if(performance.now()>=p.deadlineAt)break;
        const rows=db.prepare('SELECT * FROM documents WHERE generation=? AND stream=? AND eligible=1 AND id>? ORDER BY id LIMIT 128').all(lexical.generation.id,stream.stream,after);
        for(const row of rows) {
          if(!db.prepare(lookup).get(owner,id,epoch,row.identity,row.revision,row.body_revision,row.representation))found.push({...row,ref:rowRef(row)});
          if(found.length===maximum)break;
        }
        if(rows.length<128)break;after=rows.at(-1).id;
        }
        if(found.length===maximum)break;
      }
      return found;
    })??[];
  }
  function put(p,lexical,snapshot,rows,vectors) {
    return storage.vectors(db=>{
      if(!facade.port.read(()=>storage.vectorFence(p,lexical)))fail('index_unavailable');
      const current=db.prepare('SELECT publication FROM publications WHERE projection=?').get(lexical.projectionDigest);
      if(current?.publication!==lexical.publicationId)fail('index_unavailable');
      for(let i=0;i<rows.length;i++) {
        const r=rows[i];db.prepare('INSERT OR IGNORE INTO semantic_vectors VALUES(?,?,?,?,?,?,?,?,?)').run(p.readSet[0].ownerId,digest(snapshot.identity),snapshot.policy.purgeEpoch,r.identity,r.revision,r.body_revision,r.representation,canonicalVectorBytes(vectors[i],snapshot.identity),sortKey(r.identity));
      }
      db.prepare('DELETE FROM vector_work WHERE projection=?').run(lexical.projectionDigest);
    },true);
  }
  // Verification hashes bounded pages and durably authenticates its checkpoint.
  // No manifest or canonical body is assembled in memory by a read request.
  function certify(p,lexical,snapshot) {
    const owner=p.readSet[0].ownerId,id=digest(snapshot.identity),epoch=snapshot.policy.purgeEpoch,ld=digest(lexical);
    const mac=body=>createHmac('sha256',store.cursorSecret).update(PRODUCT_PROFILE+'/vector-progress\0'+canonicalJson(body)).digest('base64url');
    const seal=body=>canonicalJson({body,mac:mac(body)});
    const unseal=text=>{const r=JSON.parse(text);if(canonicalJson(r)!==text||r.mac!==mac(r.body))fail('index_unavailable');return r.body;};
    while(performance.now()<p.deadlineAt) {
      const done=storage.vectors(db=>{
        if(db.prepare('SELECT publication FROM publications WHERE projection=?').get(lexical.projectionDigest)?.publication!==lexical.publicationId)fail('index_unavailable');
        let g=db.prepare('SELECT g.* FROM vector_work w JOIN vector_generations g ON g.id=w.generation WHERE w.projection=?').get(lexical.projectionDigest);
        if(!g||g.lexical!==ld||g.identity!==id||g.epoch!==epoch) {
          const prior=db.prepare('SELECT pointer FROM vector_publications WHERE projection=?').get(lexical.projectionDigest);
          const sequence=prior?JSON.parse(prior.pointer).generation.sequence+1:1;
          g={id:randomUUID(),owner,projection:lexical.projectionDigest,identity:id,epoch,lexical:ld};
          const state={phase:0,after:'',seen:Object.fromEntries(Object.keys(lexical.counts.byType).map(t=>[t,0])),counts:{byType:Object.fromEntries(Object.entries(lexical.counts.byType).map(([t,c])=>[t,{eligible:c.eligible,embedded:0}])),vectors:0,vectorBytes:0},sequence,checkpoint:0,incarnation:randomUUID(),hash:null};
          g.state=seal(state);
          db.prepare('INSERT INTO vector_generations VALUES(?,?,?,?,?,?,?,0)').run(g.id,owner,g.projection,id,epoch,ld,g.state);
          db.prepare('INSERT OR REPLACE INTO vector_work VALUES(?,?)').run(g.projection,g.id);
        }
        const s=unseal(g.state);
        if(s.phase===0) {
          const page=db.prepare('SELECT * FROM documents WHERE generation=? AND eligible=1 AND identity>? ORDER BY identity LIMIT 128').all(lexical.generation.id,s.after);
          for(const row of page) {
            s.seen[rowRef(row).type]++;
            const vector=db.prepare(lookup).get(owner,id,epoch,row.identity,row.revision,row.body_revision,row.representation)?.vector??null;
            if(vector!==null){manifestVector(vector,snapshot.identity);s.counts.byType[rowRef(row).type].embedded++;s.counts.vectors++;s.counts.vectorBytes+=vector.byteLength;}
            db.prepare('INSERT INTO vector_rows VALUES(?,?,?,?,?,?,?)').run(g.id,row.identity,row.revision,row.body_revision,row.representation,vector,sortKey(row.identity));s.after=row.identity;
          }
          if(page.length<128) {
            if(Object.entries(s.counts.byType).some(([t,c])=>s.seen[t]!==c.eligible||c.embedded>c.eligible))fail('index_unavailable');
            s.phase=1;s.after='';
            const prefix=canonicalJson({counts:s.counts,identity:snapshot.identity,lexicalValidationDigest:ld,purgeEpoch:epoch,representation:lexical.representation});
            s.hash=new ManifestHash().update(prefix.slice(0,-1)+',"rows":[').state();
          }
        } else if(s.phase===1) {
          const page=db.prepare('SELECT * FROM vector_rows WHERE generation=? AND sort_key>? ORDER BY sort_key LIMIT 128').all(g.id,Buffer.from(s.after,'hex')),hash=new ManifestHash(s.hash);
          for(const row of page) {
            const document=db.prepare('SELECT * FROM documents WHERE generation=? AND identity=? AND eligible=1').get(lexical.generation.id,row.item);
            if(!document||document.revision!==row.revision||document.body_revision!==row.body_revision||document.representation!==row.representation||!Buffer.from(row.sort_key).equals(sortKey(row.item)))fail('index_unavailable');
            hash.update((s.after?',':'')+canonicalJson(manifestRow(row,snapshot.identity)));s.after=Buffer.from(row.sort_key).toString('hex');
          }
          s.hash=hash.state();if(page.length<128)s.phase=2;
        }
        s.checkpoint++;
        if(s.phase===2) {
          if(!facade.port.read(()=>storage.vectorFence(p,lexical)))fail('index_unavailable');
          const hash=new ManifestHash(s.hash).update('],"version":"context-vector-manifest-p2e-v1"}');
          const {mac:ignored,...bindings}=lexical;
          const body={version:VECTOR_VERSION,profile:PRODUCT_PROFILE,format:1,storeId:lexical.storeId,canonical:lexical.canonical,sidecar:lexical.sidecar,
            projectionDigest:lexical.projectionDigest,accessDigest:lexical.accessDigest,canonicalFenceDigest:lexical.canonicalFenceDigest,dependencyFenceDigest:lexical.dependencyFenceDigest,
            tokenizer:lexical.tokenizer,representation:lexical.representation,lexical:{publicationId:lexical.publicationId,generation:lexical.generation,manifestDigest:lexical.manifestDigest,validationDigest:ld},
            identity:snapshot.identity,purgeEpoch:epoch,generation:{id:g.id,sequence:s.sequence,checkpoint:s.checkpoint,incarnation:s.incarnation},publicationId:randomUUID(),manifestDigest:hash.digest(),counts:s.counts};
          const text=signVectorRecord(store.cursorSecret,body),record=JSON.parse(text);
          db.prepare('UPDATE vector_generations SET state=?,published=1 WHERE id=?').run(seal(s),g.id);
          db.prepare('INSERT INTO vector_validation_records VALUES(?,?,?)').run(body.publicationId,owner,text);
          db.prepare('INSERT OR REPLACE INTO vector_publications VALUES(?,?,?)').run(g.projection,owner,canonicalJson(vectorPointer(record)));
          db.prepare('DELETE FROM vector_work WHERE projection=?').run(g.projection);return true;
        }
        db.prepare('UPDATE vector_generations SET state=? WHERE id=?').run(seal(s),g.id);return false;
      },true);
      if(done)return true;
    }
    return false;
  }
  function rank(observation,queryVector) {
    const rows=observation.rows.map(row=>({ref:row.ref,score:cosine(queryVector,row.vector)}));rankScores(rows);return rows;
  }
  return {observe,plan,put,certify,rank};
}

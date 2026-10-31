import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, projectionDigest } from './context-product-validation.mjs';
import { createContentReadMemo, memoryReadEligible, CONTENT_SAFETY_POLICY_REVISION } from './content-safety.mjs';
import { installedContentLayout, bindContentSafetyConnection } from './content-safety-schema.mjs';
import { contentSuppressionFenceInside, memorySuppressionObservationInside } from './content-suppression-storage.mjs';

const domain = 'context-read/b3-input-v2';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const scope = 'owner_id COLLATE BINARY=? AND scope COLLATE BINARY=? AND project_id COLLATE BINARY=?';
const hash = text => createHash('sha256').update(text).digest('base64url');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const stop = cause => { throw Object.assign(Error('comparison_incomplete'), { code:'read_budget_exceeded', cause }); };
export const MEMORY_COMPARISON_LIMITS = Object.freeze({ rows:131072, bytes:33554432, chunks:1024, frame:262144 });

// Count JSON expansion before allocating an encoded frame or string chunk.
function jsonBytes(value,account) {
  let nodes=8192;
  function size(v,depth=0){
    account.check();if(--nodes<0||depth>16)stop('frame');
    if(typeof v==='string'){
      let n=2;for(const c of v){const p=c.codePointAt(0);n+=p<32?([8,9,10,12,13].includes(p)?2:6):p===34||p===92?2:Buffer.byteLength(c);}return n;
    }
    if(v===null)return 4;if(typeof v==='boolean')return v?4:5;
    if(typeof v==='number'&&Number.isFinite(v))return String(v).length;
    if(!v||typeof v!=='object')stop('frame');
    const array=Array.isArray(v),keys=Object.keys(v);let n=2+Math.max(0,keys.length-1);
    for(const key of keys)n+=(array?0:size(key,depth+1)+1)+size(v[key],depth+1);return n;
  }
  return size(value);
}
function encode(value,account) {
  const bytes=jsonBytes(value,account);
  if(bytes>account.cap.frame)stop('frame');account.charge(0,bytes);
  return canonicalJson(value);
}
export { encode as comparisonJson };

// Observable native result/lookup units, never SQLite internal scan visits.
// Limits can only be tightened by internal qualification fixtures.
export function comparisonAccount({ now, cutoff, limits = {}, attribution }) {
  const cap = Object.fromEntries(Object.entries(MEMORY_COMPARISON_LIMITS).map(([k,v])=>[k,
    limits[k]===undefined?v:Number.isSafeInteger(limits[k])&&limits[k]>=0?Math.min(v,limits[k]):0]));
  let rows=0,bytes=0,source=null;
  const check=()=>{if(now()>=cutoff)stop('time');};
  const charge=(r,b)=>{check();if(r<0||b<0||!Number.isSafeInteger(b)||rows+r>cap.rows||bytes+b>cap.bytes ||
    source && (rows+r-source.rows>1024 || bytes+b-source.bytes>64000))stop('budget');rows+=r;bytes+=b;};
  return {cap,check,charge,get rows(){return rows;},get bytes(){return bytes;},remaining:()=>cap.bytes-bytes,
    preparing(work){check();attribution?.step();const result=work();check();return result;},
    native(work){check();attribution?.step();try{return work();}finally{attribution?.acquired();check();}},
    source(work){source={rows,bytes};try{return work();}finally{source=null;}}};
}

// Preflight every selected field before stepping the materializing statement.
// Safety owns its SQL and matching. This adapter only meters and validates its
// results, including schema/control attestation and memo-prepared statements.
export function comparisonReader(db, account) {
  const reader={get isTransaction(){return db.isTransaction;},prepare(source){
    account.check();
    const sql=source.replace(/^PRAGMA (\w+)\s*$/i, 'SELECT * FROM pragma_$1');
    if(!/^\s*SELECT\b/i.test(sql))stop('reader_contract');
    const prepare=sql=>account.preparing(()=>db.prepare(sql));
    const statement=prepare(sql),columns=account.preparing(()=>statement.columns()).map(c=>c.name);
    if(!columns.length || new Set(columns).size!==columns.length || columns.some(c=>c.startsWith('__b3_')))stop('reader_contract');
    const lengths=prepare(`SELECT ${columns.map((c,i)=>`typeof(q.${quote(c)}) AS t${i},length(CAST(q.${quote(c)} AS BLOB)) AS n${i}`).join(',')} FROM (${sql}) q`);
    const material=prepare(`SELECT q.*,${columns.map((c,i)=>`hex(CAST(q.${quote(c)} AS BLOB)) AS __b3_${i}`).join(',')} FROM (${sql}) q`);
    function* stream(statement,args){
      const iterator=statement.iterate(...args);
      try{while(true){
        account.charge(1,columns.length*24);
        const next=account.native(()=>iterator.next());if(next.done)return;yield next.value;
      }}
      finally{iterator.return?.();}
    }
    function* iterate(args, first=false) {
      account.check();let count=0,allowance=0;
      // Reserve the complete result's byte bound before any materialization.
      // Unordered helper queries need not choose the same row order under a
      // length projection; pairing their cursors would not be a sound bound.
      for(const size of stream(lengths,args)){
        count++;
        for(let i=0;i<columns.length;i++){
          if(!['text','integer','real','null'].includes(size['t'+i]))stop('encoding');
          allowance+=(size['n'+i]??0)*3+32;
        }
        if(allowance>account.remaining())stop('budget');
      }
      if(!count)return;
      account.charge(0,allowance);
      const actual=material.iterate(...args);let returned=0;
      try {
        while(true){
          account.charge(1,0);
          const row=account.native(()=>actual.next()).value;if(!row)break;
          if(++returned>count)stop('snapshot');
          for(let i=0;i<columns.length;i++){
            const value=row[columns[i]],hex=row['__b3_'+i];
            if(typeof value==='string' && (!value.isWellFormed() || Buffer.from(value).toString('hex').toUpperCase()!==hex))stop('encoding');
            delete row['__b3_'+i];
          }
          account.check();yield row;if(first)break;
        }
      } finally {actual.return?.();}
    }
    return {iterate:(...args)=>iterate(args),all:(...args)=>[...iterate(args)],get:(...args)=>{
      const rows=iterate(args,true);try{return rows.next().value;}finally{rows.return();}
    }};
  }};
  return bindContentSafetyConnection(reader,db);
}

function manifestWriter(account) {
  const chunks=[],payloads=[],locations=[],descriptors=[],root=createHash('sha256');
  let pending='',pendingText='',pendingLocations='',records=0,locationRecords=0,retainedBytes=0;
  const used=()=>chunks.length+payloads.length+locations.length+descriptors.length;
  const describe=(value,prepaid=false)=>{
    if(used()+1>account.cap.chunks)stop('chunks');
    if(!prepaid)account.charge(0,jsonBytes(value,account));descriptors.push(value);
  };
  const chunk=(kind,text,prepaid=false)=>{
    account.check();
    if(used()+2>account.cap.chunks)stop('chunks');
    const bytes=Buffer.byteLength(text),encoded=jsonBytes(text,account);
    if(encoded>account.cap.frame)stop('frame');if(!prepaid)account.charge(0,bytes+encoded);
    // Both serialized chunks and complete frames obey the existing serializer.
    if(Buffer.byteLength(canonicalJson(text))>account.cap.frame)stop('frame');
    const array=kind==='manifest'?chunks:kind==='text'?payloads:locations,index=array.length;
    describe({kind,index,bytes,digest:hash(text)},prepaid);array.push(text);retainedBytes+=bytes;return index;
  };
  const flush=()=>{if(pending){chunk('manifest',pending);pending='';}};
  const flushText=()=>{if(pendingText){chunk('text',pendingText,true);pendingText='';}};
  const flushLocations=()=>{if(pendingLocations){chunk('locations',pendingLocations);pendingLocations='';}};
  return {chunks,payloads,locations,descriptors,get bytes(){return retainedBytes;},
    record(value){
      account.check();const bytes=jsonBytes(value,account)+1;
      if(bytes>account.cap.frame)stop('frame');account.charge(0,bytes);
      const frame=canonicalJson(value)+'\n';
      if(Buffer.byteLength(pending)+Buffer.byteLength(frame)>65536)flush();
      root.update(frame);pending+=frame;records++;
    },
    text(text){
      // Reserve encoded strings, bounded descriptor overhead and positions
      // before constructing even the first chunk from an already-read body.
      const maximum=Math.max(1,Math.ceil((pendingText.length+text.length)/16383));
      if(used()+2*maximum+(pending?2:0)+(pendingLocations?2:0)>account.cap.chunks)stop('chunks');
      account.charge(0,Buffer.byteLength(text)+jsonBytes(text,account)+2*maximum+264*maximum+256);
      const spans=[];let offset=0;
      // Offsets are UTF-16 code units in well-formed plain string chunks.
      // Packing is independent of item boundaries; no surrogate is split.
      while(offset<text.length){
        if(pendingText.length===16384)flushText();
        let end=Math.min(text.length,offset+16384-pendingText.length);
        const last=text.charCodeAt(end-1);
        if(end<text.length&&last>=0xd800&&last<=0xdbff)end--;
        if(end===offset){flushText();continue;}
        const start=pendingText.length;pendingText+=text.slice(offset,end);
        spans.push({chunk:payloads.length,start,end:pendingText.length});offset=end;
      }
      return spans;
    },
    locate(value){
      const bytes=jsonBytes(value,account)+1;if(bytes>account.cap.frame)stop('frame');account.charge(0,bytes);
      const frame=canonicalJson(value)+'\n';
      if(Buffer.byteLength(pendingLocations)+Buffer.byteLength(frame)>65536)flushLocations();
      pendingLocations+=frame;locationRecords++;
    },
    finish(){flushText();flushLocations();flush();return {root:root.digest('base64url'),records,locationRecords};}
  };
}

function fenceRows(reader,writer,ns,layout,account,pageSize) {
  const epoch=reader.prepare(`SELECT epoch FROM namespace_epochs WHERE ${scope}`).get(...boundary(ns));
  writer.record({fence:'namespace',namespace:boundary(ns),epoch:epoch?.epoch??null});
  if(!layout.raw)return;
  // Every TEXT cursor component and ordering component specifies BINARY. No
  // column or PK collation is trusted. The reader rejects lossy text bindings.
  const tables=[['raw_conversations','id,revision',['id'],scope,boundary(ns)]];
  if(layout.rawCapture)tables.push(['raw_session_fences','client,session_key',['client','session_key'],scope,boundary(ns)]);
  if(layout.rawLineage){
    tables.push(['raw_exclusion_clocks','generation',[],scope,boundary(ns)]);
    tables.push(['raw_source_exclusions e JOIN raw_conversations c ON c.id COLLATE BINARY=e.conversation_id COLLATE BINARY',
      'e.conversation_id,e.message_id,e.start,e.end,e.generation',['conversation_id','message_id','start','end'],
      scope.replaceAll(/\b(owner_id|scope|project_id)\b/g,'c.$1'),boundary(ns)]);
  }
  for(const [table,fields,keys,where,args]of tables){
    let last=null,count=0;const digest=createHash('sha256');
    const columns=fields.split(',').map(s=>s.split('.').at(-1));
    const names=keys.map(k=>quote(k)+(k==='start'||k==='end'?'':' COLLATE BINARY'));
    while(true){
      account.check();
      const inner=`SELECT ${fields} FROM ${table} WHERE ${where}`;
      const cursor=last?`WHERE (${names.join(',')}) > (${names.map(()=>'?').join(',')})`:'';
      const rows=reader.prepare(`SELECT * FROM (${inner}) ${cursor} ${names.length?'ORDER BY '+names.join(','):''} LIMIT ${pageSize}`)
        .all(...args,...(last??[]));
      for(const row of rows){const frame=encode(columns.map(c=>row[c]),account);digest.update(frame+'\n');count++;}
      if(rows.length<pageSize || !keys.length)break;
      last=keys.map(k=>rows.at(-1)[k]);
    }
    writer.record({fence:table.split(' ')[0],namespace:boundary(ns),count,digest:digest.digest('base64url')});
  }
}

// Issuer-authenticated volatile bases only. A caller cannot turn a partial scan,
// parsed transport, modified root or restarted Worker into an equality basis.
// B4 must add its separately reviewed authenticated storage/activation adapter.
export function createMemoryComparator() {
  const issued=new WeakMap();
  return function capture({ db,read,selection,identity,access,now,cutoff,budget,loadBase=()=>null,
    sample=()=>String(process.hrtime.bigint()),limits,checkpoint=null,pageSize=128,
    observeMemory=memorySuppressionObservationInside,physicalIdentity,attribution }) {
    const account=comparisonAccount({now,cutoff,limits,attribution});
    let output,bindingText,issuedRoot,retainedBytes;
    try {
      account.check();
      account.charge(0,jsonBytes({readSet:selection.readSet,types:selection.types,intent:selection.intent},account));
      // Base materialization and authentication precede canonical acquisition.
      const loaded=loadBase(account),base=issued.get(loaded?.base??loaded);
      checkpoint=loaded?.checkpoint??checkpoint;
      if(base)account.charge(0,base.bytes);
      if(selection.types.length!==1 || selection.types[0]!=='memory')return {status:'incomplete',cause:'card_preparation',
        selection:{types:['memory','card'].filter(t=>selection.types.includes(t)),intent:selection.intent,
          ...(selection.types.includes('card')?{contentSafetyPolicy:CONTENT_SAFETY_POLICY_REVISION}:{})},rows:account.rows,bytes:account.bytes};
      const binding={domain,storeId:identity.storeId,canonical:identity.canonical??null,
        projection:projectionDigest(selection),access,resources:'b3-capture-v1'};
      if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>128)stop('budget');
      account.charge(0,jsonBytes(binding,account));
      const sampled=sample(); // Immediately before entering the attributed read seam.
      output=read(()=>{
        const reader=comparisonReader(db,account),memo=createContentReadMemo(reader);
        if(reader.prepare('PRAGMA encoding').get().encoding!=='UTF-8')stop('encoding');
        if(physicalIdentity)binding.canonical=physicalIdentity(reader);
        bindingText=encode(binding,account);
        const layout=installedContentLayout(reader),writer=manifestWriter(account);
        const store=reader.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
        if(store?.store_id!==identity.storeId)stop('identity');
        const control=layout.suppressionRevision?reader.prepare('SELECT suppression_domain FROM content_safety_control WHERE singleton=1').get():null;
        if(layout.suppressionRevision && !control?.suppression_domain)stop('layout');
        writer.record({binding,capability:layout.suppressionRevision?'suppression':'none',suppressionDomain:control?.suppression_domain??null});
        const owners=[...new Set(selection.readSet.map(ns=>ns.ownerId))];
        for(const owner of owners){
          const epoch=contentSuppressionFenceInside(reader,owner);
          if(layout.suppressionRevision?typeof epoch!=='string'||!/^\d+:\d+$/.test(epoch):epoch!==null)stop('observation_contract');
          writer.record({fence:'suppression',owner,storeId:store.store_id,suppressionDomain:control?.suppression_domain??null,epoch});
        }
        let count=0;
        for(const ns of selection.readSet){
          fenceRows(reader,writer,ns,layout,account,pageSize);
          let after=null;
          while(true){
            const rows=reader.prepare(`SELECT id,revision,deleted,currentness,review_state FROM memories WHERE ${scope}
              ${after===null?'':'AND id COLLATE BINARY>?'} ORDER BY id COLLATE BINARY LIMIT 128`)
              .all(...boundary(ns),...(after===null?[]:[after]));
            for(const row of rows){
              const observe=()=>observeMemory(db,ns,{memoryId:row.id,revision:row.revision},{memo,reader});
              const suppression=layout.raw?account.source(observe):observe();
              if(suppression.complete!==true)stop(['budget','unavailable'].includes(suppression.cause)?suppression.cause:'observation_contract');
              const legacy=suppression.capability==='none';
              if(typeof suppression.suppressed!=='boolean'||legacy!==!layout.suppressionRevision ||
                legacy&&suppression.suppressed || !legacy&&!/^[A-Za-z0-9_-]{43}$/.test(suppression.matchedSetDigest??''))stop('observation_contract');
              const eligible=memoryReadEligible(row,selection.intent)&&!suppression.suppressed;
              // Metadata includes every state. Only eligible Memory content is
              // an indexed document; no receipt observation or source text.
              let content=null,textChunks=[],contentBytes=0;
              if(eligible){
                const body=reader.prepare(`SELECT content FROM memories WHERE ${scope} AND id COLLATE BINARY=? AND revision=?`)
                  .get(...boundary(ns),row.id,row.revision);
                if(!body || typeof body.content!=='string')stop('content');
                content=hash(body.content);contentBytes=Buffer.byteLength(body.content);textChunks=writer.text(body.content);
              }
              writer.record({item:'memory',namespace:boundary(ns),...row,eligible,content,
                suppression:legacy?{suppressed:false,capability:'none'}:{suppressed:suppression.suppressed,matchedSetDigest:suppression.matchedSetDigest}});
              // Location records are supporting chunks, outside the equality
              // stream. The envelope binds their hashes without a per-item map.
              if(eligible)writer.locate({item:count,bytes:contentBytes,spans:textChunks});
              count++;
            }
            if(rows.length<128)break;
            after=rows.at(-1).id;
          }
        }
        writer.record({terminal:true,count});
        const manifest=writer.finish();
        issuedRoot=manifest.root;
        // Count every descriptor as well as every chunk. No limit is raised.
        if(writer.chunks.length+writer.payloads.length+writer.locations.length+writer.descriptors.length>account.cap.chunks)stop('chunks');
        const envelope={domain,comparisonId:randomUUID(),binding,checkpoint,sample:sampled,usage:{rows:account.rows,bytes:account.bytes},
          ...manifest,count,descriptors:writer.descriptors};
        // Bind the final charged usage, including the envelope's own encoding.
        // Only its byte-count digit width can change during this fixed point.
        let envelopeBytes,previous=-1;
        for(let i=0;i<16;i++){
          const bytes=jsonBytes(envelope,account);envelope.usage.bytes=account.bytes+bytes;
          if(bytes===previous){envelopeBytes=bytes;break;}previous=bytes;
        }
        if(envelopeBytes===undefined||envelopeBytes>account.cap.frame)stop('frame');account.charge(0,envelopeBytes);
        const encoded=canonicalJson(envelope);
        retainedBytes=envelopeBytes+writer.bytes;
        account.check();
        return {status:base && base.binding===bindingText && base.root===manifest.root?'complete/equal':'complete/different',
          envelope:encoded,manifest:writer.chunks,payloads:writer.payloads,locations:writer.locations,rows:account.rows,bytes:account.bytes};
      });
      account.check();
      Object.freeze(output.manifest);Object.freeze(output.payloads);Object.freeze(output.locations);Object.freeze(output);
      account.check();issued.set(output,{binding:bindingText,root:issuedRoot,bytes:retainedBytes});
      return output;
    } catch(error) {
      // There is no resumable cursor, root, payload or clock sample on failure.
      return {status:'incomplete',cause:error.code==='read_budget_exceeded'?error.cause:'unavailable',rows:account.rows,bytes:account.bytes};
    }
  };
}

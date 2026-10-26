import { randomUUID } from 'node:crypto';
import { transaction, readTransaction } from './database.mjs';
import { createBinaryIdentity, binaryNamespace } from './asset-identity.mjs';
import { ASSET_LIMITS, assetRef, assetVersionRef, assetPageLimit, assetLabel, validateAssetMedia } from './asset-input.mjs';
import { validateBinaryObject } from './asset-schema.mjs';
import { createOperationLedger, createPrivateEffectWriter, privateBoundary as boundary, privateWhere as where, envelopeBytes } from './private-operation-helpers.mjs';
import { fail } from './validation.mjs';
import { createAssetDerivativeStorage } from './asset-derivative-storage.mjs';

const now=()=>new Date().toISOString();
export function createAssetStorage({db,identity,ready}) {
  const mac=createBinaryIdentity(identity),ledger=createOperationLedger(db,'asset_operations'),effect=createPrivateEffectWriter(db,'asset_effects');
  const ref=(ns,id)=>({type:'asset',namespace:ns,assetId:id});
  const versionRef=(ns,row)=>({type:'asset-version',namespace:ns,assetId:row.asset_id,versionId:row.id,contentIdentity:row.content_identity});
  const assetRow=(ns,id)=>db.prepare(`SELECT * FROM assets WHERE ${where} AND id=?`).get(...boundary(ns),id);
  const epoch=ns=>db.prepare(`SELECT generation FROM asset_epochs WHERE ${where}`).get(...boundary(ns))?.generation??1;
  function prepare(method,ns,input) {
    const payloadBinding=mac('binary-action-v1',[method,input]);
    const prepared={payloadBinding};
    if (method==='importAssetVersion') {
      validateAssetMedia(input.filename,input.mediaType,input.bytes);
      prepared.contentIdentity=mac('binary-content-v1',[binaryNamespace(ns),input.mediaType,input.bytes]);
      prepared.versionId=randomUUID();prepared.objectId=randomUUID();prepared.assetId=input.asset?.assetId??randomUUID();
      prepared.title=assetLabel(input.title,200);prepared.filename=assetLabel(input.filename,512);
      prepared.chunks=[];
      for(let start=0,index=0;start<input.bytes.length;start+=32768,index++) {
        const bytes=input.bytes.subarray(start,Math.min(start+32768,input.bytes.length));
        const chunkMac=mac('binary-chunk-v1',[binaryNamespace(ns),prepared.objectId,prepared.contentIdentity,input.mediaType,input.bytes.length,index,bytes.length,bytes]);
        prepared.chunks.push({index,bytes,mac:chunkMac});
      }
    }
    return prepared;
  }
  function target(ns,inputRef) {
    const requested=assetVersionRef(inputRef),asset=assetRow(ns,requested.assetId);
    const row=asset&&db.prepare('SELECT * FROM asset_versions WHERE asset_id=? AND id=?').get(asset.id,requested.versionId);
    if(!row)fail('asset_not_found');
    if(row.content_identity!==requested.contentIdentity)fail('asset_version_unavailable');
    if(asset.state!=='available'||row.state!=='available')return {asset,row,available:false};
    const object=db.prepare('SELECT * FROM binary_objects WHERE id=?').get(row.object_id);
    if(!object || object.asset_version_id!==row.id || object.method_version_id!==null || object.owner_id!==ns.ownerId ||
      object.scope!==ns.scope || object.project_id!==(ns.projectId??'') || object.content_identity!==row.content_identity ||
      object.media_type!==row.media_type || object.byte_count!==row.byte_count || !Number.isSafeInteger(row.byte_count) ||
      row.byte_count<1 || row.byte_count>ASSET_LIMITS.versionBytes)fail('asset_version_unavailable');
    return {asset,row,object,available:true};
  }
  function metadata(ns,row) {
    return {ref:versionRef(ns,row),ordinal:row.ordinal,state:row.state,revision:row.revision,importedAt:row.imported_at,
      ...(row.state==='available'?{title:row.title,filename:row.filename,mediaType:row.media_type,byteCount:row.byte_count,signature:'signature-matched'}:{byteCount:0})};
  }
  function encode(value) {
    const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+mac('asset-cursor-v1',[body]);
  }
  function decode(cursor,expected) {
    if(cursor===undefined)return null;
    const [body,signature,extra]=cursor.split('.');
    if(extra!==undefined || !body || signature!==mac('asset-cursor-v1',[body]))fail('invalid_cursor');
    let saved;try{saved=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{fail('invalid_cursor');}
    if(JSON.stringify(saved.binding)!==JSON.stringify(expected) || !Number.isSafeInteger(saved.after) || saved.after<0 ||
      !Number.isSafeInteger(saved.epoch)||saved.epoch<1 ||
      ['readAssetBytes','readAssetDerivative'].includes(expected.method) && (![saved.assetRevision,saved.versionRevision,
        ...(expected.method==='readAssetDerivative'?[saved.derivativeRevision]:[])].every(value=>Number.isSafeInteger(value)&&value>0)))fail('invalid_cursor');
    return saved;
  }
  function page(ns,input,expected,saved,entries,key) {
    if(saved&&saved.epoch!==epoch(ns))fail('cursor_stale');
    const start=saved?.after??0;
    if(start>entries.length)fail('invalid_cursor');
    let end=Math.min(start+assetPageLimit(input.limit),entries.length);
    while(true) {
      const complete=end===entries.length;
      const result={[key]:entries.slice(start,end),coverage:{status:complete?'complete':'budget_exhausted',included:end-start,omitted:complete?0:null},
        nextCursor:complete?null:encode({binding:expected,epoch:epoch(ns),after:end})};
      if(envelopeBytes(result)<=65536)return result;
      if(--end<=start)fail('context_item_too_large');
    }
  }
  function importVersion(ns,input,prepared) {
    let asset=input.asset===undefined?null:assetRow(ns,assetRef(input.asset).assetId);
    if(input.asset!==undefined) {
      if(!asset)fail('asset_not_found');
      if(asset.revision!==input.expectedAssetRevision)fail('revision_conflict');
      if(asset.state!=='available')fail('asset_version_unavailable');
      if(asset.next_ordinal>ASSET_LIMITS.versions)fail('asset_limit_reached');
    } else {
      if(db.prepare(`SELECT count(*) AS n FROM assets WHERE ${where}`).get(...boundary(ns)).n>=ASSET_LIMITS.assets)fail('asset_limit_reached');
    }
    db.prepare('INSERT OR IGNORE INTO binary_owner_usage VALUES(?,0)').run(ns.ownerId);
    const bytes=input.bytes.length;
    if(db.prepare('UPDATE binary_owner_usage SET byte_count=byte_count+? WHERE owner_id=? AND byte_count+?<=?')
      .run(bytes,ns.ownerId,bytes,ASSET_LIMITS.ownerBytes).changes!==1)fail('quota_reached');
    const timestamp=now(),first=!asset;
    if(first) {
      db.prepare("INSERT INTO assets VALUES(?,?,?,?,'available',1,1,?,?)").run(prepared.assetId,...boundary(ns),timestamp,timestamp);
      asset=assetRow(ns,prepared.assetId);
    }
    db.prepare("INSERT INTO asset_versions VALUES(?,?,?,?,'available',1,?,?,?,?,?,?)")
      .run(prepared.versionId,asset.id,asset.next_ordinal,prepared.contentIdentity,prepared.title,prepared.filename,input.mediaType,bytes,prepared.objectId,timestamp);
    db.prepare('INSERT INTO binary_objects VALUES(?,?,?,?,?,?,?,?,NULL,NULL)')
      .run(prepared.objectId,...boundary(ns),input.mediaType,prepared.contentIdentity,bytes,prepared.versionId);
    const insert=db.prepare('INSERT INTO binary_chunks VALUES(?,?,?,?)');
    for(const chunk of prepared.chunks)insert.run(prepared.objectId,chunk.index,chunk.mac,chunk.bytes);
    validateBinaryObject(db,prepared.objectId);
    const assetRevision=first?1:asset.revision+1;
    db.prepare('UPDATE assets SET revision=?,next_ordinal=next_ordinal+1,updated_at=? WHERE id=?').run(assetRevision,timestamp,asset.id);
    const version={type:'asset-version',namespace:ns,assetId:asset.id,versionId:prepared.versionId,contentIdentity:prepared.contentIdentity};
    effect(ns,'asset_version_imported','asset-version',prepared.versionId,1,input.actionId);
    return {asset:ref(ns,asset.id),version,ordinal:asset.next_ordinal,assetRevision};
  }
  function remove(method,ns,input) {
    if(method==='deleteAsset') {
      const asset=assetRow(ns,assetRef(input.ref).assetId);
      if(!asset)fail('asset_not_found');
      if(asset.revision!==input.expectedRevision)fail('revision_conflict');
      if(asset.state!=='available')fail('asset_version_unavailable');
      db.prepare("UPDATE assets SET state='deleted',revision=revision+1,updated_at=? WHERE id=?").run(now(),asset.id);
      effect(ns,'asset_deleted','asset',asset.id,asset.revision+1,input.actionId);
      return {id:asset.id,revision:asset.revision+1,state:'deleted',effectCount:1};
    }
    // Deletion checks only canonical identity/lifecycle/CAS, never reads bytes.
    const requested=assetVersionRef(input.ref),asset=assetRow(ns,requested.assetId);
    const row=asset&&db.prepare('SELECT * FROM asset_versions WHERE asset_id=? AND id=?').get(asset.id,requested.versionId);
    if(!row)fail('asset_not_found');
    if(row.content_identity!==requested.contentIdentity)fail('asset_version_unavailable');
    if(row.revision!==input.expectedRevision)fail('revision_conflict');
    if(asset.state!=='available'||row.state!=='available')fail('asset_version_unavailable');
    db.prepare("UPDATE asset_versions SET state='deleted',revision=2,title=NULL,filename=NULL,media_type=NULL,byte_count=0,object_id=NULL WHERE id=?").run(row.id);
    db.prepare('UPDATE assets SET revision=revision+1,updated_at=? WHERE id=?').run(now(),asset.id);
    effect(ns,'asset_version_deleted','asset-version',row.id,2,input.actionId);
    return {id:row.id,revision:2,state:'deleted',effectCount:1};
  }
  function read(method,ns,input,prepared,accessGeneration) {
    const stream=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='cursor'&&key!=='bytes'));
    const expected={store:identity.storeId,method,namespace:ns,input:stream,accessGeneration},saved=decode(input.cursor,expected);
    if(['listAssetDerivatives','readAssetDerivative'].includes(method))return derivatives.read(method,ns,input,expected,saved);
    if(method==='getAssetUsage')return {version:'binary-usage-v1',namespace:ns,
      retainedBinaryBytes:db.prepare(`SELECT coalesce(sum(byte_count),0) AS n FROM binary_objects WHERE ${where}`).get(...boundary(ns)).n,
      retainedDerivativeBytes:db.prepare(`SELECT coalesce(sum(d.byte_count),0) AS n FROM asset_derivatives d JOIN asset_versions v ON v.id=d.version_id JOIN assets a ON a.id=v.asset_id
       WHERE a.owner_id=? AND a.scope=? AND a.project_id=?`).get(...boundary(ns)).n,limitBytes:ASSET_LIMITS.ownerBytes,limitScope:'owner',aggregate:'not-requested'};
    if(method==='listAssetEffects') {
      const entries=db.prepare(`SELECT * FROM asset_effects WHERE ${where} ORDER BY ordinal`).all(...boundary(ns)).map(row=>({effectId:row.effect_id,namespace:ns,
        kind:row.kind,entity:{type:row.entity_type,id:row.entity_id},revision:row.revision,actionId:row.action_id,ordinal:row.ordinal}));
      return page(ns,input,expected,saved,entries,'effects');
    }
    if(method==='listAssets') {
      const entries=db.prepare(`SELECT * FROM assets WHERE ${where} ORDER BY id`).all(...boundary(ns)).map(row=>({ref:ref(ns,row.id),state:row.state,
        revision:row.revision,versionCount:row.next_ordinal-1,createdAt:row.created_at,updatedAt:row.updated_at}));
      return page(ns,input,expected,saved,entries,'assets');
    }
    if(method==='listAssetVersions') {
      const asset=assetRow(ns,assetRef(input.asset).assetId);
      if(!asset)fail('asset_not_found');
      const entries=db.prepare('SELECT * FROM asset_versions WHERE asset_id=? ORDER BY ordinal').all(asset.id).map(row=>metadata(ns,row));
      return page(ns,input,expected,saved,entries,'versions');
    }
    // Cursor authentication and exact scope/ref binding precede target lookup;
    // a deleted target takes precedence over any saved epoch/revision staleness.
    const found=target(ns,input.version);
    if(!found.available) {
      if(method==='verifyAssetBytes')fail('asset_version_unavailable');
      return method==='getAssetVersion'?{version:null,status:'unavailable'}:{status:'unavailable'};
    }
    const {asset,row,object}=found;
    if(method==='getAssetVersion')return {version:metadata(ns,row)};
    if(method==='verifyAssetBytes')return {matches:prepared.candidates[row.media_type]===row.content_identity,candidateLength:input.bytes.length,canonicalContentIdentity:row.content_identity};
    if(saved&&(saved.epoch!==epoch(ns)||saved.assetRevision!==asset.revision||saved.versionRevision!==row.revision))fail('cursor_stale');
    const index=saved?.after??0,count=Math.ceil(object.byte_count/32768);
    if(index>=count)fail('invalid_cursor');
    const chunk=db.prepare('SELECT chunk_mac,bytes FROM binary_chunks WHERE object_id=? AND chunk_index=?').get(object.id,index);
    const expectedLength=Math.min(32768,object.byte_count-index*32768);
    if(!chunk||chunk.bytes.length!==expectedLength || chunk.chunk_mac!==mac('binary-chunk-v1',
      [binaryNamespace(ns),object.id,row.content_identity,row.media_type,object.byte_count,index,expectedLength,chunk.bytes]))fail('asset_version_unavailable');
    const complete=index+1===count;
    return {version:versionRef(ns,row),status:'available',index,encoding:'base64',bytes:Buffer.from(chunk.bytes).toString('base64'),
      byteCount:expectedLength,totalByteCount:object.byte_count,complete,nextCursor:complete?null:encode({binding:expected,epoch:epoch(ns),after:index+1,
        assetRevision:asset.revision,versionRevision:row.revision})};
  }
  const derivatives=createAssetDerivativeStorage({db,mac,target,assetRow,effect,epoch,encode,page});
  return {prepare(method,ns,input) {
    const prepared=prepare(method,ns,input);
    if(method==='createAssetDerivative')prepared.derivative=derivatives.prepare(ns,input);
    if(method==='verifyAssetBytes') {
      // Media is mutable storage, so prepare every allowlisted candidate outside
      // the read transaction; expose only the canonical target on comparison.
      prepared.candidates=Object.fromEntries(['image/png','image/jpeg','image/gif','image/webp','audio/wav','application/pdf','audio/mpeg','video/mp4','font/ttf','font/otf','font/woff','font/woff2']
        .map(media=>[media,mac('binary-content-v1',[binaryNamespace(ns),media,input.bytes])]));
    }
    return prepared;
  },call(method,ns,input,prepared,readOnly,accessGeneration) {
    ready();
    if(readOnly)return readTransaction(db,()=>read(method,ns,input,prepared,accessGeneration));
    return transaction(db,()=>{
      const replay=ledger.replay(ns,input.actionId,method,prepared.payloadBinding);
      if(replay!==undefined)return replay;
      const result=method==='importAssetVersion'?importVersion(ns,input,prepared):method==='createAssetDerivative'?derivatives.create(ns,input,prepared.derivative):
        method==='deleteAssetDerivative'?derivatives.remove(ns,input):remove(method,ns,input);
      ledger.record(ns,input.actionId,method,prepared.payloadBinding,result.asset?.assetId??result.derivative?.derivativeId??result.id,result,now());
      return result;
    });
  }};
}

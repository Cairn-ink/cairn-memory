import { randomUUID } from 'node:crypto';
import { assetDerivativeRef,assetVersionRef,derivativeInput,ASSET_LIMITS } from './asset-input.mjs';
import { privateBoundary as boundary } from './private-operation-helpers.mjs';
import { fail } from './validation.mjs';

// All functions run inside the caller's transaction. Preparation alone runs
// before callbacks/locks, and does not consult mutable storage.
export function createAssetDerivativeStorage({db,mac,target,assetRow,effect,epoch,encode,page}) {
  const ref=(ns,row)=>({type:'asset-derivative',namespace:ns,assetId:row.asset_id,versionId:row.version_id,derivativeId:row.id});
  const provenance=(source,hasIntervals)=>({version:'asset-derivative-provenance-v1',source,method:{kind:'user-provided'},
    ...(hasIntervals?{alignment:'user-supplied-unverified'}:{})});
  function prepare(ns,input) {
    const id=randomUUID(),source=assetVersionRef(input.version),text=derivativeInput(input),origin=provenance(source,input.timecodes!==undefined);
    return {id,source,text,provenance:origin,contentIdentity:mac('asset-derivative-v1',
      [source,id,input.kind,text,origin,input.language??null,input.timecodes??null]),byteCount:Buffer.byteLength(text)};
  }
  function create(ns,input,prepared) {
    const found=target(ns,input.version);
    if(found.row.revision!==input.expectedVersionRevision)fail('revision_conflict');
    if(!found.available)fail('asset_version_unavailable');
    if(input.timecodes!==undefined&&!/^(audio|video)\//.test(found.row.media_type))fail('invalid_input');
    if(db.prepare('SELECT count(*) n FROM asset_derivatives WHERE version_id=?').get(found.row.id).n>=32)fail('asset_limit_reached');
    db.prepare('INSERT OR IGNORE INTO binary_owner_usage VALUES(?,0)').run(ns.ownerId);
    if(db.prepare('UPDATE binary_owner_usage SET byte_count=byte_count+? WHERE owner_id=? AND byte_count+?<=?')
      .run(prepared.byteCount,ns.ownerId,prepared.byteCount,ASSET_LIMITS.ownerBytes).changes!==1)fail('quota_reached');
    db.prepare("INSERT INTO asset_derivatives VALUES(?,?,?,'available',1,?,?,?,?,?,?,?,?)").run(prepared.id,found.row.id,
      found.row.content_identity,input.kind,prepared.text,prepared.contentIdentity,JSON.stringify(prepared.provenance),input.language??null,
      input.timecodes===undefined?null:JSON.stringify(input.timecodes),prepared.byteCount,new Date().toISOString());
    db.prepare(`INSERT INTO asset_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1`).run(...boundary(ns));
    effect(ns,'asset_derivative_created','asset-derivative',prepared.id,1,input.actionId);
    return {derivative:ref(ns,{id:prepared.id,asset_id:found.asset.id,version_id:found.row.id}),source:prepared.source,revision:1};
  }
  function find(ns,inputRef) {
    const requested=assetDerivativeRef(inputRef),asset=assetRow(ns,requested.assetId);
    const source=asset&&db.prepare('SELECT * FROM asset_versions WHERE asset_id=? AND id=?').get(asset.id,requested.versionId);
    const row=source&&db.prepare('SELECT * FROM asset_derivatives WHERE version_id=? AND id=?').get(source.id,requested.derivativeId);
    if(!row)fail('asset_not_found');
    return {asset,source,row,available:asset.state==='available'&&source.state==='available'&&row.state==='available'};
  }
  function remove(ns,input) {
    const found=find(ns,input.ref),{row}=found;
    if(row.revision!==input.expectedRevision)fail('revision_conflict');
    if(!found.available)fail('asset_version_unavailable');
    // The canonical transition trigger is the sole derivative release writer.
    db.prepare("UPDATE asset_derivatives SET state='deleted',revision=2,kind=NULL,text=NULL,provenance=NULL,language=NULL,timecodes=NULL,byte_count=0 WHERE id=?").run(row.id);
    effect(ns,'asset_derivative_deleted','asset-derivative',row.id,2,input.actionId);
    return {id:row.id,revision:2,state:'deleted',effectCount:1};
  }
  function metadata(ns,source,row) {
    const sourceRef={type:'asset-version',namespace:ns,assetId:source.asset_id,versionId:source.id,contentIdentity:source.content_identity};
    const greatest=db.prepare('SELECT next_ordinal-1 n FROM assets WHERE id=?').get(source.asset_id).n;
    const value={ref:ref(ns,{...row,asset_id:source.asset_id}),source:sourceRef,state:row.state,revision:row.revision,
      contentIdentity:row.content_identity,createdAt:row.created_at,sourceOrdinal:source.ordinal,greatestImportedOrdinal:greatest,historical:source.ordinal<greatest};
    if(row.state==='deleted')return {...value,byteCount:0};
    let origin,intervals;
    try{origin=JSON.parse(row.provenance);intervals=row.timecodes===null?null:JSON.parse(row.timecodes);}catch{fail('asset_version_unavailable');}
    if(row.source_identity!==source.content_identity||typeof row.text!=='string'||!row.text.isWellFormed()||row.text.includes('\0')||row.text.length>20000||
      row.byte_count!==Buffer.byteLength(row.text)||JSON.stringify(origin)!==JSON.stringify(provenance(sourceRef,intervals!==null))||
      row.content_identity!==mac('asset-derivative-v1',[sourceRef,row.id,row.kind,row.text,origin,row.language,intervals]))fail('asset_version_unavailable');
    return {...value,kind:row.kind,byteCount:row.byte_count,provenance:origin,...(row.language===null?{}:{language:row.language}),
      ...(intervals===null?{}:{timecodes:intervals,alignment:'user-supplied-unverified'})};
  }
  function read(method,ns,input,expected,saved) {
    if(method==='listAssetDerivatives') {
      const found=target(ns,input.version);
      if(!found.available)return {status:'unavailable'};
      const rows=db.prepare('SELECT * FROM asset_derivatives WHERE version_id=? ORDER BY id').all(found.row.id);
      return page(ns,input,expected,saved,rows.map(row=>metadata(ns,found.row,row)),'derivatives');
    }
    const found=find(ns,input.ref);
    if(!found.available)return {status:'unavailable'};
    const {asset,source,row}=found,value=metadata(ns,source,row);
    if(saved&&(saved.epoch!==epoch(ns)||saved.assetRevision!==asset.revision||saved.versionRevision!==source.revision||saved.derivativeRevision!==row.revision))fail('cursor_stale');
    const start=saved?.after??0;
    if(start>row.text.length||start>0&&/[\uDC00-\uDFFF]/.test(row.text[start]))fail('invalid_cursor');
    let end=Math.min(start+4000,row.text.length);
    if(end<row.text.length&&/[\uDC00-\uDFFF]/.test(row.text[end]))end--;
    const complete=end===row.text.length;
    return {status:'available',derivative:value,parts:end===start?[]:[{start,end,text:row.text.slice(start,end)}],complete,
      nextCursor:complete?null:encode({binding:expected,epoch:epoch(ns),after:end,assetRevision:asset.revision,versionRevision:source.revision,derivativeRevision:row.revision})};
  }
  return {prepare,create,remove,read};
}

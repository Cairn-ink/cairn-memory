import { randomUUID } from 'node:crypto';
import { createBinaryIdentity,binaryNamespace } from './asset-identity.mjs';
import { ASSET_LIMITS } from './asset-input.mjs';
import { mixedMethodFiles } from './method-attachment-input.mjs';
import { validateMixedManifest } from './asset-schema.mjs';
import { privateBoundary as boundary } from './private-operation-helpers.mjs';
import { fail } from './validation.mjs';

export function createMethodAttachmentStorage({db,identity,contentIdentity,enabled}) {
  const mac=createBinaryIdentity(identity);
  const query = (sql, check) => { check?.(); return db.prepare(sql); };
  const mixed=(id,check)=>enabled&&Boolean(query('SELECT 1 FROM method_manifest_formats WHERE version_id=?',check).get(id));
  const manifestIdentity=(ns,entries)=>mac('method-mixed-manifest-v1',[binaryNamespace(ns),entries.map(entry=>
    [entry.kind,entry.path,entry.mediaType,entry.byteCount,entry.contentIdentity])]);
  function prepare(ns,input) {
    const payloadBinding=mac('binary-action-v1',['importMethodVersion',input]),versionId=randomUUID();
    const entries=mixedMethodFiles(input.files).map((entry,position)=>{
      const byteCount=entry.kind==='text'?Buffer.byteLength(entry.text):entry.bytes.length;
      const content=entry.kind==='text'?contentIdentity(ns,entry.text):mac('binary-content-v1',[binaryNamespace(ns),entry.mediaType,entry.bytes]);
      const result={...entry,position,byteCount,contentIdentity:content};
      if(entry.kind==='binary') {
        result.objectId=randomUUID();result.chunks=[];
        for(let start=0,index=0;start<entry.bytes.length;start+=32768,index++) {
          const bytes=entry.bytes.subarray(start,Math.min(start+32768,entry.bytes.length));
          result.chunks.push({index,bytes,mac:mac('binary-chunk-v1',
            [binaryNamespace(ns),result.objectId,content,entry.mediaType,byteCount,index,bytes.length,bytes])});
        }
      }
      return result;
    });
    return {payloadBinding,versionId,entries,manifestIdentity:manifestIdentity(ns,entries)};
  }
  function reserve(ns,prepared) {
    const bytes=prepared.entries.filter(entry=>entry.kind==='binary').reduce((sum,entry)=>sum+entry.byteCount,0);
    db.prepare('INSERT OR IGNORE INTO binary_owner_usage VALUES(?,0)').run(ns.ownerId);
    if(db.prepare('UPDATE binary_owner_usage SET byte_count=byte_count+? WHERE owner_id=? AND byte_count+?<=?')
      .run(bytes,ns.ownerId,bytes,ASSET_LIMITS.ownerBytes).changes!==1)fail('quota_reached');
  }
  function insert(ns,prepared) {
    db.prepare("INSERT INTO method_manifest_formats VALUES(?,'mixed-v1')").run(prepared.versionId);
    const entry=db.prepare('INSERT INTO method_mixed_entries VALUES(?,?,?,?,?,?,?,?,?)'),object=db.prepare('INSERT INTO binary_objects VALUES(?,?,?,?,?,?,?,NULL,?,?)'),chunk=db.prepare('INSERT INTO binary_chunks VALUES(?,?,?,?)');
    for(const file of prepared.entries) {
      entry.run(prepared.versionId,file.position,file.kind,file.path,file.path.toLowerCase(),file.mediaType,file.contentIdentity,file.byteCount,file.objectId??null);
      if(file.kind==='binary') {
        object.run(file.objectId,...boundary(ns),file.mediaType,file.contentIdentity,file.byteCount,prepared.versionId,file.position);
        for(const part of file.chunks)chunk.run(file.objectId,part.index,part.mac,part.bytes);
      }
    }
    validateMixedManifest(db,prepared.versionId);
  }
  function metadata(ns,row,textRows,check) {
    const entries=query('SELECT version_id,position,kind,path,media_type,content_identity,byte_count,binary_object_id,folded_path FROM method_mixed_entries WHERE version_id=? ORDER BY position',check).all(row.id);
    const texts=entries.filter(entry=>entry.kind==='text');
    if(!entries.length||entries.length>256||entries.some((entry,i)=>entry.position!==i||entry.folded_path!==entry.path.toLowerCase())||
      !entries.some(entry=>entry.kind==='binary')||texts.length!==textRows.length||texts.reduce((sum,entry)=>sum+entry.byte_count,0)!==row.byte_count||
      texts.some((entry,i)=>['position','path','media_type','content_identity','byte_count'].some(key=>entry[key]!==textRows[i][key]))||
      manifestIdentity(ns,entries.map(entry=>({kind:entry.kind,path:entry.path,mediaType:entry.media_type,byteCount:entry.byte_count,contentIdentity:entry.content_identity})))!==row.manifest_identity)
      fail('method_version_unavailable');
    return entries;
  }
  // Metadata-only verification is synchronous and shared by U4 chunk delivery
  // and the role reader's preparation/final transactions. It never loads bytes.
  function verifyBinaryMetadata(ns,found,file) {
    const entry=db.prepare('SELECT * FROM method_mixed_entries WHERE version_id=? AND position=?').get(found.row.id,file.position);
    const object=db.prepare('SELECT * FROM binary_objects WHERE id=?').get(file.binary_object_id);
    if(file.kind!=='binary'||file.version_id!==found.row.id||!entry||entry.kind!=='binary'||
      ['version_id','position','path','media_type','content_identity','byte_count','binary_object_id'].some(key=>entry[key]!==file[key])||
      !object||object.method_version_id!==found.row.id||object.position!==file.position||object.asset_version_id!==null||
      object.owner_id!==ns.ownerId||object.scope!==ns.scope||object.project_id!==(ns.projectId??'')||object.content_identity!==file.content_identity||
      object.media_type!==file.media_type||object.byte_count!==file.byte_count||!Number.isSafeInteger(object.byte_count)||object.byte_count<1||object.byte_count>ASSET_LIMITS.versionBytes)
      fail('method_version_unavailable');
    return object;
  }
  function chunk(ns,found,file,index) {
    const object=verifyBinaryMetadata(ns,found,file);
    const count=Math.ceil(object.byte_count/32768);
    if(!Number.isSafeInteger(index)||index<0||index>=count)fail('invalid_cursor');
    const row=db.prepare('SELECT chunk_mac,bytes FROM binary_chunks WHERE object_id=? AND chunk_index=?').get(object.id,index),length=Math.min(32768,object.byte_count-index*32768);
    if(!row||row.bytes.length!==length||row.chunk_mac!==mac('binary-chunk-v1',
      [binaryNamespace(ns),object.id,object.content_identity,object.media_type,object.byte_count,index,length,row.bytes]))fail('method_version_unavailable');
    return {index,encoding:'base64',bytes:Buffer.from(row.bytes).toString('base64'),byteCount:length,totalByteCount:object.byte_count,complete:index+1===count};
  }
  // Authentication is separate from freshness: deleted attachment targets win
  // over epoch staleness, while a malformed/substituted cursor never does.
  function encode(value) {const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+mac('method-attachment-cursor-v1',[body]);}
  function decode(cursor,expected) {
    if(cursor===undefined)return null;
    const [body,signature,extra]=cursor.split('.');
    if(!body||extra!==undefined||signature!==mac('method-attachment-cursor-v1',[body]))fail('invalid_cursor');
    let saved;try{saved=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{fail('invalid_cursor');}
    if(JSON.stringify(saved.binding)!==JSON.stringify(expected)||!Number.isSafeInteger(saved.after)||saved.after<0||
      ![saved.packageRevision,saved.versionRevision].every(value=>Number.isSafeInteger(value)&&value>0))fail('invalid_cursor');
    return saved;
  }
  return {mixed,prepare,reserve,insert,metadata,verifyBinaryMetadata,chunk,encode,decode,
    streamBinding:(input,access)=>mac('method-attachment-stream-v1',[input,access])};
}

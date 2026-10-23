import { randomUUID } from 'node:crypto';
import { constants,openSync,closeSync,fstatSync,lstatSync,mkdirSync,rmdirSync,unlinkSync,linkSync,writeSync,readSync,fsyncSync } from 'node:fs';
import { isAbsolute,dirname,basename } from 'node:path';
import { PATH_FLAGS,fdPath,inspectFile,methodEntryName,probeMethodFileEnvironment } from './method-package-files.mjs';
import { fail } from '../../core/validation.mjs';
import { assetFilename } from '../../core/asset-input.mjs';
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const value=result=>{if(!result.ok)fail(result.error.code);return result.value;};
const entry=(parent,name)=>`${fdPath(parent)}/${name}`;
function owned(parent,name,stat){try{return same(lstatSync(entry(parent,name),{bigint:true}),stat);}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function privateDirectory(fd,uid,mask){const stat=fstatSync(fd,{bigint:true});if(!stat.isDirectory()||stat.uid!==uid||(stat.mode&mask)!==0n)fail('invalid_path');return stat;}

/** Link is the publication point. No code path removes or replaces the final. */
export function exportAsset(call,version,path){
  probeMethodFileEnvironment();
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))fail('invalid_path');
  const name=assetFilename(methodEntryName(basename(path))),uid=BigInt(process.getuid());
  let parent,stage,syncParent,syncStage,data,stageName,stageStat,dataStat,published=false,result,failure,cleanupError,total=0;
  const uncertain=()=>({ok:false,error:{code:'published-but-durability-uncertain',retryable:false},
    value:{status:'published-but-durability-uncertain',version,byteCount:total}});
  const temporary='payload-'+randomUUID();
  try{
    parent=openSync(dirname(path),PATH_FLAGS|constants.O_DIRECTORY);const root=inspectFile(parent,undefined,'directory');
    privateDirectory(parent,uid,0o022n);
    // A private directory protects the source entry from writers to the parent.
    stageName='.cairn-export-'+randomUUID();mkdirSync(entry(parent,stageName),{mode:0o700});
    // Save the new entry identity before descriptor acquisition or inspection
    // can fail (for example EMFILE). Cleanup needs only the pinned parent.
    stageStat=lstatSync(entry(parent,stageName),{bigint:true});
    stage=openSync(entry(parent,stageName),PATH_FLAGS|constants.O_DIRECTORY);
    if(!same(stageStat,inspectFile(stage,root.mount,'directory').stat))fail('invalid_path');
    privateDirectory(stage,uid,0o077n);
    data=openSync(entry(stage,temporary),constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_RDWR,0o600);
    dataStat=inspectFile(data,root.mount,'file').stat;
    let cursor,index=0,expectedTotal;
    do{
      const page=value(call('readAssetBytes',{version,...(cursor?{cursor}:{})}));
      if(page.status!=='available'||page.index!==index++||page.encoding!=='base64'||!Number.isSafeInteger(page.totalByteCount)||
        page.totalByteCount<1||page.totalByteCount>33554432)fail('asset_version_unavailable');
      expectedTotal??=page.totalByteCount;
      const bytes=Buffer.from(page.bytes,'base64');
      if(page.totalByteCount!==expectedTotal||bytes.length!==page.byteCount||!bytes.length||bytes.length>32768||
        total+bytes.length>expectedTotal||page.complete!==(total+bytes.length===expectedTotal)||Boolean(page.nextCursor)===page.complete)fail('asset_version_unavailable');
      let offset=0;while(offset<bytes.length){const count=writeSync(data,bytes,offset,bytes.length-offset,null);if(count<=0)fail('invalid_input');offset+=count;}
      total+=bytes.length;cursor=page.nextCursor;
    }while(cursor);
    if(total!==expectedTotal||fstatSync(data).size!==total)fail('asset_version_unavailable');
    // Read back the actual file, then ask the canonical byte verifier. No
    // candidate-derived identity is accepted as the canonical target identity.
    const bytes=Buffer.alloc(total);let offset=0;
    while(offset<total){const count=readSync(data,bytes,offset,total-offset,offset);if(count<=0)fail('invalid_input');offset+=count;}
    const verified=value(call('verifyAssetBytes',{version,bytes}));
    if(!verified.matches||verified.candidateLength!==total||verified.canonicalContentIdentity!==version.contentIdentity)fail('asset_version_unavailable');
    fsyncSync(data);
    privateDirectory(parent,uid,0o022n);privateDirectory(stage,uid,0o077n);
    if(!owned(parent,stageName,stageStat)||!owned(stage,temporary,dataStat)||!same(fstatSync(data,{bigint:true}),dataStat)||fstatSync(data).nlink!==1)fail('invalid_path');
    linkSync(entry(stage,temporary),entry(parent,name));published=true;
    // O_PATH cannot fsync. Reopen this pinned directory, never its original path.
    syncParent=openSync(fdPath(parent),constants.O_RDONLY|constants.O_DIRECTORY);
    if(!same(fstatSync(syncParent,{bigint:true}),root.stat))fail('invalid_path');
    fsyncSync(syncParent);
    if(!owned(stage,temporary,dataStat))fail('invalid_path');
    unlinkSync(entry(stage,temporary));
    syncStage=openSync(fdPath(stage),constants.O_RDONLY|constants.O_DIRECTORY);
    fsyncSync(syncStage);
    if(!owned(parent,stageName,stageStat))fail('invalid_path');
    rmdirSync(entry(parent,stageName));fsyncSync(syncParent);
    result={ok:true,value:{status:'published',version,byteCount:total}};
  }catch(error){
    failure=error;
    // A syscall may publish before its return is interrupted. Observe the
    // owned final, without ever unlinking or replacing it as rollback.
    try{if(!published&&parent!==undefined&&dataStat&&owned(parent,name,dataStat))published=true;}
    catch(error){cleanupError??=error;}
  }finally{
    // Clean only entries still owned by this invocation. Never glob or recurse.
    // If initial payload inspection failed, its held creation fd can establish
    // the identity for cleanup; a pathname alone cannot establish that identity.
    if(data!==undefined&&!dataStat){try{dataStat=fstatSync(data,{bigint:true});}catch(error){cleanupError??=error;}}
    try{if(stage!==undefined&&dataStat&&owned(stage,temporary,dataStat))unlinkSync(entry(stage,temporary));}
    catch(error){cleanupError??=error;}
    try{if(parent!==undefined&&stageStat&&owned(parent,stageName,stageStat))rmdirSync(entry(parent,stageName));}
    catch(error){cleanupError??=error;}
    // A failing close may already have released its fd. Attempt each once,
    // retaining the first error while allowing every remaining close to run.
    for(const fd of [syncStage,data,syncParent,stage,parent])if(fd!==undefined){
      try{closeSync(fd);}catch(error){cleanupError??=error;}
    }
  }
  if(published&&(failure||cleanupError))return uncertain();
  if(cleanupError)throw cleanupError;
  if(failure)throw failure;
  return result;
}
